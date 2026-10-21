"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  ["/", "Customer"],
  ["/evals", "Evals"],
  ["/picker", "Picker"],
  ["/try", "Try it"],
] as const;

export default function NavLinks() {
  const path = usePathname();
  return (
    <ul className="flex gap-1">
      {NAV.map(([href, label]) => {
        const active = path === href;
        return (
          <li key={href}>
            <Link
              href={href}
              aria-current={active ? "page" : undefined}
              className={`inline-flex min-h-11 items-center rounded-md px-3 py-2 text-sm font-medium ${active ? "bg-tint text-accent-ink" : "text-ink-2 hover:bg-tint hover:text-accent-ink"}`}
            >
              {label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
