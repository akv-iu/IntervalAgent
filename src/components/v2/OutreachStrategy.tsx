"use client";

import { useState } from "react";
import { OUTREACH_GROUPS, outreachPreview } from "@/lib/v2/outreach";
import type { CaseState } from "@/lib/v2/store";
import styles from "./workspace.module.css";

export default function OutreachStrategy({ c }: { c: CaseState }) {
  const [group, setGroup] = useState("");
  const preview = outreachPreview(group, c);
  return <details className={styles.caseContext}>
    <summary>Outreach strategy: V1 policy preview</summary>
    <p className="mt-2">Overdue age is not included in this case record. Choose a group to preview V1&apos;s frozen policy. This choice does not set the customer&apos;s age.</p>
    {preview.status === "unavailable" ? <p className="mt-2" role="status">{preview.reason}</p> : <>
      <label className="mt-3 block">Overdue age for this preview
        <select className="ml-2 max-w-full rounded-md border border-line bg-white p-2" value={group} onChange={(event) => setGroup(event.target.value)}>
          <option value="">Choose a group</option>{OUTREACH_GROUPS.map((value) => <option key={value} value={value}>{value} days</option>)}
        </select>
      </label>
      <div className="mt-3" aria-live="polite">
        {preview.status === "preview" ? <><p className="font-medium">{preview.arm.channel === "sms" ? "SMS" : "Email"} · {String(preview.hour).padStart(2, "0")}:00 {c.facts.timezone} · {preview.arm.tone} tone</p><p className="mt-1">Read-only benchmark for {c.facts.businessName}. No contact is sent, scheduled or approved.</p>{preview.warnings.map((warning) => <p key={warning} className="mt-1">{warning}</p>)}</> : <p>Select an age group to see its channel, local time and tone.</p>}
      </div>
      <p className="mt-3">Learned on synthetic V1 customers with made-up reward probabilities, then frozen. Not trained for this business; no real-world collection improvement is established. Chat, saved preferences and planned contacts remain unchanged.</p>
      <details className="mt-3"><summary>Policy provenance</summary>
        <p className="mt-2 break-words">Version: {preview.policy.version}. Source run: {preview.policy.sourceRunId}. Source created {preview.policy.sourceCreatedAt}.</p>
        <p className="mt-1">Environment {preview.policy.environmentVersion}; schema/scenarios {preview.policy.schemaVersion}/{preview.policy.scenarioVersion}. Seeds: {preview.policy.trainSeed}/{preview.policy.testSeed}/{preview.policy.exploreSeed} (train/test/explore).</p>
        <p className="mt-1">{preview.policy.counts.trainPerSegment} training cases and {preview.policy.counts.testPerSegment} paired synthetic test cases per group. Reward: simulated payment. No model call or retraining occurs here.</p>
        <p className="mt-1 break-all">Source SHA-256: {preview.policy.sourceSha256}</p>
        <a className="mt-2 inline-block underline" href="/picker">Open the V1 experiment page</a>
      </details>
    </>}
  </details>;
}
