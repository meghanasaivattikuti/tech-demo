// separate from app/actions.ts since that file has "use server" at the top
// and can only export async server actions - a plain const array can't
// live there, so both the action and the client form import it from here
export const ALLOWED_ACTIONS = [
  "Permanently Ineligible",
  "Suspended, 5 years",
  "Suspended, 3 years",
  "Suspended, 2 years",
  "Suspended, 1 year",
  "Probation, 2 years",
] as const;

export const ALLOWED_ACTIONS_SET: ReadonlySet<string> = new Set(ALLOWED_ACTIONS);

const PERMANENT = "Permanently Ineligible";
const PROBATION = "Probation, 2 years";

// just a default the picker starts on, server still enforces
// ALLOWED_ACTIONS regardless of what gets picked
export function suggestNextAction(currentActionTaken: string): string {
  return currentActionTaken === PERMANENT ? PROBATION : PERMANENT;
}
