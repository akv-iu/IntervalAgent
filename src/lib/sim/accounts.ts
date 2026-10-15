// One shared fixture module for runners and the DB seed.
import { createRng, randInt } from "../rng";
import { SIM_DATE, type Tz } from "../time";

export type Persona = "cooperative" | "needs_plan" | "disputes" | "angry" | "stop_contact" | "silent";
export type AgingBucket = "1-30" | "31-60" | "61-90" | "91-120";
export const BUSINESS = "Northside Fitness";

export interface Account {
  accountKey: string;
  dataset: "demo" | "eval";
  business: typeof BUSINESS;
  firstName: string;
  persona: Persona;
  balanceCents: number;
  daysPastDue: number;
  agingBucket: AgingBucket;
  dueDate: string;
  timezone: Tz;
}

export const PERSONAS: Persona[] = ["cooperative", "needs_plan", "disputes", "angry", "stop_contact", "silent"];
export const BUCKETS: [AgingBucket, number, number][] = [
  ["1-30", 1, 30],
  ["31-60", 31, 60],
  ["61-90", 61, 90],
  ["91-120", 91, 120],
];
const FIRST_NAMES = ["Maya", "Jordan", "Priya", "Luis", "Grace", "Omar", "Hannah", "Diego", "Aisha", "Ben"];
const DEMO_SEED = 42;

export function bucketFor(days: number): AgingBucket {
  return BUCKETS.find(([, lo, hi]) => days >= lo && days <= hi)![0];
}

export function dueDateFor(daysPastDue: number): string {
  return new Date(Date.parse(SIM_DATE) - daysPastDue * 86400000).toISOString().slice(0, 10);
}

export function demoAccounts(): Account[] {
  const rng = createRng(DEMO_SEED);
  return Array.from({ length: 100 }, (_, i) => {
    const [, lo, hi] = BUCKETS[Math.floor(i / 25)];
    const daysPastDue = randInt(rng, lo, hi);
    return {
      accountKey: `demo-${String(i + 1).padStart(3, "0")}`,
      dataset: "demo",
      business: BUSINESS,
      firstName: FIRST_NAMES[i % FIRST_NAMES.length],
      persona: PERSONAS[i % PERSONAS.length],
      balanceCents: randInt(rng, 3000, 30000),
      daysPastDue,
      agingBucket: bucketFor(daysPastDue),
      dueDate: dueDateFor(daysPastDue),
      timezone: i % 10 < 7 ? "America/Denver" : "America/New_York",
    };
  });
}
