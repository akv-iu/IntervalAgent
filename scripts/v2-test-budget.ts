import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { RESERVATION_CENTS } from "../src/lib/v2/model";

// Independent batch ledger: failed/unknown calls retain their full reservation; the app-wide cap stays removed.
export function reserveTestCall(path = "results/v2-phase3-4/budget.json") {
  mkdirSync(dirname(path), { recursive: true });
  const lock = `${path}.lock`, handle = openSync(lock, "wx");
  try {
    const ledger = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { capCents: 200, reservedCents: 0, calls: 0 };
    if (ledger.capCents !== 200 || !Number.isSafeInteger(ledger.calls) || ledger.calls < 0 || !Number.isSafeInteger(ledger.reservedCents) || ledger.reservedCents !== ledger.calls * RESERVATION_CENTS || ledger.reservedCents + RESERVATION_CENTS > 200) throw new Error("Approved $2 Phase 3/4 test budget reached or invalid; no API call permitted.");
    ledger.reservedCents += RESERVATION_CENTS; ledger.calls++;
    writeFileSync(`${path}.tmp`, JSON.stringify(ledger, null, 2)); renameSync(`${path}.tmp`, path);
  } finally { closeSync(handle); unlinkSync(lock); }
}
