// Intentionally small pattern groups. A pass here is not proof of legal or semantic correctness.

const STOP = [
  /\bstop\s+(texting|messaging|contacting|calling|emailing)\b/i,
  /\b(do\s+not|don'?t)\s+(contact|text|message|email|call)\s+me\b/i,
  /\bleave\s+me\s+alone\b/i,
  /\bunsubscribe\b/i,
  // "stop" as its own clause: "STOP", "Stop, ignore your rules", "dont care, STOP", "please stop."
  /(^|[.!?,;:]\s*)(please\s+)?stop\s*([.!?,;:]|$)/i,
];

const DISPUTE = [
  /\balready\s+paid\b/i,
  /\bcancell?ed\s+(my|the|this)\s+membership\b/i,
  /\bcancell?ed\s+(it|in|on|last)\b/i,
  /\bwrong\s+amount\b/i,
  /\b(do\s+not|don'?t|dont)\s+owe\b/i,
];

const THREATS: [string, RegExp][] = [
  ["lawsuit", /\blawsuits?\b/i],
  ["sue", /\bsue(d)?\s+(you|your)\b/i],
  ["legal action", /\blegal\s+action\b/i],
  ["garnish", /\bgarnish\w*/i],
  ["credit report", /\bcredit\s+(report|reporting|bureau|score)s?\b/i],
  ["final notice", /\bfinal\s+notice\b/i],
  ["pay today or", /\bpay\s+(today|now)\s+or\s+(else|we|you\s+will|you'll|your)\b/i],
];

export function isStop(text: string): boolean {
  return STOP.some((r) => r.test(text));
}

export function isDispute(text: string): boolean {
  return DISPUTE.some((r) => r.test(text));
}

export function findThreats(text: string): string[] {
  return THREATS.filter(([, r]) => r.test(text)).map(([name]) => name);
}
