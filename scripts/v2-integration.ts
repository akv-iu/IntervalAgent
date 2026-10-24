import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { budgetUsage, closeV2Pool, type WorkspaceView } from "../src/lib/v2/store";
import { MODEL } from "../src/lib/v2/model";
import { ROLE_VERSION } from "../src/lib/v2/agents";

async function main() {
  if (!process.argv.includes("--live")) throw new Error("Explicit --live required; makes paid calls on the configured API account");
  const origin = "http://127.0.0.1:3012";
  const url = `${origin}/api/v2/workspace`;
  let cookie = "";
  let view: WorkspaceView;
  const steps: { name: string; latencyMs: number; cases: WorkspaceView["cases"] }[] = [];
  async function action(name: string, fields: Record<string, unknown>) {
    const start = Date.now();
    const pendingResponse = fetch(url, { method: "POST", headers: { origin, cookie, "Content-Type": "application/json" }, body: JSON.stringify(fields) });
    if (name === "payment-claim" || name === "partial-claim") {
      let observed = false;
      for (let attempt = 0; attempt < 20; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        const poll = await fetch(url, { headers: { cookie } });
        const progress = await poll.json() as { workspace?: WorkspaceView };
        const active = progress.workspace?.cases["late-payment"];
        if (active?.run?.activeRole) {
          assert.ok(active.run.steps?.some((step) => step.state === "started"));
          assert.ok(!active.messages.some((m) => m.speaker === "agent" && m.origin !== "synthetic_opening"));
          console.log("HTTP preview observed:", active.run.activeRole, "working before any customer reply was published");
          observed = true; break;
        }
      }
      assert.ok(observed, "Expected an active model step to be visible while the response was pending");
    }
    const response = await pendingResponse;
    const payload = await response.json() as { workspace?: WorkspaceView; error?: string };
    assert.ok(response.ok, `${name}: status ${response.status}; ${payload.error ?? "unavailable"}`);
    const newCookie = response.headers.get("set-cookie"); if (newCookie) cookie = newCookie.split(";")[0];
    assert.ok(payload.workspace);
    steps.push({ name, latencyMs: Date.now() - start, cases: payload.workspace.cases });
    await save();
    console.log(name, "saved", `${Date.now() - start}ms`);
    if (typeof fields.caseId === "string") {
      const current = payload.workspace.cases[fields.caseId];
      console.log(current.audit.at(-1)?.id === fields.id ? current.activity.at(-1)?.summary : "No new model run");
    }
    return payload.workspace;
  }
  const evidencePath = `results/v2-phase1/persistent-live-${ROLE_VERSION}.json`;
  const sourceHash = createHash("sha256");
  for (const name of ["agents", "contracts", "fixtures", "http", "model", "source", "store"]) sourceHash.update(readFileSync(`src/lib/v2/${name}.ts`));
  const codeHash = sourceHash.digest("hex");
  const save = async () => { mkdirSync("results/v2-phase1", { recursive: true }); writeFileSync(evidencePath, JSON.stringify({ model: MODEL, roleVersion: ROLE_VERSION, codeHash, at: new Date().toISOString(), provenance: "real SDK/model and PostgreSQL; synthetic business/customer", steps, budget: await budgetUsage() }, null, 2)); };
  if (!process.argv.includes("--report-only")) {
    await action("create-private-workspace", { action: "create" });
    const claimId = randomUUID();
    view = await action("payment-claim", { id: claimId, caseId: "late-payment", action: "customer", text: "I paid $129 today by debit card. Can you check?" });
    assert.equal(view.cases["late-payment"].verification, null);
    assert.ok(/invoice/i.test(view.cases["late-payment"].messages.at(-1)?.text ?? ""));
    assert.ok(!view.cases["late-payment"].activity.some((a) => a.role === "business_verification"));
    view = await action("customer-invoice", { id: randomUUID(), caseId: "late-payment", action: "customer", text: "My invoice number is INV-101." });
    await save();
    assert.equal(view.cases["late-payment"].verification?.outcome, "awaiting_business");
    assert.equal(view.cases["late-payment"].lastReview?.review.accepted, true);
    const requestId = view.cases["late-payment"].requestId;
    assert.ok(requestId);
    await closeV2Pool();
    const restored = await fetch(url, { headers: { cookie } });
    assert.equal(restored.status, 200);
    const persisted = await restored.json() as { workspace: WorkspaceView };
    assert.equal(persisted.workspace.cases["late-payment"].requestId, requestId);
    view = await action("scoped-business-yes", { id: randomUUID(), caseId: "late-payment", action: "business", requestId, text: "Yes" });
    await save();
    assert.equal(view.cases["late-payment"].verification?.outcome, "business_confirmed");
    assert.equal(view.cases["late-payment"].lastReview?.review.accepted, true);
    assert.equal(view.cases["late-payment"].facts.balanceCents, 0);
    assert.equal(view.cases["late-payment"].facts.payments.length, 1);
    const confirmation = await fetch(url, { headers: { cookie } });
    assert.equal((await confirmation.json() as { workspace: WorkspaceView }).workspace.cases["late-payment"].facts.balanceCents, 0);
    view = await action("promise-and-contact", { id: randomUUID(), caseId: "conflicting-payment", action: "customer", text: "I promise to pay $50 tomorrow. Please call me tomorrow afternoon." });
    await save();
    const recorded = view.cases["conflicting-payment"];
    assert.ok(recorded.updates.some((u) => u.kind === "promise" && u.amountCents === 5000));
    assert.ok(recorded.events.some((e) => e.channel === "call" && e.window === "afternoon" && e.state === "planned"));
    const beforeStop = await budgetUsage();
    view = await action("stop-contact", { id: randomUUID(), caseId: "conflicting-payment", action: "customer", text: "STOP" });
    assert.ok(view.cases["conflicting-payment"].events.every((e) => e.state === "blocked"));
    assert.equal((await budgetUsage()).calls, beforeStop.calls);
    view = await action("fresh-record-direct-read", { id: randomUUID(), caseId: "fresh-record", action: "customer", text: "Did my $50 payment reach invoice INV-102?" });
    await save();
    assert.ok(!view.cases["fresh-record"].activity.some((a) => a.role === "business_verification"));
    assert.equal(view.cases["fresh-record"].facts.balanceCents, 7900);
  }
  cookie = "";
  await action("create-partial-workspace", { action: "create" });
  view = await action("partial-claim", { id: randomUUID(), caseId: "late-payment", action: "customer", text: "I paid $129 today by debit card for INV-101." });
  const partialRequest = view.cases["late-payment"].requestId;
  assert.ok(partialRequest);
  view = await action("business-partial", { id: randomUUID(), caseId: "late-payment", action: "business", requestId: partialRequest, text: "He has only paid 50 dollars" });
  assert.equal(view.cases["late-payment"].verification?.outcome, "business_reported");
  assert.equal(view.cases["late-payment"].verification?.amountCents, 5000);
  assert.equal(view.cases["late-payment"].verification?.businessMessage, null);
  assert.equal(view.cases["late-payment"].reviewHold, false);
  assert.ok(/disput/i.test(view.cases["late-payment"].messages.at(-1)?.text ?? ""));
  assert.ok(!/clarify with|contact (?:the business|Northside)|settle|payment date/i.test(view.cases["late-payment"].messages.at(-1)?.text ?? ""));
  assert.equal(view.cases["late-payment"].facts.balanceCents, 12900);
  assert.equal(view.cases["late-payment"].facts.payments.length, 0);
  const disputeId = randomUUID();
  view = await action("customer-disputes-report", { id: disputeId, caseId: "late-payment", action: "customer", text: "I dispute that business report. I paid $129, not $50. Please have an operator review this." });
  assert.equal(view.cases["late-payment"].audit.at(-1)?.id, disputeId);
  assert.equal(view.cases["late-payment"].status, "needs_review");
  assert.equal(view.cases["late-payment"].reviewHold, true);
  const heldBudget = await budgetUsage();
  view = await action("message-during-review", { id: randomUUID(), caseId: "late-payment", action: "customer", text: "My receipt is ready for the operator." });
  assert.equal((await budgetUsage()).calls, heldBudget.calls);
  assert.equal(view.cases["late-payment"].run, null);
  await save();
  assert.equal(view.cases["late-payment"].facts.balanceCents, 12900);
  console.log(process.argv.includes("--report-only") ? "PASS: real HTTP progress, attributed business report, model-led dispute, operator hold and saved messages without further model calls." : "PASS: real HTTP progress, invoice clarification, scoped Yes/receipt, attributed business report, dispute hold, saved promise/event, STOP and direct read.");
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Persistent integration failed"); process.exitCode = 1; }).finally(closeV2Pool);
