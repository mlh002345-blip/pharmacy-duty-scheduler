"use client";

import { useActionState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ConfirmSubmitForm } from "@/components/layout/confirm-submit-form";
import { initialActionState } from "@/lib/action-state";
import type { RotationStrategyValue } from "@/lib/duty-rules-v2/domain/loaded-plan";
import {
  createRotationPoolAction,
  addPoolMembershipAction,
  addPoolMembershipsByServiceAreaAction,
  endPoolMembershipAction,
} from "./actions";

const STRATEGY_LABELS: Record<RotationStrategyValue, string> = {
  SEQUENTIAL: "Sıralı",
  FAIRNESS_SCORE: "Adalet Puanına Göre",
  WEIGHTED: "Ağırlıklı",
  MANUAL_ORDER: "Manuel Sıra",
};

type Pool = {
  id: string;
  name: string;
  strategy: RotationStrategyValue;
  memberships: {
    id: string;
    pharmacyId: string;
    pharmacyName: string;
    joinedOn: string;
    leftOn: string | null;
  }[];
};

export function RotationPoolsSection({
  planId,
  versionId,
  regionId,
  pools,
  activePharmacies,
  serviceAreas,
  editable,
}: {
  planId: string;
  versionId: string;
  regionId: string;
  pools: Pool[];
  activePharmacies: { id: string; name: string }[];
  serviceAreas: { id: string; name: string }[];
  editable: boolean;
}) {
  const createAction = createRotationPoolAction.bind(null, planId, versionId, regionId);
  const [createState, createFormAction, createPending] = useActionState(
    createAction,
    initialActionState
  );

  const addMembershipAction = addPoolMembershipAction.bind(null, planId, versionId);
  const [addState, addFormAction, addPending] = useActionState(addMembershipAction, initialActionState);

  const addByAreaAction = addPoolMembershipsByServiceAreaAction.bind(null, planId, versionId);
  const [addByAreaState, addByAreaFormAction, addByAreaPending] = useActionState(
    addByAreaAction,
    initialActionState
  );

  return (
    <div className="flex flex-col gap-4">
      {pools.map((pool) => {
        const memberPharmacyIds = new Set(
          pool.memberships.filter((m) => m.leftOn === null).map((m) => m.pharmacyId)
        );
        const eligiblePharmacies = activePharmacies.filter((p) => !memberPharmacyIds.has(p.id));

        return (
          <Card key={pool.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {pool.name}
                <Badge variant="outline">{STRATEGY_LABELS[pool.strategy]}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Eczane</TableHead>
                    <TableHead>Katılım</TableHead>
                    <TableHead>Ayrılış</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pool.memberships.map((membership) => (
                    <TableRow key={membership.id}>
                      <TableCell>{membership.pharmacyName}</TableCell>
                      <TableCell>{membership.joinedOn}</TableCell>
                      <TableCell>{membership.leftOn ?? "—"}</TableCell>
                      <TableCell>
                        {editable && membership.leftOn === null && (
                          <ConfirmSubmitForm
                            action={endPoolMembershipAction.bind(
                              null,
                              planId,
                              versionId,
                              membership.id
                            )}
                            confirmMessage={`${membership.pharmacyName} bu havuzdan ayrılsın mı?`}
                            variant="outline"
                          >
                            Ayrıl
                          </ConfirmSubmitForm>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {editable && (
                <form action={addFormAction} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="poolId" value={pool.id} />
                  <div className="flex flex-col gap-1">
                    <Label htmlFor={`pharmacyId-${pool.id}`} className="text-xs">
                      Eczane
                    </Label>
                    <Select
                      id={`pharmacyId-${pool.id}`}
                      name="pharmacyId"
                      defaultValue=""
                      required
                      className="h-8 w-48"
                    >
                      <option value="">Seçiniz</option>
                      {eligiblePharmacies.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor={`joinedAt-${pool.id}`} className="text-xs">
                      Katılım Tarihi
                    </Label>
                    <Input id={`joinedAt-${pool.id}`} type="date" name="joinedAt" required className="h-8" />
                  </div>
                  <Button type="submit" size="sm" disabled={addPending}>
                    Eczane Ekle
                  </Button>
                </form>
              )}
              {!addState.success && addState.message && (
                <p role="alert" className="text-destructive text-sm">
                  {addState.message}
                </p>
              )}
              {addState.success && addState.message && (
                <p className="text-sm text-emerald-700">{addState.message}</p>
              )}

              {editable && serviceAreas.length > 0 && (
                <form action={addByAreaFormAction} className="flex flex-wrap items-end gap-2 border-t pt-3">
                  <input type="hidden" name="poolId" value={pool.id} />
                  <div className="flex flex-col gap-1">
                    <Label htmlFor={`serviceAreaId-${pool.id}`} className="text-xs">
                      Hizmet Alanına Göre Ekle
                    </Label>
                    <Select
                      id={`serviceAreaId-${pool.id}`}
                      name="serviceAreaId"
                      defaultValue=""
                      required
                      className="h-8 w-48"
                    >
                      <option value="">Seçiniz</option>
                      {serviceAreas.map((area) => (
                        <option key={area.id} value={area.id}>
                          {area.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor={`serviceAreaJoinedAt-${pool.id}`} className="text-xs">
                      Katılım Tarihi
                    </Label>
                    <Input
                      id={`serviceAreaJoinedAt-${pool.id}`}
                      type="date"
                      name="joinedAt"
                      required
                      className="h-8"
                    />
                  </div>
                  <Button type="submit" size="sm" variant="outline" disabled={addByAreaPending}>
                    Toplu Ekle
                  </Button>
                </form>
              )}
              {!addByAreaState.success && addByAreaState.message && (
                <p role="alert" className="text-destructive text-sm">
                  {addByAreaState.message}
                </p>
              )}
              {addByAreaState.success && addByAreaState.message && (
                <p className="text-sm text-emerald-700">{addByAreaState.message}</p>
              )}
            </CardContent>
          </Card>
        );
      })}

      {editable && (
        <Card>
          <CardHeader>
            <CardTitle>Yeni Rotasyon Havuzu</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={createFormAction} className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor="new-pool-name" className="text-xs">
                  Ad
                </Label>
                <Input id="new-pool-name" name="name" required className="h-8 w-48" />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="new-pool-strategy" className="text-xs">
                  Strateji
                </Label>
                <Select id="new-pool-strategy" name="strategy" defaultValue="SEQUENTIAL" className="h-8 w-44">
                  {Object.entries(STRATEGY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </div>
              <Button type="submit" size="sm" disabled={createPending}>
                Havuz Oluştur
              </Button>
            </form>
            {!createState.success && createState.message && (
              <p role="alert" className="text-destructive mt-2 text-sm">
                {createState.message}
              </p>
            )}
            {createState.success && createState.message && (
              <p className="mt-2 text-sm text-emerald-700">{createState.message}</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
