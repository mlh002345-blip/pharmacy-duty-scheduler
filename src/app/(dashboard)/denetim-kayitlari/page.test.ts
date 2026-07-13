import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";

import { DEFAULT_PAGE_SIZE, Pagination } from "@/components/layout/pagination";
import { EmptyState } from "@/components/layout/empty-state";

class RedirectSignal extends Error {
  constructor(
    public path: string,
    public kind: "success" | "error",
    public redirectMessage: string
  ) {
    super("REDIRECT");
  }
}

const prismaMock = {
  auditLog: { findMany: vi.fn(), count: vi.fn() },
};
const getCurrentUser = vi.fn();
const redirect = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: (...args: unknown[]) => getCurrentUser(...args),
}));
vi.mock("next/navigation", () => ({
  redirect: (...args: [string]) => redirect(...args),
}));
vi.mock("@/lib/flash-redirect", () => ({
  redirectWithMessage: (path: string, kind: "success" | "error", message: string) => {
    throw new RedirectSignal(path, kind, message);
  },
}));

const DenetimKayitlariPage = (await import("./page")).default;

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
  getCurrentUser.mockResolvedValue({ id: "admin-1", role: "ADMIN", organizationId: "org-1" });
  prismaMock.auditLog.findMany.mockResolvedValue([]);
  prismaMock.auditLog.count.mockResolvedValue(0);
});

function searchParams(page?: string) {
  return Promise.resolve(page ? { page } : {});
}

function auditRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "audit-1",
    createdAt: new Date("2026-07-10T14:30:00.000Z"),
    action: "UPDATE",
    entity: "User",
    before: JSON.stringify({ name: "Ahmet Yılmaz", email: "ahmet@example.com", role: "STAFF" }),
    after: JSON.stringify({ name: "Ahmet Yılmaz", email: "ahmet@example.com", role: "ADMIN" }),
    user: { name: "Yönetici Kullanıcı" },
    ...overrides,
  };
}

describe("DenetimKayitlariPage — manageUsers required", () => {
  it("VIEWER cannot access the audit log page", async () => {
    getCurrentUser.mockResolvedValue({ id: "viewer-1", role: "VIEWER", organizationId: "org-1" });

    await expect(DenetimKayitlariPage({ searchParams: searchParams() })).rejects.toBeInstanceOf(
      RedirectSignal
    );
    expect(prismaMock.auditLog.findMany).not.toHaveBeenCalled();
  });

  it("STAFF cannot access the audit log page", async () => {
    getCurrentUser.mockResolvedValue({ id: "staff-1", role: "STAFF", organizationId: "org-1" });

    await expect(DenetimKayitlariPage({ searchParams: searchParams() })).rejects.toBeInstanceOf(
      RedirectSignal
    );
    expect(prismaMock.auditLog.findMany).not.toHaveBeenCalled();
  });

  it("unauthenticated request redirects to /giris", async () => {
    getCurrentUser.mockResolvedValue(null);

    await expect(DenetimKayitlariPage({ searchParams: searchParams() })).rejects.toThrow(
      "REDIRECT:/giris"
    );
  });
});

describe("DenetimKayitlariPage — query contract (pagination, select scoping)", () => {
  it("ADMIN's query uses the exact select/orderBy/pagination shape — no passwordHash, token, or other sensitive field is ever selected", async () => {
    await DenetimKayitlariPage({ searchParams: searchParams() });

    expect(prismaMock.auditLog.findMany).toHaveBeenCalledExactlyOnceWith({
      where: { organizationId: "org-1" },
      select: {
        id: true,
        createdAt: true,
        action: true,
        entity: true,
        before: true,
        after: true,
        user: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: 0,
      take: DEFAULT_PAGE_SIZE,
    });
    expect(prismaMock.auditLog.count).toHaveBeenCalledOnce();
  });

  it("computes skip from the page query param", async () => {
    await DenetimKayitlariPage({ searchParams: searchParams("3") });

    expect(prismaMock.auditLog.findMany).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ skip: (3 - 1) * DEFAULT_PAGE_SIZE, take: DEFAULT_PAGE_SIZE })
    );
  });

  it("Pagination reflects the real totalCount returned by the database, not the page size of the current results", async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([auditRow()]);
    prismaMock.auditLog.count.mockResolvedValue(DEFAULT_PAGE_SIZE + 7);

    const result = await DenetimKayitlariPage({ searchParams: searchParams("2") });

    const [paginationEl] = findAllElements(result, (el) => el.type === Pagination);
    expect(paginationEl).toBeDefined();
    expect(paginationEl.props).toMatchObject({
      basePath: "/denetim-kayitlari",
      page: 2,
      pageSize: DEFAULT_PAGE_SIZE,
      totalCount: DEFAULT_PAGE_SIZE + 7,
    });
  });
});

