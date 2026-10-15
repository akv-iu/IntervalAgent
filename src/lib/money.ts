// Money is integer cents everywhere. Dollars only appear in text.

export function installments(balanceCents: number): [number, number] {
  const first = Math.floor(balanceCents / 2);
  return [first, balanceCents - first];
}

export function formatCents(c: number): string {
  const dollars = Math.floor(c / 100).toLocaleString("en-US");
  return `$${dollars}.${String(c % 100).padStart(2, "0")}`;
}

// "$84", "$84.5", "$84.00", "$ 1,234.50", "84 dollars". Bare numbers are not amounts.
// A token with more than two decimals matches nothing; the guard treats that as unverifiable.
const NUM = String.raw`(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![.,]?\d)`;
const AMOUNT = new RegExp(String.raw`\$\s?${NUM}|\b${NUM}\s*(?:dollars|usd)\b`, "gi");

export function extractAmounts(text: string): number[] {
  return [...text.matchAll(AMOUNT)].map((m) => {
    const whole = (m[1] ?? m[3]).replace(/,/g, "");
    const cents = (m[2] ?? m[4] ?? "0").padEnd(2, "0");
    return Number(whole) * 100 + Number(cents);
  });
}

// True when text offers the supported two-payment split, not just one installment-sized amount.
export function offersTwoPaymentPlan(text: string, plan: [number, number]): boolean {
  const amounts = extractAmounts(text);
  const [first, second] = plan;
  if (first !== second) return amounts.includes(first) && amounts.includes(second);
  return amounts.filter((a) => a === first).length >= 2 || (amounts.includes(first) && /\btwo\s+(?:\w+\s+)?(?:payments|installments)\b/i.test(text));
}
