// Duty Rules V2 core schema phase: the ONLY JSON column in the new
// tables is RotationState.carriedForward, and its shape is deliberately
// minimal and validated here — a small list of memberships owed a turn,
// never a generic configuration blob. Nothing reads or writes this in
// production yet (no engine exists); the future rotation engine must
// parse through this schema on every read and write.

import { z } from "zod";

export const carriedForwardEntrySchema = z.object({
  // The RotationPoolMembership owed the turn (not the pharmacy id:
  // memberships are temporal, and the debt belongs to the membership
  // period in which it was incurred).
  membershipId: z.string().min(1),
  reason: z.enum(["SKIPPED", "UNAVAILABLE"]),
  // The period in which the turn was missed, e.g. "2026-07" — an opaque
  // key for reporting, never parsed into behavior here.
  periodKey: z.string().min(1).max(20),
});

export const carriedForwardSchema = z.array(carriedForwardEntrySchema).max(500);

export type CarriedForwardEntry = z.infer<typeof carriedForwardEntrySchema>;

export function parseCarriedForward(value: unknown): CarriedForwardEntry[] {
  return carriedForwardSchema.parse(value ?? []);
}
