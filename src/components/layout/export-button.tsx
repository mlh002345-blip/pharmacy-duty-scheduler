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
      const response = await fetch(href);
      if (!response.ok) {
        alert("Dışa aktarma sırasında bir hata oluştu.");
        return;
      }

      const disposition = response.headers.get("Content-Disposition") ?? "";
      const filenameMatch = disposition.match(/filename="?([^"]+)"?/);
      const filename = filenameMatch?.[1] ?? "dosya";

      const blob = await response.blob();
      downloadBlobAsFile(blob, filename);
    } catch {
      alert("Dışa aktarma sırasında bir hata oluştu.");
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
