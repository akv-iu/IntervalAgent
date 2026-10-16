export default function PageHeader({ title, lede }: { title: string; lede: string }) {
  return (
    <header>
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
      <p className="mt-2 max-w-2xl text-base text-ink-2">{lede}</p>
    </header>
  );
}
