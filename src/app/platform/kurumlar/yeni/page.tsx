import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OrganizationCreateForm } from "../organization-create-form";

export default function YeniKurumPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Yeni Oda Oluştur</h1>
      <Card>
        <CardHeader>
          <CardTitle>Oda ve İlk Yönetici Bilgileri</CardTitle>
        </CardHeader>
        <CardContent>
          <OrganizationCreateForm />
        </CardContent>
      </Card>
    </div>
  );
}
