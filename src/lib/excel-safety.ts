// Excel/LibreOffice/Sheets treat a cell string starting with =, +, -, or @
// as a formula. User-controlled text (pharmacy names, addresses, manual
// assignment notes, ...) must never be written to a spreadsheet cell
// unescaped, or opening the exported file could execute an attacker-chosen
// formula (CWE-1236). This only affects export/write time — stored DB
// values are never mutated.
const FORMULA_TRIGGER_CHARS = ["=", "+", "-", "@"];

export function escapeExcelCell<T>(value: T): T | string {
  if (typeof value !== "string") return value;
  const trimmed = value.trimStart();
  if (trimmed.length === 0) return value;
  if (FORMULA_TRIGGER_CHARS.includes(trimmed[0])) {
    return `'${value}`;
  }
  return value;
}
