import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePermissionOrRedirectWithMessage } from "@/lib/auth/guard";
import { UserForm } from "../user-form";
import { createUserAction } from "../actions";

export default async function YeniKullaniciPage() {
  await requirePermissionOrRedirectWithMessage(
    "manageUsers",
    "/",
    "Bu sayfaya erişim yetkiniz bulunmuyor."
  );

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Yeni Kullanıcı</h1>
      <Card>
        <CardHeader>
          <CardTitle>Kullanıcı Bilgileri</CardTitle>
        </CardHeader>
        <CardContent>
          <UserForm action={createUserAction} />
        </CardContent>
      </Card>
    </div>
  );
}
