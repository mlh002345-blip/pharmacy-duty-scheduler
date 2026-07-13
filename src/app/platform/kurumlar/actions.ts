"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/auth/platform";
import { hashPassword } from "@/lib/auth/password";
import {
  assertLastActiveOrganizationNotDeactivated,
  LastActiveOrganizationError,
} from "@/lib/auth/organization-guard";
import { writeAuditLog } from "@/lib/audit";
import { redirectWithMessage } from "@/lib/flash-redirect";
import {
  createOrganizationSchema,
  updateOrganizationSchema,
  normalizeOrganizationSlug,
} from "@/lib/validations/organization";
import { type ActionState, zodErrorState } from "@/lib/action-state";

const DUPLICATE_SLUG_STATE: ActionState = {
  success: false,
  message: "Bu kısa ad (slug) zaten kullanılıyor.",
  errors: { slug: ["Bu kısa ad (slug) zaten kullanılıyor."] },
};

const DUPLICATE_EMAIL_STATE: ActionState = {
  success: false,
  message: "Bu e-posta adresi zaten kullanılıyor.",
  errors: { adminEmail: ["Bu e-posta adresi zaten kullanılıyor."] },
};

function isUniqueConstraintError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

// A race can slip past the pre-checks below (two concurrent requests
// both read "no duplicate" before either writes) — the DB constraint is
// the real guarantee, this just maps its target column back to the
// right form field instead of a raw Prisma error.
function duplicateFieldStateFromError(error: Prisma.PrismaClientKnownRequestError): ActionState {
  const target = error.meta?.target;
  const targets = Array.isArray(target) ? target : typeof target === "string" ? [target] : [];
  if (targets.includes("slug")) return DUPLICATE_SLUG_STATE;
  if (targets.includes("email")) return DUPLICATE_EMAIL_STATE;
  return {
    success: false,
    message: "Bu bilgilerle bir kayıt zaten mevcut.",
  };
}

// Never included in an audit log's `after` payload — passwordHash and any
// raw password must never reach AuditLog.after, only safe identifiers.
function sanitizeOrganization(organization: { id: string; name: string; province: string; slug: string; isActive: boolean }) {
  return {
    name: organization.name,
    province: organization.province,
    slug: organization.slug,
    isActive: organization.isActive,
  };
}

export async function createOrganizationAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const platformAdmin = await requirePlatformAdmin();

  const parsed = createOrganizationSchema.safeParse({
    name: formData.get("name"),
    province: formData.get("province"),
    slug: formData.get("slug") ?? "",
    isActive: formData.get("isActive") === "on",
    adminName: formData.get("adminName"),
    adminEmail: formData.get("adminEmail"),
    adminPassword: formData.get("adminPassword"),
  });
  if (!parsed.success) {
    return zodErrorState(parsed.error, "Lütfen formdaki hataları düzeltin.");
  }

  const slug = normalizeOrganizationSlug(parsed.data.slug, parsed.data.name);
  if (!slug) {
    return {
      success: false,
      message: "Geçerli bir kısa ad (slug) üretilemedi. Lütfen oda adını veya kısa adı düzenleyin.",
      errors: { slug: ["Geçerli bir kısa ad (slug) üretilemedi."] },
    };
  }

  const [existingSlug, existingEmail] = await Promise.all([
    prisma.organization.findUnique({ where: { slug } }),
    prisma.user.findUnique({ where: { email: parsed.data.adminEmail } }),
  ]);
  if (existingSlug) return DUPLICATE_SLUG_STATE;
  if (existingEmail) return DUPLICATE_EMAIL_STATE;

  const passwordHash = await hashPassword(parsed.data.adminPassword);

  let createdOrganizationId: string;
  try {
    createdOrganizationId = await prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          name: parsed.data.name,
          province: parsed.data.province,
          slug,
          isActive: parsed.data.isActive,
        },
      });

      const admin = await tx.user.create({
        data: {
          name: parsed.data.adminName,
          email: parsed.data.adminEmail,
          passwordHash,
          role: "ADMIN",
          // First ADMIN can only be usable if the organization itself is
          // active — an inactive organization must not have a working
          // login path.
          isActive: parsed.data.isActive,
          organizationId: organization.id,
        },
      });

      await writeAuditLog(tx, {
        organizationId: organization.id,
        userId: platformAdmin.id,
        action: "CREATE",
        entity: "Organization",
        entityId: organization.id,
        after: {
          organizationId: organization.id,
          slug: organization.slug,
          createdAdminUserId: admin.id,
          platformActorId: platformAdmin.id,
        },
      });

      return organization.id;
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return duplicateFieldStateFromError(error);
    }
    throw error;
  }

  revalidatePath("/platform/kurumlar");
  redirectWithMessage(`/platform/kurumlar/${createdOrganizationId}`, "success", "Oda oluşturuldu.");
}

