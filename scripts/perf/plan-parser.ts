// Pure parser over the JSON produced by
// `EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT JSON)`. No I/O — takes the
// already-parsed JSON value and extracts the specific evidence this
// benchmark step needs (scan types, row estimates vs actuals, sort
// spills, buffer usage) so the interpretation logic is directly
// unit-testable without a database.

export type PlanNode = {
  "Node Type": string;
  "Relation Name"?: string;
  "Index Name"?: string;
  "Actual Rows"?: number;
  "Plan Rows"?: number;
  "Actual Loops"?: number;
  "Rows Removed by Filter"?: number;
  "Shared Hit Blocks"?: number;
  "Shared Read Blocks"?: number;
  "Sort Method"?: string;
  "Sort Space Used"?: number;
  "Sort Space Type"?: string;
  Plans?: PlanNode[];
  [key: string]: unknown;
};

export type ExplainResult = {
  Plan: PlanNode;
  "Planning Time"?: number;
  "Execution Time"?: number;
};

// Postgres's EXPLAIN (FORMAT JSON) always returns a top-level array with
// exactly one element for a single statement.
export type ExplainJson = ExplainResult[];

export type ScanFinding = {
  nodeType: string;
  relationName?: string;
  indexName?: string;
  actualRows: number;
  planRows: number;
  actualLoops: number;
  rowsRemovedByFilter: number;
};

export type PlanSummary = {
  planningTimeMs: number;
  executionTimeMs: number;
  sequentialScans: ScanFinding[];
  indexScans: ScanFinding[];
  sortsSpilledToDisk: { sortMethod: string; sortSpaceUsedKb: number }[];
  totalSharedHitBlocks: number;
  totalSharedReadBlocks: number;
  totalRowsRemovedByFilter: number;
  maxActualLoops: number;
};

function walk(node: PlanNode, visit: (n: PlanNode) => void): void {
  visit(node);
  for (const child of node.Plans ?? []) walk(child, visit);
}

export function summarizePlan(explain: ExplainJson): PlanSummary {
  const root = explain[0];
  const sequentialScans: ScanFinding[] = [];
  const indexScans: ScanFinding[] = [];
  const sortsSpilledToDisk: PlanSummary["sortsSpilledToDisk"] = [];
  let totalSharedHitBlocks = 0;
  let totalSharedReadBlocks = 0;
  let totalRowsRemovedByFilter = 0;
  let maxActualLoops = 0;

  walk(root.Plan, (node) => {
    const finding: ScanFinding = {
      nodeType: node["Node Type"],
      relationName: node["Relation Name"],
      indexName: node["Index Name"],
      actualRows: node["Actual Rows"] ?? 0,
      planRows: node["Plan Rows"] ?? 0,
      actualLoops: node["Actual Loops"] ?? 1,
      rowsRemovedByFilter: node["Rows Removed by Filter"] ?? 0,
    };

    if (node["Node Type"] === "Seq Scan") sequentialScans.push(finding);
    if (
      node["Node Type"] === "Index Scan" ||
      node["Node Type"] === "Index Only Scan" ||
      node["Node Type"] === "Bitmap Index Scan"
    ) {
      indexScans.push(finding);
    }
    if (node["Node Type"] === "Sort" && node["Sort Method"]?.toLowerCase().includes("external")) {
      sortsSpilledToDisk.push({
        sortMethod: node["Sort Method"] ?? "unknown",
        sortSpaceUsedKb: node["Sort Space Used"] ?? 0,
      });
    }

    totalSharedHitBlocks += node["Shared Hit Blocks"] ?? 0;
    totalSharedReadBlocks += node["Shared Read Blocks"] ?? 0;
    totalRowsRemovedByFilter += node["Rows Removed by Filter"] ?? 0;
    maxActualLoops = Math.max(maxActualLoops, node["Actual Loops"] ?? 1);
  });

  return {
    planningTimeMs: root["Planning Time"] ?? 0,
    executionTimeMs: root["Execution Time"] ?? 0,
    sequentialScans,
    indexScans,
    sortsSpilledToDisk,
    totalSharedHitBlocks,
    totalSharedReadBlocks,
    totalRowsRemovedByFilter,
    maxActualLoops,
  };
}

/**
 * A sequential scan is only worth flagging if the underlying relation is
 * large AND the filter is selective (removes most rows) — a seq scan
 * over a small table, or one that returns most of its rows anyway, is
 * normal and not something an index would meaningfully improve.
 */
export function isConcerningSequentialScan(
  finding: ScanFinding,
  options: { minRelationRowsEstimate?: number } = {}
): boolean {
  const minRows = options.minRelationRowsEstimate ?? 10_000;
  const totalRowsScanned = finding.actualRows + finding.rowsRemovedByFilter;
  if (totalRowsScanned < minRows) return false;
  if (finding.rowsRemovedByFilter === 0) return false; // scanned everything AND returned everything — not a selectivity problem
  const selectivity = finding.actualRows / totalRowsScanned;
  return selectivity < 0.2; // returns fewer than 20% of scanned rows — a selective predicate with no index support
}
