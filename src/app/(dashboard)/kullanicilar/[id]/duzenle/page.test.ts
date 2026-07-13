import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

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
  user: { findFirst: vi.fn() },
};
const getCurrentUser = vi.fn();
const notFound = vi.fn(() => {
  throw new Error("NOT_FOUND");
});
const redirect = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: (...args: unknown[]) => getCurrentUser(...args),
}));
vi.mock("next/navigation", () => ({
  notFound: () => notFound(),
  redirect: (...args: [string]) => redirect(...args),
}));
vi.mock("@/lib/flash-redirect", () => ({
  redirectWithMessage: (path: string, kind: "success" | "error", message: string) => {
    throw new RedirectSignal(path, kind, message);
  },
}));
vi.mock("../../actions", () => ({
  updateUserAction: vi.fn(),
}));

const KullaniciDuzenlePage = (await import("./page")).default;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("KullaniciDuzenlePage — passwordHash must never reach the client", () => {
  it("queries only the fields the edit form needs, excluding passwordHash", async () => {
    getCurrentUser.mockResolvedValue({ id: "admin-1", role: "ADMIN", organizationId: "org-1" });
    prismaMock.user.findFirst.mockResolvedValue({
      id: "user-1",
      name: "Test Kullanıcı",
      email: "test@example.com",
      role: "STAFF",
      isActive: true,
    });

    await KullaniciDuzenlePage({ params: Promise.resolve({ id: "user-1" }) });

    expect(prismaMock.user.findFirst).toHaveBeenCalledExactlyOnceWith({
      where: { id: "user-1", organizationId: "org-1" },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
      },
    });
  });

  it("passes the fetched (select-scoped) user straight through to UserForm", async () => {
    getCurrentUser.mockResolvedValue({ id: "admin-1", role: "ADMIN", organizationId: "org-1" });
    const scopedUser = {
      id: "user-1",
      name: "Test Kullanıcı",
      email: "test@example.com",
      role: "STAFF" as const,
      isActive: true,
    };
    prismaMock.user.findFirst.mockResolvedValue(scopedUser);

    const result = (await KullaniciDuzenlePage({
      params: Promise.resolve({ id: "user-1" }),
    })) as ReactElement;

    const userFormElement = findUserFormElement(result);
    expect(userFormElement).toBeDefined();
    const props = userFormElement!.props as { user?: Record<string, unknown> };
    expect(props.user).toEqual(scopedUser);
    expect(props.user).not.toHaveProperty("passwordHash");
  });

  it("STAFF cannot access the edit page", async () => {
    getCurrentUser.mockResolvedValue({ id: "staff-1", role: "STAFF", organizationId: "org-1" });

    await expect(
      KullaniciDuzenlePage({ params: Promise.resolve({ id: "user-1" }) })
    ).rejects.toBeInstanceOf(RedirectSignal);
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
  });
});

function findUserFormElement(node: unknown): ReactElement | undefined {
  if (!node || typeof node !== "object") return undefined;
  const element = node as ReactElement & { type?: { name?: string } };
  if (typeof element.type === "function" && element.type.name === "UserForm") {
    return element;
  }
  const children = (element.props as { children?: unknown } | undefined)?.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = findUserFormElement(child);
      if (found) return found;
    }
  } else if (children) {
    return findUserFormElement(children);
  }
  return undefined;
}