export async function updateOrganizationAction(
  id: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const platformAdmin = await requirePlatformAdmin();

  const parsed = updateOrganizationSchema.safeParse({
    name: formData.get("name"),
    province: formData.get("province"),
    slug: formData.get("slug") ?? "",
  });
  if (!parsed.success) {
    return zodErrorState(parsed.error, "Lütfen formdaki hataları düzeltin.");
  }

  const before = await prisma.organization.findUnique({ where: { id } });
  if (!before) {
    return { success: false, message: "Oda bulunamadı." };
  }

  const slug = normalizeOrganizationSlug(parsed.data.slug, parsed.data.name);
  if (!slug) {
    return {
      success: false,
      message: "Geçerli bir kısa ad (slug) üretilemedi. Lütfen oda adını veya kısa adı düzenleyin.",
      errors: { slug: ["Geçerli bir kısa ad (slug) üretilemedi."] },
    };
  }

  const duplicateSlug = await prisma.organization.findFirst({
    where: { slug, NOT: { id } },
  });
  if (duplicateSlug) return DUPLICATE_SLUG_STATE;

  try {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.organization.update({
        where: { id },
        data: {
          name: parsed.data.name,
          province: parsed.data.province,
          slug,
        },
      });
      await writeAuditLog(tx, {
        organizationId: updated.id,
        userId: platformAdmin.id,
        action: "UPDATE",
        entity: "Organization",
        entityId: updated.id,
        before: sanitizeOrganization(before),
        after: sanitizeOrganization(updated),
      });
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return duplicateFieldStateFromError(error);
    }
    throw error;
  }

  revalidatePath("/platform/kurumlar");
  revalidatePath(`/platform/kurumlar/${id}`);
  redirectWithMessage(`/platform/kurumlar/${id}`, "success", "Oda güncellendi.");
}

// Deactivation is the moment a policy decision has to be made about
// existing sessions: rather than leave already-issued Session rows
// valid until their natural 7-day expiry (during which
// getCurrentUser()'s organization.isActive check would still reject
// every request, but the row itself would linger), every session
// belonging to this organization's users is deleted in the same
// transaction as the isActive flip. Reactivating never resurrects them —
// affected users simply log in again, exactly like any other expired
// session.
export async function setOrganizationStatusAction(id: string, isActive: boolean) {
  const platformAdmin = await requirePlatformAdmin();

  const organization = await prisma.organization.findUnique({ where: { id } });
  if (!organization) {
    redirectWithMessage("/platform/kurumlar", "error", "Oda bulunamadı.");
  }

  try {
    await prisma.$transaction(async (tx) => {
      if (isActive === false) {
        await assertLastActiveOrganizationNotDeactivated(tx);
      }

      const updated = await tx.organization.update({
        where: { id },
        data: { isActive },
      });

      if (isActive === false) {
        await tx.session.deleteMany({ where: { user: { organizationId: id } } });
      }

      await writeAuditLog(tx, {
        organizationId: updated.id,
        userId: platformAdmin.id,
        action: "UPDATE",
        entity: "Organization",
        entityId: updated.id,
        before: sanitizeOrganization(organization),
        after: sanitizeOrganization(updated),
      });
    });
  } catch (error) {
    if (error instanceof LastActiveOrganizationError) {
      redirectWithMessage("/platform/kurumlar", "error", error.message);
    }
    throw error;
  }

  revalidatePath("/platform/kurumlar");
  revalidatePath(`/platform/kurumlar/${id}`);
  redirectWithMessage(
    "/platform/kurumlar",
    "success",
    isActive ? "Oda aktif yapıldı." : "Oda pasif yapıldı."
  );
}
