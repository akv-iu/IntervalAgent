import { createRng, randInt } from "../src/lib/rng";

test("same seed gives the same sequence", () => {
  const a = createRng(42);
  const b = createRng(42);
  expect([a(), a(), a()]).toEqual([b(), b(), b()]);
});

test("different seeds give different sequences", () => {
  expect(createRng(1)()).not.toEqual(createRng(2)());
});

test("values are in [0, 1) and randInt stays in range", () => {
  const r = createRng(1);
  const seen = new Set<number>();
  for (let i = 0; i < 1000; i++) {
    const v = randInt(r, 1, 3);
    expect(v >= 1 && v <= 3).toBe(true);
    seen.add(v);
    const u = r();
    expect(u >= 0 && u < 1).toBe(true);
  }
  expect(seen.size).toBe(3);
});
