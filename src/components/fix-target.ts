// Which turn "Fix this" corrects, from the guarded side's thread. Plain module so it can be tested.
import type { Situation } from "@/lib/situations";

interface Msg {
  role: "agent" | "customer";
  text: string;
  sentAt: string;
  situation?: Situation;
}

export interface FixTarget<M extends Msg> {
  moment: M[]; // the conversation just before the turn being corrected
  before: string; // what that turn sent ("" when the agent sent nothing)
  situation: Situation;
  silent: boolean;
}

export function fixTarget<M extends Msg>(side: { msgs: M[]; silent?: Situation }): FixTarget<M> | null {
  const g = side.msgs;
  const last = g[g.length - 1];
  // The side's latest turn sent nothing (the model ended it). That turn is the target, whoever spoke last:
  // after a silent follow-up the last message is the agent's previous reply, which must not be replaced.
  const silent = side.silent !== undefined;
  if (!last || (!silent && last.role !== "agent")) return null;
  return {
    moment: silent ? g : g.slice(0, -1),
    before: silent ? "" : last.text,
    situation: silent ? side.silent! : (last.situation ?? "general"),
    silent,
  };
}
