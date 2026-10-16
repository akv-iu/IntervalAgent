// Shown when the database has no completed run of the needed kind. Never invents numbers.
export default function EmptyState({ what }: { what: string }) {
  return (
    <section className="rounded-lg border border-dashed border-line p-5 text-sm">
      <h2 className="text-base font-semibold">No data imported yet</h2>
      <p className="mt-1 text-ink-2">This page needs a completed {what} in the database. To set one up locally, run:</p>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-ink-2">
        <li>npm run db:migrate</li>
        <li>npm run db:seed</li>
        <li>npm run simulate, npm run picker, npm run eval:replay</li>
        <li>npm run db:import -- results/&lt;run-id&gt;.json (once per file)</li>
      </ol>
    </section>
  );
}
