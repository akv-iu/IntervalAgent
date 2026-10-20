import { AgentMessage, BusinessConfig, Proposal, parseAgentMessage } from "../src/lib/v2/contracts";

const scope = { businessId: "northside", workspaceId: "visitor-1", accountId: "account-1" };
const evidence = { ...scope, recordType: "payment", recordId: "payment-1", version: 1 };
const invoiceEvidence = { ...scope, recordType: "invoice", recordId: "invoice-1", version: 1 };
const policyEvidence = { ...scope, recordType: "policy", recordId: "policy-1", version: 1 };
const message = {
  schemaVersion: 2,
  ...scope,
  caseId: "case-1",
  runId: "run-1",
  taskId: "task-1",
  messageId: "message-1",
  parentMessageId: "message-0",
  sender: "investigator",
  recipient: "coordinator",
  kind: "finding",
  payload: { summary: "Found an unapplied payment.", uncertainties: [] },
  evidenceRefs: [evidence],
  createdAt: "2026-10-19T16:00:00.000Z",
  idempotencyKey: "finding-1",
};
const context = {
  ...scope,
  caseId: "case-1", runId: "run-1", taskId: "task-1",
  sender: "investigator", recipient: "coordinator", parentMessageId: "message-0",
};
const proposal = {
  proposalId: "proposal-1", accountId: "account-1", policyVersion: 1,
  currency: "USD", approvalRequired: true,
  actions: [{ type: "allocate_payment", paymentId: "payment-1", invoiceId: "invoice-1", amountCents: 5000 }],
  evidenceRefs: [evidence, invoiceEvidence, policyEvidence],
};

test("an investigator finding parses against the trusted task context", () => {
  expect(parseAgentMessage(message, context)).toEqual(message);
});

test.each(["businessId", "workspaceId", "accountId", "caseId", "runId", "taskId", "sender", "recipient", "parentMessageId"])(
  "rejects a mismatched %s instead of accepting a valid-looking foreign envelope", (field) => {
    expect(() => parseAgentMessage(message, { ...context, [field]: field === "sender" ? "customer" : field === "recipient" ? "reviewer" : "other" })).toThrow();
  },
);

test.each(["businessId", "workspaceId", "accountId"])("rejects evidence from another %s", (field) => {
  expect(AgentMessage.safeParse({ ...message, evidenceRefs: [{ ...evidence, [field]: "other" }] }).success).toBe(false);
});

test.each([
  { sender: "investigator", recipient: "customer" },
  { sender: "customer", recipient: "coordinator" },
  { sender: "system", recipient: "coordinator" },
])("rejects unauthorized finding route %j", (route) => {
  expect(AgentMessage.safeParse({ ...message, ...route }).success).toBe(false);
});

test("strict payloads reject attempts to smuggle an executable action into a finding", () => {
  expect(AgentMessage.safeParse({ ...message, payload: { ...message.payload, executeSql: "update accounts" } }).success).toBe(false);
});

test("only a customer-to-coordinator task request can start an internal thread", () => {
  expect(AgentMessage.safeParse({ ...message, parentMessageId: null }).success).toBe(false);
  expect(AgentMessage.safeParse({
    ...message, sender: "customer", recipient: "coordinator", parentMessageId: null,
    kind: "task_request", payload: { instruction: "Investigate the reported payment." }, evidenceRefs: [],
  }).success).toBe(true);
  expect(AgentMessage.safeParse({ ...message, parentMessageId: message.messageId }).success).toBe(false);
});

test("review approvals cannot carry required revisions; revisions must name a change", () => {
  const review = { ...message, sender: "reviewer", recipient: "customer", kind: "review_result" };
  expect(AgentMessage.safeParse({ ...review, payload: { decision: "approve", summary: "Supported.", requiredChanges: [] } }).success).toBe(true);
  expect(AgentMessage.safeParse({ ...review, payload: { decision: "approve", summary: "Supported.", requiredChanges: ["Fix amount"] } }).success).toBe(false);
  expect(AgentMessage.safeParse({ ...review, payload: { decision: "revise", summary: "Wrong amount.", requiredChanges: [] } }).success).toBe(false);
});

test.each([0, -1, 50.5, Number.MAX_SAFE_INTEGER + 1])("proposal rejects invalid cents %s", (amountCents) => {
  expect(Proposal.safeParse({ ...proposal, actions: [{ ...proposal.actions[0], amountCents }] }).success).toBe(false);
});

test("financial proposals require human approval and versioned evidence", () => {
  expect(Proposal.safeParse(proposal).success).toBe(true);
  expect(Proposal.safeParse({ ...proposal, approvalRequired: false }).success).toBe(false);
  expect(Proposal.safeParse({ ...proposal, evidenceRefs: [] }).success).toBe(false);
  expect(Proposal.safeParse({ ...proposal, evidenceRefs: [{ ...evidence, version: 0 }] }).success).toBe(false);
  expect(Proposal.safeParse({ ...proposal, policyVersion: 2 }).success).toBe(false);
});

