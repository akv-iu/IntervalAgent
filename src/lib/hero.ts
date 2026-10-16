// The home page hero tells one real conversation from the run, so every event shown happened in the data.
import { formatCents, formatLocal } from "./format";
import type { ConversationRow, MessageRow } from "./reports";

export interface HeroEvent {
  kind: "sent" | "checks" | "reply" | "paid";
  title: string;
  detail: string;
}
export interface HeroStory {
  conversationId: number;
  firstName: string;
  title: string;
  events: HeroEvent[];
}

// Accounts have a timezone, not a city, so the hero names the timezone.
const ZONE: Record<string, string> = { "America/Denver": "Mountain Time", "America/New_York": "Eastern Time" };
const MAX_QUOTE = 80;

// The paid-by-cutoff conversation with the most messages; ties go to the lowest account key, so the pick is stable.
export function heroStory(convs: ConversationRow[], byConv: Record<number, MessageRow[]>): HeroStory | null {
  const paid = convs
    .filter((c) => c.recoveredByCutoffCents > 0 && c.paidAt && byConv[c.id]?.length)
    .sort((a, b) => byConv[b.id].length - byConv[a.id].length || a.accountKey.localeCompare(b.accountKey));
  const c = paid[0];
  if (!c) return null;

  const msgs = byConv[c.id];
  const events: HeroEvent[] = [];
  const opening = msgs.find((m) => m.role === "agent");
  if (opening) {
    events.push({ kind: "sent", title: c.channel === "email" ? "Email sent" : "Text sent", detail: formatLocal(opening.sentAt, c.timezone) });
    const judged = opening.checks.filter((k) => k.passed !== null); // checks that do not apply are left out
    if (judged.length) {
      const passed = judged.filter((k) => k.passed).length;
      events.push({ kind: "checks", title: `Guard checks: ${passed} of ${judged.length} passed`, detail: "before it was sent" });
    }
  }
  const reply = msgs.find((m) => m.role === "customer");
  if (reply) {
    const text = reply.body.length > MAX_QUOTE ? `${reply.body.slice(0, MAX_QUOTE - 3).trimEnd()}...` : reply.body;
    events.push({ kind: "reply", title: "Customer replied", detail: `"${text}"` });
  }
  events.push({ kind: "paid", title: `${formatCents(c.recoveredByCutoffCents)} payment received`, detail: formatLocal(c.paidAt!, c.timezone) });

  return { conversationId: c.id, firstName: c.firstName, title: `${c.firstName}, ${ZONE[c.timezone] ?? c.timezone}`, events };
}
