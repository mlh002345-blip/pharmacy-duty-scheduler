"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

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
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
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
