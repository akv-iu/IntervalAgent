// Token budget per run. Reservations are estimates (about 3 characters per token plus an
// output allowance); they stop runaway runs but do not guarantee a dollar cap.
import type { LlmRequest } from "./types";

export class BudgetExceeded extends Error {}
export const OUTPUT_ALLOWANCE = 400;

export interface Budget {
  reserve(estimate: number): void;
  record(actual: number): void;
  used(): number;
  actual(): number;
}

export function createBudget(maxTokens: number): Budget {
  let reserved = 0;
  let actual = 0;
  return {
    reserve(estimate) {
      if (reserved + estimate > maxTokens) {
        throw new BudgetExceeded(`token budget exceeded: ${reserved} reserved + ${estimate} requested > ${maxTokens} allowed`);
      }
      reserved += estimate;
    },
    record(n) {
      actual += n;
    },
    used: () => reserved,
    actual: () => actual,
  };
}

export function estimateTokens(req: LlmRequest): number {
  const chars = req.system.length + req.messages.reduce((n, m) => n + m.text.length, 0);
  return Math.ceil(chars / 3) + OUTPUT_ALLOWANCE;
}
