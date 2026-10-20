import { CaseRecord, assertCaseAccess, transitionCase, transitionTask } from "../src/lib/v2/state";

const record = {
  businessId: "northside", workspaceId: "visitor-1", accountId: "account-1", caseId: "case-1",
  state: "open", revision: 1, contactSuppressed: false,
};
const visitor = { kind: "visitor", sessionId: "session-1", businessId: "northside", workspaceId: "visitor-1" };
const operator = { kind: "operator", operatorId: "operator-1", businessIds: ["northside"] };

test("a case can move through investigation, human review and resolution without mutating its snapshot", () => {
  let current = CaseRecord.parse(record);
  for (const event of ["investigate", "request_human", "resolve"] as const) {
    current = transitionCase(current, { type: event, actor: "system", reason: "Case progress" });
  }
  expect(current.state).toBe("resolved");
  expect(current.revision).toBe(4);
  expect(record.state).toBe("open");
});

test("new evidence reopens resolved work, while closed cases require an operator reopen", () => {
  expect(transitionCase({ ...record, state: "resolved" }, { type: "new_evidence", actor: "customer", reason: "Payment receipt" }).state).toBe("investigating");
  expect(() => transitionCase({ ...record, state: "closed" }, { type: "investigate", actor: "system", reason: "Try again" })).toThrow();
  expect(() => transitionCase({ ...record, state: "closed" }, { type: "reopen", actor: "customer", reason: "Try again" })).toThrow();
  expect(transitionCase({ ...record, state: "closed" }, { type: "reopen", actor: "operator", reason: "Verified new evidence" }).state).toBe("open");
});

test("STOP suppresses contact and an explicit reopen cannot clear that suppression", () => {
  const stopped = transitionCase(record, { type: "stop_contact", actor: "customer", reason: "STOP" });
  expect(stopped.state).toBe("closed");
  expect(stopped.contactSuppressed).toBe(true);
  expect(transitionCase(stopped, { type: "reopen", actor: "operator", reason: "Internal review" }).contactSuppressed).toBe(true);
});

test("a resolved case can be closed, but cannot be resolved by a customer", () => {
  expect(transitionCase({ ...record, state: "resolved" }, { type: "close", actor: "system", reason: "Resolution confirmed" }).state).toBe("closed");
  expect(() => transitionCase(record, { type: "resolve", actor: "customer", reason: "Mark paid" })).toThrow();
});

test("invalid states, unknown fields, blank reasons and unsafe revisions are rejected", () => {
  expect(() => transitionCase({ ...record, state: "paid" }, { type: "close", actor: "system", reason: "Done" })).toThrow();
  expect(() => transitionCase({ ...record, balanceCents: 0 }, { type: "close", actor: "system", reason: "Done" })).toThrow();
  expect(() => transitionCase(record, { type: "close", actor: "system", reason: " " })).toThrow();
  expect(() => transitionCase({ ...record, revision: Number.MAX_SAFE_INTEGER }, { type: "close", actor: "system", reason: "Done" })).toThrow();
});

test("task execution has terminal states and an explicit failed-to-queued retry", () => {
  expect(transitionTask("queued", "running")).toBe("running");
  expect(transitionTask("running", "failed")).toBe("failed");
  expect(transitionTask("failed", "queued")).toBe("queued");
  expect(transitionTask("running", "succeeded")).toBe("succeeded");
  for (const state of ["succeeded", "cancelled"]) expect(() => transitionTask(state, "queued")).toThrow();
  expect(() => transitionTask("queued", "succeeded")).toThrow();
});

test("verified visitors can read/post only in their own business and workspace", () => {
  expect(() => assertCaseAccess(visitor, record, "read_case")).not.toThrow();
  expect(() => assertCaseAccess(visitor, record, "post_message")).not.toThrow();
  expect(() => assertCaseAccess(visitor, { ...record, workspaceId: "visitor-2" }, "read_case")).toThrow();
  expect(() => assertCaseAccess(visitor, { ...record, businessId: "other" }, "read_case")).toThrow();
  for (const action of ["review_case", "manage_lessons", "reopen_case"]) expect(() => assertCaseAccess(visitor, record, action)).toThrow();
});

test("verified operators require business membership; absent and malformed principals fail closed", () => {
  expect(() => assertCaseAccess(operator, record, "review_case")).not.toThrow();
  expect(() => assertCaseAccess(operator, { ...record, workspaceId: "visitor-2" }, "manage_lessons")).not.toThrow();
  expect(() => assertCaseAccess(operator, { ...record, businessId: "other" }, "review_case")).toThrow();
  for (const principal of [null, {}, { ...visitor, kind: "admin" }]) expect(() => assertCaseAccess(principal, record, "read_case")).toThrow();
  expect(() => assertCaseAccess(visitor, record, "execute_sql")).toThrow();
});
