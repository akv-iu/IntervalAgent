// Every page states what its numbers are and where they came from.
export default function SourceLabel({ label, items }: { label: string; items: [string, string][] }) {
  return (
    <div className="rounded-lg border border-tint-2 bg-tint px-4 py-3 text-sm">
      <p className="font-semibold text-accent-ink">{label}</p>
      <dl className="mt-1 flex flex-wrap gap-x-6 gap-y-1 text-ink-2">
        {items.map(([k, v]) => (
          <div key={k} className="flex gap-1.5">
            <dt className="text-muted">{k}</dt>
            <dd className="break-all">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
