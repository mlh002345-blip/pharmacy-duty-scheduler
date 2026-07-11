// Cheap ZIP-metadata inspection performed BEFORE any XLSX-library call
// that would decompress entry content.
//
// WHY THIS EXISTS: `workbook.xlsx.load(buffer)` (exceljs 4.4.0) calls
// `JSZip.loadAsync(buffer)` internally and then reads *every* archive
// entry's decompressed bytes while parsing the workbook — confirmed by
// direct measurement (Step 7, docs/security/25-excel-xlsx-resource-security-validation.md):
// a 199 KB crafted archive (a single all-zero 200 MB entry named
// "xl/bomb.xml", well under this app's existing 5 MB upload limit)
// caused `workbook.xlsx.load()` to allocate ~430 MB of additional
// process RSS in under 2 seconds, with no error and no size check ever
// running — the row-count guard in parse-excel.ts only sees the fully
// materialized workbook, too late to prevent the allocation.
//
// `JSZip.loadAsync()` itself, by contrast, only parses the ZIP central
// directory — it does NOT decompress entry content until `.async()` is
// called on a specific entry (also directly measured: the same 200 MB
// bomb loads via bare `JSZip.loadAsync` in ~3ms with no memory growth,
// because `uncompressedSize`/`compressedSize` are read straight from
// the central directory record). That makes JSZip itself — already an
// indirect dependency of exceljs — the correct, minimal tool for a safe
// preflight: this module calls `JSZip.loadAsync()` once, reads only the
// metadata every entry already exposes, and never calls `.async()` on
// any entry's content. `jszip` is declared as a direct, exact-pinned
// dependency (matching the version exceljs itself already resolves to)
// rather than relying on an undeclared transitive one.
//
// This is deliberately NOT a general-purpose ZIP-bomb scanner — it only
// protects the one call site in this app that decompresses an
// untrusted upload (historicalImportAction). No new dependency beyond
// jszip was added, and no full ZIP parser was hand-written.

import JSZip from "jszip";

export class ZipPreflightError extends Error {
  constructor(public reasonCode: ZipRejectionReason, message: string) {
    super(message);
  }
}

export type ZipRejectionReason =
  | "not_a_zip"
  | "too_many_entries"
  | "entry_too_large"
  | "total_too_large"
  | "compression_ratio_too_high"
  | "duplicate_entry"
  | "unsafe_entry_path"
  | "encrypted_entry"
  | "missing_workbook_entry";

export type ZipPreflightLimits = {
  maxEntryCount: number;
  maxSingleEntryUncompressedBytes: number;
  maxTotalUncompressedBytes: number;
  maxCompressionRatio: number;
};

// Evidence-based defaults (see the module comment above and
// docs/security/25-excel-xlsx-resource-security-validation.md for the
// measurements behind these numbers):
//   - A real xlsx has on the order of 10-20 internal entries (sheets,
//     styles, shared strings, rels, content-types, ...); 100 comfortably
//     covers a workbook with dozens of sheets without allowing an
//     entry-count-based amplification attack.
//   - MAX_IMPORT_ROWS (5,000) worth of row XML is on the order of a few
//     MB uncompressed even with generous per-cell overhead; 100 MB total
//     stays well under the task's own ">250MB" memory-growth
//     investigation threshold even accounting for exceljs's own
//     object-graph overhead on top of the raw decompressed bytes.
//   - A legitimate XML-heavy xlsx typically compresses on the order of
//     5-20x; a ratio of 100:1 is already far outside that range, and
//     classic zip-bomb constructions reach ratios in the thousands.
export const DEFAULT_ZIP_PREFLIGHT_LIMITS: ZipPreflightLimits = {
  maxEntryCount: 100,
  maxSingleEntryUncompressedBytes: 50 * 1024 * 1024,
  maxTotalUncompressedBytes: 100 * 1024 * 1024,
  maxCompressionRatio: 100,
};

function isUnsafeEntryPath(name: string): boolean {
  if (name.startsWith("/") || /^[A-Za-z]:[\\/]/.test(name)) return true; // absolute path (POSIX or Windows drive)
  const segments = name.split(/[\\/]/);
  return segments.some((segment) => segment === "..");
}

/**
 * Inspects a ZIP/XLSX archive's central-directory metadata without
 * decompressing any entry's content. Throws `ZipPreflightError` (a
 * generic, reason-coded rejection — never the underlying library error)
 * if the archive is malformed or exceeds any configured limit.
 */
export async function preflightZipArchive(
  buffer: Buffer,
  limits: ZipPreflightLimits = DEFAULT_ZIP_PREFLIGHT_LIMITS
): Promise<void> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer, { checkCRC32: false });
  } catch {
    throw new ZipPreflightError("not_a_zip", "Dosya geçerli bir ZIP/Excel arşivi değil.");
  }

  const entries = Object.values(zip.files).filter((entry) => !entry.dir);

  if (entries.length === 0) {
    throw new ZipPreflightError("not_a_zip", "Dosya geçerli bir ZIP/Excel arşivi değil.");
  }
  if (entries.length > limits.maxEntryCount) {
    throw new ZipPreflightError(
      "too_many_entries",
      "Dosya izin verilenden fazla iç bileşen içeriyor."
    );
  }

  const seenNames = new Set<string>();
  let totalUncompressed = 0;
  let hasWorkbookEntry = false;

  for (const entry of entries) {
    if (seenNames.has(entry.name)) {
      throw new ZipPreflightError("duplicate_entry", "Dosya arşivi tutarsız (yinelenen iç bileşen).");
    }
    seenNames.add(entry.name);

    if (isUnsafeEntryPath(entry.name)) {
      throw new ZipPreflightError("unsafe_entry_path", "Dosya arşivi güvenli olmayan bir iç yol içeriyor.");
    }

    // JSZip marks a genuinely encrypted (traditional ZipCrypto) entry
    // via a bit in the general-purpose flag captured on `_data`; a
    // workbook protected with Excel's own "Encrypt with Password"
    // feature is instead a single opaque OLE/CFB entry (no normal
    // xl/workbook.xml at all) — caught below by the missing-workbook
    // check instead, since that encryption scheme isn't ZIP-level.
    const data = (entry as unknown as { _data?: { uncompressedSize?: number; compressedSize?: number } })._data;
    const uncompressedSize = data?.uncompressedSize ?? 0;
    const compressedSize = data?.compressedSize ?? 0;

    if (uncompressedSize > limits.maxSingleEntryUncompressedBytes) {
      throw new ZipPreflightError("entry_too_large", "Dosya arşivindeki bir bileşen çok büyük.");
    }

    if (compressedSize > 0) {
      const ratio = uncompressedSize / compressedSize;
      if (ratio > limits.maxCompressionRatio) {
        throw new ZipPreflightError(
          "compression_ratio_too_high",
          "Dosya sıkıştırma oranı güvenlik sınırının üzerinde."
        );
      }
    }

    totalUncompressed += uncompressedSize;
    if (totalUncompressed > limits.maxTotalUncompressedBytes) {
      throw new ZipPreflightError("total_too_large", "Dosya açıldığında izin verilenden büyük olacak.");
    }

    if (entry.name === "xl/workbook.xml") hasWorkbookEntry = true;
  }

  if (!hasWorkbookEntry) {
    throw new ZipPreflightError(
      "missing_workbook_entry",
      "Dosya geçerli bir Excel (.xlsx) çalışma kitabı yapısı içermiyor."
    );
  }
}
