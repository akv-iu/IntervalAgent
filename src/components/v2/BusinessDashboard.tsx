import { formatCents } from "@/lib/format";
import { scenarioName, statusNames } from "@/lib/v2/presentation";
import type { CaseState, WorkspaceView } from "@/lib/v2/store";
import styles from "./workspace.module.css";

export function CaseRecords({ c }: { c: Pick<CaseState, "preferredChannel" | "updates" | "events"> }) {
  return <>
    {c.preferredChannel && <p className="mt-2 text-sm">Current channel preference: {c.preferredChannel}.</p>}
    {c.updates.length ? <ul className="mt-2 space-y-2 text-sm">{c.updates.map((update, index) => <li key={`${update.sourceMessageId}-${index}`}>{update.kind === "payment_recognized" ? `Business-confirmed payment: ${formatCents(update.amountCents)} on ${update.date}, ${update.invoiceId}. Applied to this simulated balance.` : update.kind === "promise" ? `Promise: ${formatCents(update.amountCents)} on ${update.date}. No payment received.` : update.kind === "extension_requested" ? `Extension requested to ${update.date}. Not approved.` : update.kind === "contact_preference" ? `Preference changed to ${update.channel}. No appointment scheduled.` : `${update.channel} requested: ${update.date}, ${update.window}.`}</li>)}</ul> : <p className="mt-2 text-sm text-muted">No reviewed updates saved yet.</p>}
    {c.events.map((event) => <p className="mt-2 text-sm" key={event.id}>{event.state}: {event.channel}, {event.date}, {event.window} ({event.timezone}). Not executed.{event.beyondExpiry ? " Planned window extends beyond this workspace's expiry." : ""}</p>)}
  </>;
}

export default function BusinessDashboard({ workspace, businessId, selectedId, disabled, onSelect }: { workspace: WorkspaceView; businessId: string; selectedId: string; disabled: boolean; onSelect: (id: string) => void }) {
  const cases = Object.values(workspace.cases).filter((c) => c.facts.businessId === businessId);
  return <details className={styles.dashboard} open>
    <summary>Business cases · {cases.length} clients</summary>
    <p className={styles.status}>Saved state in your private workspace. Promises are not receipts; planned contacts have not executed.</p>
    <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="Business case table">
      <table className={styles.caseTable}>
        <caption className="sr-only">{cases[0]?.facts.businessName ?? "Business"}: saved cases and commitments</caption>
        <thead><tr><th scope="col">Client and record</th><th scope="col">Case status</th><th scope="col">Saved commitments and requests</th><th scope="col">Conversation</th></tr></thead>
        <tbody>{cases.map((c) => <tr key={c.facts.id} aria-current={c.facts.id === selectedId ? "true" : undefined}>
          <th scope="row"><span>{c.facts.customer} · {c.facts.invoiceId}</span><p>{scenarioName(c)}</p><p>{formatCents(c.facts.balanceCents)} on record</p></th>
          <td><p>{statusNames[c.status]}</p><p className={styles.status}>{c.turns}/10 customer turns</p>{c.verification && <p className={styles.status}>Verification: {c.verification.outcome.replaceAll("_", " ")}</p>}</td>
          <td><CaseRecords c={c} /></td>
          <td>{disabled ? <span className={styles.status}>Available after this action</span> : <a href="#v2-case" onClick={() => onSelect(c.facts.id)} aria-current={c.facts.id === selectedId ? "true" : undefined}>Open {c.facts.customer}&apos;s case</a>}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </details>;
}
