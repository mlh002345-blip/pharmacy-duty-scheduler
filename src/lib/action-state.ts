import type { z } from "zod";

export type ActionState = {
  success: boolean;
  message: string;
  errors?: Record<string, string[]>;
};

export const initialActionState: ActionState = {
  success: false,
  message: "",
};

export function fieldError(
  state: ActionState | undefined,
  field: string
): string | undefined {
  return state?.errors?.[field]?.[0];
}

export function zodErrorState(error: z.ZodError, message: string): ActionState {
  return {
    success: false,
    message,
    errors: error.flatten().fieldErrors as Record<string, string[]>,
  };
}
