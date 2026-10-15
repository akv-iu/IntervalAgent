import { newRunId } from "../scripts/artifact-file";
import { slug } from "../src/lib/artifact";

test("run ids differ within the same second and are valid slugs", () => {
  const a = newRunId("bulk", new Date("2026-10-15T12:00:00.100Z"));
  const b = newRunId("bulk", new Date("2026-10-15T12:00:00.200Z"));
  expect(a).not.toBe(b);
  expect(a).toBe("bulk-20261015-120000-100");
  expect(slug.safeParse(a).success).toBe(true);
});
