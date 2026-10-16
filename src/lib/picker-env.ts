// Synthetic environment for the picker. These probabilities are made-up assumptions, published
// here so anyone can read them. They do not describe real customers. The learner (picker.ts)
// may only call drawOutcome; it never reads this table.
import type { Arm } from "./artifact";
import type { AgingBucket } from "./sim/accounts";
import { createRng } from "./rng";

export const ENV_VERSION = 1;
const JITTER_SEED = 7; // fixed small noise so the table is not purely hand-shaped

// Older debt: fewer replies, and fewer payments after a reply.
const BASE: Record<AgingBucket, { respond: number; pay: number }> = {
  "1-30": { respond: 0.45, pay: 0.6 },
  "31-60": { respond: 0.38, pay: 0.5 },
  "61-90": { respond: 0.3, pay: 0.42 },
  "91-120": { respond: 0.22, pay: 0.34 },
};

// Modest, segment-dependent effects (percentage points).
function effects(segment: AgingBucket, arm: Arm): { respond: number; pay: number } {
  const recent = segment === "1-30" || segment === "31-60";
  let respond = 0;
  let pay = 0;
  respond += arm.channel === "sms" ? (recent ? 0.05 : -0.02) : recent ? -0.02 : 0.04;
  respond += arm.window === "evening" ? (segment === "31-60" || segment === "61-90" ? 0.03 : -0.01) : segment === "1-30" ? 0.02 : 0;
  pay += arm.tone === "formal" ? (segment === "91-120" ? 0.06 : segment === "61-90" ? 0.03 : -0.03) : recent ? 0.04 : -0.02;
  return { respond, pay };
}

const ARM_ORDER: Arm[] = (["sms", "email"] as const).flatMap((channel) =>
  (["morning", "evening"] as const).flatMap((window) => (["friendly", "formal"] as const).map((tone) => ({ channel, window, tone }))),
);
const armKey = (a: Arm) => `${a.channel}/${a.window}/${a.tone}`;

const PROBABILITIES: Record<AgingBucket, Record<string, { respond: number; pay: number }>> = (() => {
  const jitter = createRng(JITTER_SEED);
  const table = {} as Record<AgingBucket, Record<string, { respond: number; pay: number }>>;
  for (const segment of Object.keys(BASE) as AgingBucket[]) {
    table[segment] = {};
    for (const arm of ARM_ORDER) {
      const e = effects(segment, arm);
      const noise = () => (jitter() - 0.5) * 0.02; // +/- 1 point
      table[segment][armKey(arm)] = { respond: BASE[segment].respond + e.respond + noise(), pay: BASE[segment].pay + e.pay + noise() };
    }
  }
  return table;
})();

// u1 decides the reply, u2 decides payment given a reply. Payment never happens without a reply.
export function drawOutcome(segment: AgingBucket, arm: Arm, u1: number, u2: number): { responded: boolean; paid: boolean } {
  const p = PROBABILITIES[segment][armKey(arm)];
  const responded = u1 < p.respond;
  return { responded, paid: responded && u2 < p.pay };
}
