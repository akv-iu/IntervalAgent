import { z } from "zod";

// A send must carry text; otherwise the loop would make progress without outreach.
const AgentOutput = z
  .object({ message: z.string(), action: z.enum(["send", "handoff", "stop", "close"]) })
  .refine((o) => o.action !== "send" || o.message.trim().length > 0, "send needs a message");
export type AgentOutput = z.infer<typeof AgentOutput>;

// Tolerates code fences and leading prose: takes the outermost {...}.
export function parseAgentOutput(raw: string): AgentOutput | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = AgentOutput.safeParse(JSON.parse(raw.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
