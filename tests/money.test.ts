import { extractAmounts, formatCents, installments, installmentsN } from "../src/lib/money";

test("uneven split puts the extra cent second", () => expect(installments(46001)).toEqual([23000, 23001]));
test("even split", () => expect(installments(8400)).toEqual([4200, 4200]));
test("installments always sum to the balance", () => {
  for (const b of [1, 3, 99, 12900, 46001, 31501]) {
    const [a, c] = installments(b);
    expect(a + c).toBe(b);
  }
});

test.each([
  [46001, "$460.01"],
  [8400, "$84.00"],
  [5, "$0.05"],
  [123450, "$1,234.50"],
])("formatCents(%i)", (c, want) => expect(formatCents(c)).toBe(want));

test.each<[string, number[]]>([
  ["You owe $84.", [8400]],
  ["$84.00 is due", [8400]],
  ["84 dollars", [8400]],
  ["$1,234.50 total", [123450]],
  ["$230.00 and $230.01", [23000, 23001]],
  ["$ 84.00 today", [8400]],
  ["call 555-1234", []],
  ["2 payments", []],
])("extractAmounts(%s)", (t, want) => expect(extractAmounts(t)).toEqual(want));

test.each<[string, number[]]>([
  ["$84.5 now", [8450]],
  ["84.5 dollars", [8450]],
  ["$84.555", []],
])("extractAmounts handles odd precision: %s", (t, want) => expect(extractAmounts(t)).toEqual(want));

describe("installmentsN", () => {
  test("three payments of 46001 sum exactly, extra cents last", () => {
    expect(installmentsN(46001, 3)).toEqual([15333, 15334, 15334]);
    expect(installmentsN(46001, 3).reduce((a, b) => a + b, 0)).toBe(46001);
  });
  test("two payments match installments()", () => expect(installmentsN(46001, 2)).toEqual(installments(46001)));
  test("an even split", () => expect(installmentsN(9900, 3)).toEqual([3300, 3300, 3300]));
});
