import { z } from "zod";
import { Arm } from "../artifact";
import snapshot from "../../../fixtures/v2/outreach-policy-v1.json";
import type { CaseState } from "./store";

export const OUTREACH_GROUPS = ["1-30", "31-60", "61-90", "91-120"] as const;
const Count = z.number().int().positive().max(1_000_000);
export const OutreachPolicy = z.object({
  version: z.literal("v1-outreach-1"), sourceRunId: z.string().regex(/^picker-[a-z0-9-]+$/), sourceCreatedAt: z.iso.datetime(), sourceSha256: z.string().regex(/^[a-f0-9]{64}$/), sourceMode: z.literal("synthetic"),
  schemaVersion: z.literal(1), scenarioVersion: z.literal(1), environmentVersion: z.literal(1), trainSeed: z.number().int(), testSeed: z.number().int(), exploreSeed: z.number().int(),
  counts: z.object({ trainPerSegment: Count, testPerSegment: Count }).strict(), epsilon: z.number().min(0).max(1), reward: z.literal("paid ? 1 : 0"),
  sendHours: z.object({ morning: z.literal(10), evening: z.literal(18) }).strict(), selected: z.object({ "1-30": Arm.strict(), "31-60": Arm.strict(), "61-90": Arm.strict(), "91-120": Arm.strict() }).strict(),
}).strict();
const frozen = OutreachPolicy.safeParse(snapshot);
type Context = Pick<CaseState, "stopped" | "takeover" | "reviewHold" | "preferredChannel" | "facts">;

export function outreachPreview(group: string, c: Context) {
  if (!frozen.success) return { status: "unavailable" as const, reason: "The frozen V1 policy is unavailable. No substitute choice was generated." };
  if (!OUTREACH_GROUPS.includes(group as typeof OUTREACH_GROUPS[number])) return { status: "unselected" as const, policy: frozen.data };
  const arm = frozen.data.selected[group as typeof OUTREACH_GROUPS[number]], warnings: string[] = [];
  if (c.stopped) warnings.push("Contact is stopped for this case.");
  if (c.takeover || c.reviewHold) warnings.push("Automatic replies are paused for operator review.");
  if (c.preferredChannel && c.preferredChannel !== arm.channel) warnings.push(`The saved ${c.preferredChannel} preference does not match this benchmark choice.`);
  if (arm.channel === "sms" ? !c.facts.phone : !c.facts.email) warnings.push(`No ${arm.channel === "sms" ? "phone number" : "email address"} is saved for this channel.`);
  return { status: "preview" as const, policy: frozen.data, arm, hour: frozen.data.sendHours[arm.window], warnings };
}
