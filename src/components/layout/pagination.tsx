import Link from "next/link";

import { Button } from "@/components/ui/button";

export const DEFAULT_PAGE_SIZE = 20;

export function parsePageParam(page: string | undefined): number {
  const parsed = Number(page);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

// Builds "?a=b&page=N" from the current search params plus a target page,
// dropping "page" itself so callers don't have to special-case it.
function buildPageHref(
  basePath: string,
  searchParams: Record<string, string | undefined>,
  page: number
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (key === "page" || !value) continue;
    params.set(key, value);
  }
  if (page > 1) {
    params.set("page", String(page));
  }
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

export function Pagination({
  basePath,
  searchParams,
  page,
  pageSize,
  totalCount,
}: {
  basePath: string;
  searchParams: Record<string, string | undefined>;
  page: number;
  pageSize: number;
  totalCount: number;
}) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  if (totalPages <= 1) return null;

  const hasPrevious = page > 1;
  const hasNext = page < totalPages;

  return (
    <div className="flex items-center justify-between gap-4 pt-2">
      <p className="text-muted-foreground text-sm">
        Sayfa {page} / {totalPages} ({totalCount} kayıt)
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={!hasPrevious} asChild={hasPrevious}>
          {hasPrevious ? (
            <Link href={buildPageHref(basePath, searchParams, page - 1)}>Önceki</Link>
          ) : (
            <span>Önceki</span>
          )}
        </Button>
        <Button variant="outline" size="sm" disabled={!hasNext} asChild={hasNext}>
          {hasNext ? (
            <Link href={buildPageHref(basePath, searchParams, page + 1)}>Sonraki</Link>
          ) : (
            <span>Sonraki</span>
          )}
        </Button>
      </div>
    </div>
  );
}
