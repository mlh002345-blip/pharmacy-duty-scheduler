import { describe, expect, it } from "vitest";

import {
  createOrganizationSchema,
  updateOrganizationSchema,
  updateOrganizationBillingSchema,
  normalizeOrganizationSlug,
} from "./organization";

const validCreateInput = {
  name: "Örnek Eczacı Odası",
  province: "İstanbul",
  slug: "",
  isActive: true,
  adminName: "Ada Yönetici",
  adminEmail: "ada@example.com",
  adminPassword: "password123",
};

describe("createOrganizationSchema", () => {
  it("accepts a fully valid payload", () => {
    const result = createOrganizationSchema.safeParse(validCreateInput);
    expect(result.success).toBe(true);
  });

  it("rejects an empty name", () => {
    const result = createOrganizationSchema.safeParse({ ...validCreateInput, name: "  " });
    expect(result.success).toBe(false);
  });

  it("rejects an empty province", () => {
    const result = createOrganizationSchema.safeParse({ ...validCreateInput, province: "  " });
    expect(result.success).toBe(false);
  });

  it("rejects a name containing control characters", () => {
    const result = createOrganizationSchema.safeParse({
      ...validCreateInput,
      name: "Zararli Ad\x07",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a name over 120 characters", () => {
    const result = createOrganizationSchema.safeParse({
      ...validCreateInput,
      name: "a".repeat(121),
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid admin email", () => {
    const result = createOrganizationSchema.safeParse({
      ...validCreateInput,
      adminEmail: "not-an-email",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an admin password under 8 characters", () => {
    const result = createOrganizationSchema.safeParse({
      ...validCreateInput,
      adminPassword: "short",
    });
    expect(result.success).toBe(false);
  });

  it("defaults isActive to true when omitted", () => {
    const withoutIsActive: Record<string, unknown> = { ...validCreateInput };
    delete withoutIsActive.isActive;
    const result = createOrganizationSchema.safeParse(withoutIsActive);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isActive).toBe(true);
    }
  });
});

describe("updateOrganizationSchema", () => {
  it("accepts a valid payload without admin fields", () => {
    const result = updateOrganizationSchema.safeParse({
      name: "Güncellenmiş Oda",
      province: "Ankara",
      slug: "guncellenmis-oda",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a slug over 60 characters", () => {
    const result = updateOrganizationSchema.safeParse({
      name: "Oda",
      province: "Ankara",
      slug: "a".repeat(61),
    });
    expect(result.success).toBe(false);
  });
});

describe("updateOrganizationBillingSchema", () => {
  it("accepts a valid status without notes", () => {
    const result = updateOrganizationBillingSchema.safeParse({ billingStatus: "TRIAL" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.billingNotes).toBeUndefined();
    }
  });

  it("accepts each valid BillingStatus literal", () => {
    for (const status of ["TRIAL", "ACTIVE", "PAST_DUE", "CANCELED"]) {
      const result = updateOrganizationBillingSchema.safeParse({ billingStatus: status });
      expect(result.success).toBe(true);
    }
  });

  it("rejects an invalid status", () => {
    const result = updateOrganizationBillingSchema.safeParse({ billingStatus: "PAID" });
    expect(result.success).toBe(false);
  });

  it("accepts and trims a valid notes string", () => {
    const result = updateOrganizationBillingSchema.safeParse({
      billingStatus: "ACTIVE",
      billingNotes: "  Yıllık sözleşme  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.billingNotes).toBe("Yıllık sözleşme");
    }
  });

  it("treats a blank notes string as undefined", () => {
    const result = updateOrganizationBillingSchema.safeParse({
      billingStatus: "ACTIVE",
      billingNotes: "",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.billingNotes).toBeUndefined();
    }
  });

  it("rejects notes over 500 characters", () => {
    const result = updateOrganizationBillingSchema.safeParse({
      billingStatus: "ACTIVE",
      billingNotes: "a".repeat(501),
    });
    expect(result.success).toBe(false);
  });

  it("rejects notes containing control characters", () => {
    const result = updateOrganizationBillingSchema.safeParse({
      billingStatus: "ACTIVE",
      billingNotes: "Zararli not\x07",
    });
    expect(result.success).toBe(false);
  });
});

describe("normalizeOrganizationSlug", () => {
  it("transliterates and slugifies an operator-supplied slug", () => {
    expect(normalizeOrganizationSlug("İstanbul Eczacı Odası!!", "unused")).toBe(
      "istanbul-eczaci-odasi"
    );
  });

  it("falls back to slugifying the name when the slug is blank", () => {
    expect(normalizeOrganizationSlug("", "Şanlıurfa Eczacı Odası")).toBe(
      "sanliurfa-eczaci-odasi"
    );
  });

  it("produces the same slug whether it comes from the name or an equivalent operator-supplied slug", () => {
    const fromName = normalizeOrganizationSlug("", "Muğla Eczacı Odası");
    const fromSlug = normalizeOrganizationSlug("Muğla Eczacı Odası", "unused");
    expect(fromName).toBe(fromSlug);
  });
});
