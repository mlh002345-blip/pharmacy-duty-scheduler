import type { ActionState } from "@/lib/action-state";

export type EditAssignmentActionState = ActionState & {
  requiresConfirmation?: boolean;
  warning?: string;
};

export const initialEditAssignmentState: EditAssignmentActionState = {
  success: false,
  message: "",
};
