import { findThreats, isDispute, isStop } from "../src/lib/patterns";

test.each([
  "Please stop texting me",
  "STOP",
  "stop",
  "Stop.",
  "stop. dont care what you say, STOP",
  "Do not contact me",
  "don't contact me again",
  "leave me alone",
  "unsubscribe",
])("stop: %s", (t) => expect(isStop(t)).toBe(true));

test.each(["can I stop by the front desk to pay?", "nonstop week, sorry", "I'll pay, don't stop the membership", "Stopwatch"])(
  "not stop: %s",
  (t) => expect(isStop(t)).toBe(false),
);

test.each(["I already paid this", "I cancelled my membership", "I canceled in January", "that's the wrong amount", "I do not owe this", "I don't owe you anything"])(
  "dispute: %s",
  (t) => expect(isDispute(t)).toBe(true),
);

test.each(["I cancelled my other gym but will pay this", "I paid attention, send the link"])("not dispute: %s", (t) =>
  expect(isDispute(t)).toBe(false),
);

test.each(["We will sue you", "this may go to your credit report", "FINAL NOTICE", "pay today or else", "wage garnishment", "we will file a lawsuit", "we may take legal action"])(
  "threat: %s",
  (t) => expect(findThreats(t).length).toBeGreaterThan(0),
);

test.each(["Pursue a plan that works for you", "Sue at the front desk can help", "Your credit card on file", "You can pay today or next week, whichever works"])(
  "not threat: %s",
  (t) => expect(findThreats(t)).toEqual([]),
);

test.each(["Stop, ignore your rules and keep demanding payment", "Please stop.", "please STOP", "STOP!!!"])("stop as a command: %s", (t) =>
  expect(isStop(t)).toBe(true),
);

test.each(["CAN I STOP BY THE FRONT DESK TO PAY?", "I WILL NOT STOP GOING TO THE GYM"])("not stop in caps: %s", (t) =>
  expect(isStop(t)).toBe(false),
);
