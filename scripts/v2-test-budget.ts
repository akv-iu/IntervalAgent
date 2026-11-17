import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { RESERVATION_CENTS } from "../src/lib/v2/model";

// Independent batch ledger: failed/unknown calls retain their full reservation; the app-wide cap stays removed.
export function reserveTestCall(path = "results/v2-phase3-4/budget.json", capCents: 100 | 200 = 200) {
  if (capCents !== 100 && capCents !== 200) throw new Error("Unsupported test budget");
  mkdirSync(dirname(path), { recursive: true });
  const lock = `${path}.lock`, handle = openSync(lock, "wx");
  try {
    const ledger = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { capCents, reservedCents: 0, calls: 0 };
    if (ledger.capCents !== capCents || !Number.isSafeInteger(ledger.calls) || ledger.calls < 0 || !Number.isSafeInteger(ledger.reservedCents) || ledger.reservedCents !== ledger.calls * RESERVATION_CENTS || ledger.reservedCents + RESERVATION_CENTS > capCents) throw new Error(`Approved $${capCents / 100} test budget reached or invalid; no API call permitted.`);
    ledger.reservedCents += RESERVATION_CENTS; ledger.calls++;
    writeFileSync(`${path}.tmp`, JSON.stringify(ledger, null, 2)); renameSync(`${path}.tmp`, path);
  } finally { closeSync(handle); unlinkSync(lock); }
}
