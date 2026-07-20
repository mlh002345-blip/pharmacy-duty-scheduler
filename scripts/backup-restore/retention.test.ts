import { describe, expect, it } from "vitest";

import { selectBackupsToDelete } from "./retention";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("selectBackupsToDelete", () => {
  it("returns nothing when there are 0 or 1 backups, no matter how old", () => {
    const now = Date.now();
    expect(selectBackupsToDelete([], 14, now)).toEqual([]);
    expect(
      selectBackupsToDelete([{ name: "only.dump", mtimeMs: now - 100 * DAY_MS }], 14, now)
    ).toEqual([]);
  });

  it("keeps everything within the retention window", () => {
    const now = Date.now();
    const files = [
      { name: "a.dump", mtimeMs: now },
      { name: "b.dump", mtimeMs: now - 1 * DAY_MS },
      { name: "c.dump", mtimeMs: now - 5 * DAY_MS },
    ];
    expect(selectBackupsToDelete(files, 14, now)).toEqual([]);
  });

  it("deletes backups strictly older than the retention window", () => {
    const now = Date.now();
    const files = [
      { name: "recent.dump", mtimeMs: now - 1 * DAY_MS },
      { name: "old.dump", mtimeMs: now - 20 * DAY_MS },
      { name: "ancient.dump", mtimeMs: now - 40 * DAY_MS },
    ];
    expect(selectBackupsToDelete(files, 14, now).sort()).toEqual(["ancient.dump", "old.dump"]);
  });

  it("never deletes the single most recent backup, even if it is older than the retention window", () => {
    const now = Date.now();
    // Simulates a long gap since the last successful run (e.g. the cron
    // job was broken for two months) — the only backup that exists is
    // itself past the retention cutoff, but it must be kept, not deleted.
    const files = [
      { name: "only-and-old.dump", mtimeMs: now - 60 * DAY_MS },
      { name: "even-older.dump", mtimeMs: now - 90 * DAY_MS },
    ];
    const deleted = selectBackupsToDelete(files, 14, now);
    expect(deleted).toEqual(["even-older.dump"]);
    expect(deleted).not.toContain("only-and-old.dump");
  });

  it("is unaffected by input order", () => {
    const now = Date.now();
    const files = [
      { name: "old.dump", mtimeMs: now - 20 * DAY_MS },
      { name: "newest.dump", mtimeMs: now },
      { name: "mid.dump", mtimeMs: now - 10 * DAY_MS },
    ];
    expect(selectBackupsToDelete(files, 14, now)).toEqual(["old.dump"]);
  });

  it("treats a backup exactly at the cutoff as still within retention (not deleted)", () => {
    const now = Date.now();
    const files = [
      { name: "newest.dump", mtimeMs: now },
      { name: "exactly-at-cutoff.dump", mtimeMs: now - 14 * DAY_MS },
    ];
    expect(selectBackupsToDelete(files, 14, now)).toEqual([]);
  });
});
