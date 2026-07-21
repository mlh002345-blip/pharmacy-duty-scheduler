"use server";

import { revalidatePath } from "next/cache";

import { requireOrganizationRole } from "@/lib/auth/tenant";
import { sendDutyReminders } from "@/lib/reminders/send-duty-reminders";
import { type ActionState } from "@/lib/action-state";

export async function sendDutyRemindersAction(
  _prevState: ActionState,
  _formData: FormData
): Promise<ActionState> {
  const guard = await requireOrganizationRole("sendReminders");
  if (!guard.user) return guard.state;
  const { user } = guard;

  const result = await sendDutyReminders({
    organizationId: user.organizationId,
    userId: user.id,
  });

  revalidatePath("/panel");

  const parts: string[] = [];
  if (result.sentCount > 0) parts.push(`${result.sentCount} e-posta gönderildi`);
  if (result.missingEmailCount > 0) parts.push(`${result.missingEmailCount} eczanenin e-postası eksik`);
  if (result.alreadySentCount > 0) parts.push(`${result.alreadySentCount} daha önce gönderilmiş`);
  if (result.failedCount > 0) parts.push(`${result.failedCount} gönderim başarısız`);

  const message =
    parts.length > 0
      ? `${result.targetDate} için: ${parts.join(", ")}.`
      : `${result.targetDate} için gönderilecek yayınlanmış bir nöbet ataması bulunamadı.`;

  // Bu eylem hiçbir zaman "başarısız" durumuna düşmez (kısmi gönderim
  // hataları bile mesajda ayrıca raporlanır) — sonuç metni her zaman
  // olumlu/bilgilendirici stille gösterilir.
  return { success: true, message };
}
