"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

// Triggers a browser download for `blob` and guarantees the object URL is
// revoked afterwards — including if the DOM manipulation itself throws —
// so it never outlives this call. No revoke is attempted if
// createObjectURL itself throws, since no URL was ever created. Exported
// standalone so this exact guarantee is unit-testable without rendering
// the component.
export function downloadBlobAsFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

// A hung export request would otherwise leave the button in "İndiriliyor..."
// indefinitely (no browser-default timeout is short enough to rely on).
export const EXPORT_FETCH_TIMEOUT_MS = 30_000;

// Thrown by fetchExportBlob specifically when the timeout (not a real
// network/server error) aborted the request, so callers can show a
// distinct message instead of the generic failure alert.
export class ExportTimeoutError extends Error {
  constructor() {
    super("Export request timed out");
    this.name = "ExportTimeoutError";
  }
}

// Fetches the export route with an AbortController-based timeout and
// returns the resulting blob + filename. Exported standalone (like
// downloadBlobAsFile) so the timeout/abort behavior is unit-testable
// without rendering the component. No retry — a single attempt only.
export async function fetchExportBlob(
  href: string,
  options?: { timeoutMs?: number; fetchImpl?: typeof fetch }
): Promise<{ blob: Blob; filename: string }> {
  const timeoutMs = options?.timeoutMs ?? EXPORT_FETCH_TIMEOUT_MS;
  const fetchImpl = options?.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let response: Response;
    try {
      response = await fetchImpl(href, { signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new ExportTimeoutError();
      }
      throw error;
    }

    if (!response.ok) {
      throw new Error("Export request failed");
    }

    const disposition = response.headers.get("Content-Disposition") ?? "";
    const filenameMatch = disposition.match(/filename="?([^"]+)"?/);
    const filename = filenameMatch?.[1] ?? "dosya";

    const blob = await response.blob();
    return { blob, filename };
  } finally {
    clearTimeout(timeoutId);
  }
}

// Excel/PDF export routes stream a file rather than navigating, so a plain
// <a href> gives no visual feedback while pdfkit/xlsx build the file. Fetch
// the route ourselves so we can show "İndiriliyor..." until the file is
// ready, then trigger the browser download from the response.
export function ExportButton({
  href,
  label,
  size,
}: {
  href: string;
  label: string;
  size?: React.ComponentProps<typeof Button>["size"];
}) {
  const [isDownloading, setIsDownloading] = useState(false);

  async function handleClick() {
    setIsDownloading(true);
    try {
      const { blob, filename } = await fetchExportBlob(href);
      downloadBlobAsFile(blob, filename);
    } catch (error) {
      if (error instanceof ExportTimeoutError) {
        alert("İndirme zaman aşımına uğradı. Lütfen tekrar deneyin.");
      } else {
        alert("Dışa aktarma sırasında bir hata oluştu.");
      }
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <Button variant="outline" size={size} onClick={handleClick} disabled={isDownloading}>
      {isDownloading ? "İndiriliyor..." : label}
    </Button>
  );
}
