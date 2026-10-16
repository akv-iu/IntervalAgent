// CSV export (FR-54, Review Focus 4): escaping, formula neutralization, and bad run IDs.
import { csvField, toCsv } from "../src/lib/csv";

const db = vi.hoisted(() => ({ bulk: new Set(["bulk-20261015-1"]), down: false }));
vi.mock("../src/lib/reports", () => ({
  isCompletedBulkRun: async (id: string) => {
    if (db.down) throw new Error("connect ECONNREFUSED postgres://user:secret@db.example/neondb");
    return db.bulk.has(id);
  },
  overview: async () => ({ recoveredCents: 12345, contactedBalanceCents: 50000, recoveryRatePct: 14, daysFromOutreachToPayment: null, plans: 2, promises: 1, handoffs: 0 }),
  aging: async () => [{ bucket: "31-60", accounts: 3, startingBalanceCents: 50000, recoveredCents: 12345 }],
}));

import { GET } from "../src/app/api/export.csv/route";

describe("csvField", () => {
  test.each([
    ["a,b", '"a,b"'],
    ['say "hi"', '"say ""hi"""'],
    ["two\nlines", '"two\nlines"'],
    ["=SUM(A1)", "'=SUM(A1)"],
    ["+1", "'+1"],
    ["-x", "'-x"],
    ["@cmd", "'@cmd"],
    ["\tx", "'\tx"],
    ['=A1,"b"', `"'=A1,""b"""`],
    ["plain", "plain"],
  ])("%j -> %s", (v, want) => expect(csvField(v)).toBe(want));
  test("numbers are left alone, negatives included", () => expect(csvField(-5)).toBe("-5"));
  test("null is empty", () => expect(csvField(null)).toBe(""));
});

test("toCsv writes labeled sections with CRLF rows", () =>
  expect(toCsv([{ title: "Overview", header: ["metric", "value"], rows: [["plans", 2]] }])).toBe("Overview\r\nmetric,value\r\nplans,2\r\n"));

describe("GET /api/export.csv", () => {
  const get = (q: string) => GET(new Request(`http://localhost/api/export.csv${q}`));

  test.each([
    ["", 400],
    ["?runId=", 400],
    ["?runId=../x", 400],
    ["?runId=Bulk%20x", 400],
    ["?runId=bulk-unknown", 404],
    ["?runId=eval-20261016-170317-040", 404],
  ])("%s -> %i with a plain message", async (q, status) => {
    const r = await get(q);
    expect(r.status).toBe(status);
    expect(r.headers.get("content-type")).toMatch(/text\/plain/);
    expect(await r.text()).not.toMatch(/postgres|stack|Error:/i);
  });

  test("a completed bulk run downloads overview and aging in dollars", async () => {
    const r = await get("?runId=bulk-20261015-1");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/text\/csv/);
    expect(r.headers.get("content-disposition")).toContain('filename="recovery-lab-bulk-20261015-1.csv"');
    const body = await r.text();
    expect(body).toContain("Overview\r\n");
    expect(body).toContain("Recovered by cutoff (USD),123.45");
    expect(body).toContain("Recovery rate (%),14.0\r\n"); // one decimal, as on the page
    expect(body).toContain("First message to payment (days),\r\n");
    expect(body).toContain("Aging\r\nbucket,accounts,starting balance (USD),recovered (USD)\r\n31-60,3,500.00,123.45\r\n");
  });

  test("a database failure is a 503 that never leaks the connection string", async () => {
    db.down = true;
    const r = await get("?runId=bulk-20261015-1");
    db.down = false;
    expect(r.status).toBe(503);
    expect(await r.text()).not.toMatch(/postgres|secret/i);
  });
});
