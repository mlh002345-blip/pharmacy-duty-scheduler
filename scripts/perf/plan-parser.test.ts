import { describe, expect, it } from "vitest";

import { isConcerningSequentialScan, summarizePlan, type ExplainJson } from "./plan-parser";

function explain(plan: ExplainJson[0]["Plan"], overrides: Partial<ExplainJson[0]> = {}): ExplainJson {
  return [{ Plan: plan, "Planning Time": 0.1, "Execution Time": 5, ...overrides }];
}

describe("summarizePlan", () => {
  it("identifies a sequential scan", () => {
    const result = summarizePlan(
      explain({
        "Node Type": "Seq Scan",
        "Relation Name": "Pharmacy",
        "Actual Rows": 100,
        "Plan Rows": 100,
        "Actual Loops": 1,
      })
    );
    expect(result.sequentialScans).toHaveLength(1);
    expect(result.sequentialScans[0].relationName).toBe("Pharmacy");
    expect(result.indexScans).toHaveLength(0);
  });

  it("identifies an index scan", () => {
    const result = summarizePlan(
      explain({
        "Node Type": "Index Scan",
        "Relation Name": "Session",
        "Index Name": "Session_token_key",
        "Actual Rows": 1,
        "Plan Rows": 1,
        "Actual Loops": 1,
      })
    );
    expect(result.indexScans).toHaveLength(1);
    expect(result.indexScans[0].indexName).toBe("Session_token_key");
    expect(result.sequentialScans).toHaveLength(0);
  });

  it("walks nested child plans (e.g. a Sort over a Seq Scan)", () => {
    const result = summarizePlan(
      explain({
        "Node Type": "Sort",
        "Sort Method": "external merge  Disk: 4096kB",
        "Sort Space Used": 4096,
        "Actual Loops": 1,
        Plans: [
          {
            "Node Type": "Seq Scan",
            "Relation Name": "AuditLog",
            "Actual Rows": 100000,
            "Plan Rows": 100000,
            "Actual Loops": 1,
            "Rows Removed by Filter": 0,
          },
        ],
      })
    );
    expect(result.sequentialScans).toHaveLength(1);
    expect(result.sortsSpilledToDisk).toHaveLength(1);
    expect(result.sortsSpilledToDisk[0].sortSpaceUsedKb).toBe(4096);
  });

  it("does not flag an in-memory sort (quicksort) as a disk spill", () => {
    const result = summarizePlan(
      explain({
        "Node Type": "Sort",
        "Sort Method": "quicksort  Memory: 30kB",
        "Actual Loops": 1,
      })
    );
    expect(result.sortsSpilledToDisk).toHaveLength(0);
  });

  it("sums shared buffer hits/reads and rows removed by filter across nodes", () => {
    const result = summarizePlan(
      explain({
        "Node Type": "Hash Join",
        "Actual Loops": 1,
        "Shared Hit Blocks": 10,
        "Shared Read Blocks": 2,
        Plans: [
          {
            "Node Type": "Seq Scan",
            "Actual Loops": 1,
            "Shared Hit Blocks": 5,
            "Shared Read Blocks": 1,
            "Rows Removed by Filter": 40,
          },
          {
            "Node Type": "Seq Scan",
            "Actual Loops": 1,
            "Shared Hit Blocks": 3,
            "Shared Read Blocks": 0,
            "Rows Removed by Filter": 10,
          },
        ],
      })
    );
    expect(result.totalSharedHitBlocks).toBe(18);
    expect(result.totalSharedReadBlocks).toBe(3);
    expect(result.totalRowsRemovedByFilter).toBe(50);
  });

  it("extracts planning and execution time from the root", () => {
    const result = summarizePlan(
      explain(
        { "Node Type": "Result", "Actual Loops": 1 },
        { "Planning Time": 0.25, "Execution Time": 12.4 }
      )
    );
    expect(result.planningTimeMs).toBe(0.25);
    expect(result.executionTimeMs).toBe(12.4);
  });

  it("tracks the maximum loop count across nested nodes (nested-loop cost signal)", () => {
    const result = summarizePlan(
      explain({
        "Node Type": "Nested Loop",
        "Actual Loops": 1,
        Plans: [
          { "Node Type": "Seq Scan", "Actual Loops": 1 },
          { "Node Type": "Index Scan", "Actual Loops": 5000 },
        ],
      })
    );
    expect(result.maxActualLoops).toBe(5000);
  });
});

describe("isConcerningSequentialScan", () => {
  it("is not concerning for a small relation", () => {
    const flagged = isConcerningSequentialScan({
      nodeType: "Seq Scan",
      actualRows: 5,
      planRows: 5,
      actualLoops: 1,
      rowsRemovedByFilter: 95,
    });
    expect(flagged).toBe(false);
  });

  it("is not concerning when the scan returns everything it scanned (no selectivity to exploit)", () => {
    const flagged = isConcerningSequentialScan({
      nodeType: "Seq Scan",
      actualRows: 50000,
      planRows: 50000,
      actualLoops: 1,
      rowsRemovedByFilter: 0,
    });
    expect(flagged).toBe(false);
  });

  it("is concerning for a large, highly selective scan with no index support", () => {
    const flagged = isConcerningSequentialScan({
      nodeType: "Seq Scan",
      actualRows: 50,
      planRows: 50,
      actualLoops: 1,
      rowsRemovedByFilter: 49_950,
    });
    expect(flagged).toBe(true);
  });

  it("respects a custom minimum-relation-size threshold", () => {
    const finding = {
      nodeType: "Seq Scan" as const,
      actualRows: 5,
      planRows: 5,
      actualLoops: 1,
      rowsRemovedByFilter: 95,
    };
    expect(isConcerningSequentialScan(finding, { minRelationRowsEstimate: 50 })).toBe(true);
    expect(isConcerningSequentialScan(finding, { minRelationRowsEstimate: 1000 })).toBe(false);
  });
});
