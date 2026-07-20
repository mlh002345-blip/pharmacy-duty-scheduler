"use server";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { getClientIdentity } from "@/lib/security/client-identity";
import { isSelfSignupRateLimited, recordSelfSignupAttempt } from "@/lib/auth/self-signup-rate-limit";
import { writeAuditLog } from "@/lib/audit";
import { redirectWithMessage } from "@/lib/flash-redirect";
import { selfServiceSignupSchema, normalizeOrganizationSlug } from "@/lib/validations/organization";
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

const RATE_LIMITED_STATE: ActionState = {
  success: false,
  message: "Çok fazla kayıt denemesi yapıldı. Lütfen bir süre sonra tekrar deneyin.",
};

function isUniqueConstraintError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

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

// Halka açık, platform yöneticisi gerektirmeyen oda kayıt formu — bkz.
// CLAUDE.md'nin MVP kapsamı dışı tuttuğu "payment": bu akış hiçbir ödeme
// almaz, yalnızca oda + ilk Yönetici hesabını otomatik açar; faturalama
// platform ekibi tarafından ayrıca ve manuel yürütülür.
export async function createSelfServiceOrganizationAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = selfServiceSignupSchema.safeParse({
    name: formData.get("name"),
    province: formData.get("province"),
    slug: formData.get("slug") ?? "",
    adminName: formData.get("adminName"),
    adminEmail: formData.get("adminEmail"),
    adminPassword: formData.get("adminPassword"),
    adminPasswordConfirmation: formData.get("adminPasswordConfirmation"),
  });
  if (!parsed.success) {
    return zodErrorState(parsed.error, "Lütfen formdaki hataları düzeltin.");
  }

  const { networkBucketKey } = await getClientIdentity();
  if (await isSelfSignupRateLimited(networkBucketKey)) {
    return RATE_LIMITED_STATE;
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

  let createdAdminId: string;
  try {
    createdAdminId = await prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          name: parsed.data.name,
          province: parsed.data.province,
          slug,
          isActive: true,
        },
      });

      const admin = await tx.user.create({
        data: {
          name: parsed.data.adminName,
          email: parsed.data.adminEmail,
          passwordHash,
          role: "ADMIN",
          isActive: true,
          organizationId: organization.id,
        },
      });

      // Bu kaydı yapan bir platform yöneticisi yok — eylemin sahibi,
      // oluşturulan hesabın kendisi.
      await writeAuditLog(tx, {
        organizationId: organization.id,
        userId: admin.id,
        action: "CREATE",
        entity: "Organization",
        entityId: organization.id,
        after: {
          organizationId: organization.id,
          slug: organization.slug,
          createdAdminUserId: admin.id,
          selfService: true,
        },
      });

      return admin.id;
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return duplicateFieldStateFromError(error);
    }
    throw error;
  }

  await recordSelfSignupAttempt(networkBucketKey);
  await createSession(createdAdminId);

  redirectWithMessage("/", "success", "Odanız oluşturuldu. Hoş geldiniz!");
}
