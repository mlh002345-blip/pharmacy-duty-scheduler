import { notFound } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { HolidayForm } from "../../holiday-form";
import { updateHolidayAction } from "../../actions";

export default async function TatilGunuDuzenlePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const holiday = await prisma.holiday.findUnique({ where: { id } });
  if (!holiday) notFound();

  const action = updateHolidayAction.bind(null, id);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Tatil Gününü Düzenle</h1>
      <Card>
        <CardHeader>
          <CardTitle>Tatil Günü Bilgileri</CardTitle>
        </CardHeader>
        <CardContent>
          <HolidayForm action={action} holiday={holiday} />
        </CardContent>
      </Card>
    </div>
  );
}
