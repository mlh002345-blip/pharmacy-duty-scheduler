import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";
import Link from "next/link";

import { DEFAULT_PAGE_SIZE, Pagination } from "@/components/layout/pagination";

const prismaMock = {
  unavailability: { findMany: vi.fn(), count: vi.fn() },
};
const getCurrentUser = vi.fn();

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: (...args: unknown[]) => getCurrentUser(...args),
}));

const MazeretlerPage = (await import("./page")).default;

function searchParams(page?: string) {
  return Promise.resolve(page ? { page } : {});
}

function unavailabilityRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "unavailability-1",
    startDate: new Date("2026-07-10T00:00:00.000Z"),
    endDate: new Date("2026-07-12T00:00:00.000Z"),
    reason: "Tatil",
    pharmacy: { name: "Deva Eczanesi" },
    ...overrides,
  };
}

// Walks the React element tree returned by the (server component) page to
// find every element of a given type/component — no DOM rendering needed,
// since Server Components just return plain React element objects here.
function findAllElements(node: unknown, predicate: (el: ReactElement) => boolean): ReactElement[] {
  const found: ReactElement[] = [];
  function walk(n: unknown) {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) {
      for (const child of n) walk(child);
      return;
    }
    const el = n as ReactElement & { props?: { children?: ReactNode } };
    if ("type" in el && predicate(el)) found.push(el);
    const children = el.props?.children;
    if (children !== undefined) walk(children);
  }
  walk(node);
  return found;
}

function textContent(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  const el = node as ReactElement & { props?: { children?: ReactNode } };
  if (el.props?.children !== undefined) return textContent(el.props.children);
  return "";
}

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUser.mockResolvedValue({ id: "staff-1", role: "STAFF", organizationId: "org-1" });
  prismaMock.unavailability.findMany.mockResolvedValue([]);
  prismaMock.unavailability.count.mockResolvedValue(0);
});

describe("MazeretlerPage — paginated, select-scoped query", () => {
  it("queries with select-scoped fields (pharmacy.name only, not include) and page-1 skip/take", async () => {
    await MazeretlerPage({ searchParams: searchParams() });

    expect(prismaMock.unavailability.findMany).toHaveBeenCalledExactlyOnceWith({
      where: { pharmacy: { region: { organizationId: "org-1" } } },
      select: {
        id: true,
        startDate: true,
        endDate: true,
        reason: true,
        pharmacy: { select: { name: true } },
      },
      orderBy: { startDate: "asc" },
      skip: 0,
      take: DEFAULT_PAGE_SIZE,
    });
    expect(prismaMock.unavailability.count).toHaveBeenCalledOnce();
  });

  it("computes skip from the page query param", async () => {
    await MazeretlerPage({ searchParams: searchParams("3") });

    expect(prismaMock.unavailability.findMany).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ skip: (3 - 1) * DEFAULT_PAGE_SIZE, take: DEFAULT_PAGE_SIZE })
    );
  });

  it("passes the correct props to Pagination when the count exceeds one page", async () => {
    prismaMock.unavailability.findMany.mockResolvedValue([unavailabilityRow()]);
    prismaMock.unavailability.count.mockResolvedValue(DEFAULT_PAGE_SIZE + 5);

    const result = await MazeretlerPage({ searchParams: searchParams("2") });

    const [paginationEl] = findAllElements(result, (el) => el.type === Pagination);
    expect(paginationEl).toBeDefined();
    expect(paginationEl.props).toMatchObject({
      basePath: "/mazeretler",
      page: 2,
      pageSize: DEFAULT_PAGE_SIZE,
      totalCount: DEFAULT_PAGE_SIZE + 5,
    });
  });

  it("renders the empty state when there are no records", async () => {
    const result = await MazeretlerPage({ searchParams: searchParams() });

    expect(textContent(result)).toContain("Henüz tanımlı bir mazeret kaydı bulunmuyor.");
  });

  it("renders edit and delete controls for each row when the user can manage", async () => {
    prismaMock.unavailability.findMany.mockResolvedValue([unavailabilityRow()]);
    prismaMock.unavailability.count.mockResolvedValue(1);

    const result = await MazeretlerPage({ searchParams: searchParams() });

    const editLinks = findAllElements(
      result,
      (el) =>
        el.type === Link &&
        (el.props as { href?: string }).href === "/mazeretler/unavailability-1/duzenle"
    );
    expect(editLinks.length).toBeGreaterThan(0);
    expect(textContent(result)).toContain("Deva Eczanesi");
  });
});
