"use client";

import { useActionState } from "react";
import { Bell, Mail, MessageSquare, Send } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SubmitButton } from "@/components/layout/submit-button";
import {
  initialNotificationState,
  type NotificationActionState,
} from "./notification-state";

type PreviewAction = (
  state: NotificationActionState,
  formData: FormData
) => Promise<NotificationActionState>;

export function NotificationsSection({
  isPublished,
  previewAction,
  simulateAction,
}: {
  isPublished: boolean;
  previewAction: PreviewAction;
  simulateAction: () => Promise<void>;
}) {
  const [state, formAction, isPending] = useActionState(
    previewAction,
    initialNotificationState
  );

  const showSms = state.channel === "ALL" || state.channel === "SMS";
  const showEmail = state.channel === "ALL" || state.channel === "EMAIL";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="text-primary size-4.5" />
          Nöbet Bildirimleri
        </CardTitle>
        <CardDescription>
          Yayınlanan çizelge için eczanelere gidecek SMS ve e-posta mesajlarını
          önizleyin. Bu sürümde gerçek gönderim yapılmaz; simülasyon yalnızca
          bildirim kaydı oluşturur.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!isPublished ? (
          <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-6 text-center text-sm">
            Bildirim göndermek için çizelgeyi önce yayınlayın.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <form action={formAction} className="flex flex-wrap gap-2">
                <Button
                  type="submit"
                  name="channel"
                  value="ALL"
                  variant="outline"
                  disabled={isPending}
                >
                  <Bell className="size-4" />
                  {isPending ? "Hazırlanıyor..." : "Bildirimleri Önizle"}
                </Button>
                <Button
                  type="submit"
                  name="channel"
                  value="EMAIL"
                  variant="outline"
                  disabled={isPending}
                >
                  <Mail className="size-4" />
                  E-posta Önizle
                </Button>
                <Button
                  type="submit"
                  name="channel"
                  value="SMS"
                  variant="outline"
                  disabled={isPending}
                >
                  <MessageSquare className="size-4" />
                  SMS Önizle
                </Button>
              </form>
              <form
                action={simulateAction}
                onSubmit={(e) => {
                  if (
                    !confirm(
                      "Bildirim simülasyonu çalıştırılacak: gerçek SMS/e-posta GÖNDERİLMEZ, yalnızca bildirim kaydı oluşturulur. Devam edilsin mi?"
                    )
                  ) {
                    e.preventDefault();
                  }
                }}
              >
                <SubmitButton variant="secondary" pendingText="Simülasyon çalışıyor...">
                  <Send className="size-4" />
                  Simülasyon Gönderimi Yap
                </SubmitButton>
              </form>
            </div>

            {!state.success && state.message && (
              <p className="text-destructive text-sm">{state.message}</p>
            )}

            {state.summary && (
              <div className="flex flex-wrap gap-2 text-sm">
                <Badge variant="success">
                  {state.summary.emailReady} eczaneye e-posta gönderilebilir
                </Badge>
                <Badge variant="success">
                  {state.summary.smsReady} eczaneye SMS gönderilebilir
                </Badge>
                {state.summary.missingPhone > 0 && (
                  <Badge variant="warning">
                    {state.summary.missingPhone} eczanenin telefon bilgisi eksik
                  </Badge>
                )}
                {state.summary.missingEmail > 0 && (
                  <Badge variant="warning">
                    {state.summary.missingEmail} eczanenin e-posta bilgisi eksik
                  </Badge>
                )}
              </div>
            )}

            {state.rows && state.rows.length > 0 && (
              <div className="max-h-96 overflow-y-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Eczane</TableHead>
                      <TableHead>Tarih</TableHead>
                      {showSms && <TableHead>Telefon</TableHead>}
                      {showEmail && <TableHead>E-posta</TableHead>}
                      <TableHead>Kanal</TableHead>
                      <TableHead>Mesaj</TableHead>
                      <TableHead>Durum</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {state.rows.map((row) => (
                      <TableRow key={row.pharmacyName}>
                        <TableCell className="font-medium">{row.pharmacyName}</TableCell>
                        <TableCell>{row.dutyDates.join(", ")}</TableCell>
                        {showSms && <TableCell>{row.phone ?? "-"}</TableCell>}
                        {showEmail && <TableCell>{row.email ?? "-"}</TableCell>}
                        <TableCell>
                          {state.channel === "SMS"
                            ? "SMS"
                            : state.channel === "EMAIL"
                              ? "E-posta"
                              : "SMS + E-posta"}
                        </TableCell>
                        <TableCell className="max-w-[320px]">
                          <span
                            className="text-muted-foreground block truncate text-xs"
                            title={
                              state.channel === "EMAIL" ? row.emailMessage : row.smsMessage
                            }
                          >
                            {state.channel === "EMAIL"
                              ? `${row.emailSubject} — ${row.emailMessage}`
                              : row.smsMessage}
                          </span>
                        </TableCell>
                        <TableCell>
                          {(showSms && !row.phone) || (showEmail && !row.email) ? (
                            <Badge variant="warning">Eksik bilgi</Badge>
                          ) : (
                            <Badge variant="info">Önizlendi</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
