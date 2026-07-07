import Link from "next/link";
import { notFound } from "next/navigation";
import { Inbox } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/permissions";
import {
  DUTY_REQUEST_SOURCE_LABELS,
  DUTY_REQUEST_STATUS_BADGE,
  DUTY_REQUEST_STATUS_LABELS,
  DUTY_REQUEST_TYPE_LABELS,
} from "@/lib/duty-requests/labels";
import { reviewDutyRequestAction } from "../actions";
import { DutyRequestReviewForm } from "../review-form";

export const dynamic = "force-dynamic";

export default async function NobetTalepDetayPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const user = await getCurrentUser();
  const canManage = !!user && hasPermission(user.role, "manageSetupData");

  const request = await prisma.dutyRequest.findUnique({
    where: { id },
    select: {
      id: true,
      requestType: true,
      startDate: true,
      endDate: true,
      explanation: true,
      status: true,
      source: true,
      reviewNote: true,
      reviewedAt: true,
      createdAt: true,
      pharmacy: { select: { name: true, phone: true } },
      region: { select: { name: true } },
      reviewedBy: { select: { name: true } },
    },
  });
  if (!request) notFound();

  const reviewable =
    canManage && (request.status === "PENDING" || request.status === "LATE");

  const fields = [
    { label: "Eczane", value: request.pharmacy.name },
    { label: "Telefon", value: request.pharmacy.phone },
    { label: "Bölge", value: request.region?.name ?? "-" },
    { label: "Talep Türü", value: DUTY_REQUEST_TYPE_LABELS[request.requestType] },
    {
      label: "Tarih Aralığı",
      value: `${request.startDate.toLocaleDateString("tr-TR")} – ${request.endDate.toLocaleDateString("tr-TR")}`,
    },
    { label: "Kaynak", value: DUTY_REQUEST_SOURCE_LABELS[request.source] },
    { label: "Oluşturulma", value: request.createdAt.toLocaleString("tr-TR") },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="bg-primary/10 text-primary mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl">
            <Inbox className="size-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl font-semibold tracking-tight">Talep Detayı</h1>
              <Badge variant={DUTY_REQUEST_STATUS_BADGE[request.status]}>
                {DUTY_REQUEST_STATUS_LABELS[request.status]}
              </Badge>
            </div>
            <p className="text-muted-foreground mt-0.5 text-sm">
              {request.pharmacy.name} — {DUTY_REQUEST_TYPE_LABELS[request.requestType]}
            </p>
          </div>
        </div>
        <Button variant="outline" asChild>
          <Link href="/nobet-talepleri">Listeye Dön</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Talep Bilgileri</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
            {fields.map((field) => (
              <div key={field.label} className="flex flex-col gap-0.5">
                <dt className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                  {field.label}
                </dt>
                <dd className="text-sm">{field.value}</dd>
              </div>
            ))}
            <div className="flex flex-col gap-0.5 sm:col-span-2">
              <dt className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                Açıklama
              </dt>
              <dd className="text-sm">{request.explanation}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {(request.reviewedBy || request.reviewNote) && (
        <Card>
          <CardHeader>
            <CardTitle>İnceleme Bilgisi</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <p>
              <span className="text-muted-foreground">İnceleyen:</span>{" "}
              {request.reviewedBy?.name ?? "-"}
              {request.reviewedAt && (
                <span className="text-muted-foreground">
                  {" "}
                  ({request.reviewedAt.toLocaleString("tr-TR")})
                </span>
              )}
            </p>
            {request.reviewNote && (
              <p className="mt-1.5">
                <span className="text-muted-foreground">Not:</span> {request.reviewNote}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {reviewable && (
        <Card>
          <CardHeader>
            <CardTitle>Talebi İncele</CardTitle>
            <CardDescription>
              Onaylanan &quot;Nöbet Tutamama&quot; ve &quot;Acil Mazeret&quot; talepleri,
              çizelge oluşturulurken ilgili tarihlerde eczaneyi otomatik olarak hariç
              tutar. &quot;Nöbet Tercihi&quot; talepleri bilgi amaçlı dikkate alınır;
              &quot;Nöbet Değişimi&quot; talepleri manuel atama düzenlemesiyle sonuçlandırılır.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DutyRequestReviewForm action={reviewDutyRequestAction.bind(null, request.id)} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
