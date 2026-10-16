// Shared by server pages and client components, so it must not live in a "use client" file.
export const verdictText = (passed: boolean | null) => (passed === null ? "n/a" : passed ? "pass" : "fail");

const FLAG_TEXT: Record<string, string> = {
  rescheduled: "moved into 8am to 9pm",
  regenerated: "rewritten after a guard check",
  fallback: "safe template used",
  handoff: "handed to a person",
  fixed_ack: "fixed acknowledgement, no model call",
};
export const flagText = (f: string) => FLAG_TEXT[f] ?? f;
export const checkText = (name: string) => name.replace(/_/g, " ");