describe("DenetimKayitlariPage — rendered row content", () => {
  it("renders the actor name, translated action, translated entity, and a formatted timestamp for each row", async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([auditRow()]);
    prismaMock.auditLog.count.mockResolvedValue(1);

    const result = await DenetimKayitlariPage({ searchParams: searchParams() });
    const rendered = textContent(result);

    expect(rendered).toContain("Yönetici Kullanıcı"); // actor
    expect(rendered).toContain("Güncellendi"); // ACTION_LABELS.UPDATE
    expect(rendered).toContain("Kullanıcı"); // ENTITY_LABELS.User
    expect(rendered).toContain(auditRow().createdAt.toLocaleString("tr-TR")); // timestamp
  });

  it("renders the actual before/after change detail (e.g. a role change), not a placeholder", async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([auditRow()]);
    prismaMock.auditLog.count.mockResolvedValue(1);

    const result = await DenetimKayitlariPage({ searchParams: searchParams() });
    const rendered = textContent(result);

    expect(rendered).toContain("Rol:");
    expect(rendered).toContain("Oda Yetkilisi"); // ROLE_LABELS.STAFF
    expect(rendered).toContain("Yönetici"); // ROLE_LABELS.ADMIN
  });

  it("does not render a passwordHash, token, or other sensitive value even if present in the stored before/after JSON", async () => {
    // Defense in depth: describeUserChange only ever reads a fixed
    // allowlist of fields (name/email/role/isActive/passwordChanged) off
    // the parsed JSON — it never dumps the whole object — so an
    // unexpected extra key must never leak into the rendered detail text,
    // even if a future write-site regression stored one.
    prismaMock.auditLog.findMany.mockResolvedValue([
      auditRow({
        before: JSON.stringify({
          name: "Ahmet Yılmaz",
          email: "ahmet@example.com",
          role: "STAFF",
          passwordHash: "scrypt-hash-should-never-render",
        }),
        after: JSON.stringify({
          name: "Ahmet Yılmaz",
          email: "ahmet@example.com",
          role: "ADMIN",
          passwordHash: "scrypt-hash-should-never-render",
          sessionToken: "should-also-never-render",
        }),
      }),
    ]);
    prismaMock.auditLog.count.mockResolvedValue(1);

    const result = await DenetimKayitlariPage({ searchParams: searchParams() });
    const rendered = textContent(result);

    expect(rendered).not.toContain("scrypt-hash-should-never-render");
    expect(rendered).not.toContain("should-also-never-render");
  });

  it("renders the empty state with its exact title when there are no audit records", async () => {
    // EmptyState receives its text as named props (title/description), not
    // JSX children, so it's asserted on the component's own props — the
    // same pattern used above for Pagination — rather than a generic
    // children-walking textContent() call, which would never reach them.
    const result = await DenetimKayitlariPage({ searchParams: searchParams() });

    const [emptyStateEl] = findAllElements(result, (el) => el.type === EmptyState);
    expect(emptyStateEl).toBeDefined();
    expect(emptyStateEl.props).toMatchObject({
      title: "Henüz bir denetim kaydı bulunmuyor.",
    });
  });

  it("does not render the empty state when audit records exist", async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([auditRow()]);
    prismaMock.auditLog.count.mockResolvedValue(1);

    const result = await DenetimKayitlariPage({ searchParams: searchParams() });

    const emptyStateEls = findAllElements(result, (el) => el.type === EmptyState);
    expect(emptyStateEls).toHaveLength(0);
  });
});