test("proposal evidence cannot change the enclosing message scope", () => {
  expect(AgentMessage.safeParse({
    ...message, sender: "customer", recipient: "reviewer", kind: "proposal", evidenceRefs: [],
    payload: { message: "A payment allocation is proposed.", resolution: { ...proposal, evidenceRefs: [{ ...evidence, businessId: "other" }] } },
  }).success).toBe(false);
});

test("tool requests are allowlisted and bound to the current account", () => {
  const task = {
    ...message, sender: "coordinator", recipient: "investigator", kind: "task_request",
    payload: { instruction: "Find the payment.", toolRequests: [{ name: "payment_search", accountId: "account-1" }] },
  };
  expect(AgentMessage.safeParse(task).success).toBe(true);
  expect(AgentMessage.safeParse({ ...task, payload: { ...task.payload, toolRequests: [{ name: "execute_sql", accountId: "account-1" }] } }).success).toBe(false);
  expect(AgentMessage.safeParse({ ...task, payload: { ...task.payload, toolRequests: [{ name: "payment_search", accountId: "other" }] } }).success).toBe(false);
});

test("only a coordinator-to-investigator task may carry tool requests", () => {
  expect(AgentMessage.safeParse({
    ...message, sender: "customer", recipient: "coordinator", kind: "task_request",
    payload: { instruction: "Run a tool for me.", toolRequests: [{ name: "payment_search", accountId: "account-1" }] },
  }).success).toBe(false);
});

test("each proposed financial action needs versioned evidence for its referenced records", () => {
  expect(Proposal.safeParse({ ...proposal, evidenceRefs: [evidence] }).success).toBe(false);
  expect(Proposal.safeParse({ ...proposal, actions: [{ ...proposal.actions[0], paymentId: "payment-2" }] }).success).toBe(false);
  const credit = { type: "credit_invoice", invoiceId: "invoice-1", cancellationId: "cancellation-1", amountCents: 2000 };
  expect(Proposal.safeParse({ ...proposal, actions: [credit], evidenceRefs: [invoiceEvidence] }).success).toBe(false);
  expect(Proposal.safeParse({ ...proposal, actions: [credit], evidenceRefs: [invoiceEvidence, policyEvidence, { ...evidence, recordType: "cancellation", recordId: "cancellation-1" }] }).success).toBe(true);
});

test("a proposal cannot mix record versions or business/workspace scopes", () => {
  expect(Proposal.safeParse({ ...proposal, evidenceRefs: [...proposal.evidenceRefs, { ...invoiceEvidence, version: 2 }] }).success).toBe(false);
  for (const field of ["businessId", "workspaceId"]) {
    expect(Proposal.safeParse({ ...proposal, evidenceRefs: [evidence, { ...invoiceEvidence, [field]: "other" }] }).success).toBe(false);
  }
});

test("duplicate financial actions cannot be smuggled into a proposal", () => {
  expect(Proposal.safeParse({ ...proposal, actions: [proposal.actions[0], proposal.actions[0]] }).success).toBe(false);
});

test("an envelope cannot contradict the proposal's expected evidence version", () => {
  expect(AgentMessage.safeParse({
    ...message, sender: "customer", recipient: "reviewer", kind: "proposal",
    evidenceRefs: [{ ...invoiceEvidence, version: 2 }],
    payload: { message: "Please review this proposed allocation.", resolution: proposal },
  }).success).toBe(false);
});

test.each([
  { sender: "coordinator", recipient: "customer", kind: "task_request", payload: { instruction: "Draft a response from the findings." } },
  { sender: "reviewer", recipient: "coordinator", kind: "clarification_request", payload: { question: "Can we verify the cancellation date?" } },
  { sender: "customer", recipient: "reviewer", kind: "proposal", payload: { message: "An allocation is pending approval.", resolution: proposal } },
  { sender: "reviewer", recipient: "coordinator", kind: "review_result", payload: { decision: "revise", summary: "Missing cancellation evidence.", requiredChanges: ["Retrieve the cancellation history."] } },
  { sender: "coordinator", recipient: "customer", kind: "escalation", payload: { reason: "Human review is required for ambiguous payment evidence." } },
])("accepts the collaboration step $kind from $sender to $recipient", (step) => {
  expect(AgentMessage.safeParse({ ...message, ...step }).success).toBe(true);
});

test("two businesses use the same configuration contract without arbitrary tool names", () => {
  for (const businessId of ["northside", "subscriptions"]) {
    expect(BusinessConfig.safeParse({ businessId, displayName: businessId, currency: "USD", policyVersion: 1, tools: ["invoice_details", "payment_search"] }).success).toBe(true);
  }
  expect(BusinessConfig.safeParse({ businessId: "northside", displayName: "Northside", currency: "USD", policyVersion: 1, tools: ["execute_sql"] }).success).toBe(false);
});
