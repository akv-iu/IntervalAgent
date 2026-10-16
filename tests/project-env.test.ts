import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectEnv, tryAgent } from "../src/lib/project-env";

test("reads the .env file and ignores the shell environment", () => {
  const dir = mkdtempSync(join(tmpdir(), "env-"));
  const file = join(dir, ".env");
  writeFileSync(file, "OPENAI_AGENT_MODEL=from-file\n");
  process.env.OPENAI_API_KEY_SHELL_PROBE = "x";
  const env = projectEnv(file);
  expect(env.OPENAI_AGENT_MODEL).toBe("from-file");
  expect(env.OPENAI_API_KEY).toBeUndefined();
  expect(env.OPENAI_API_KEY_SHELL_PROBE).toBeUndefined();
});

test("a missing .env gives an empty config", () => expect(projectEnv(join(tmpdir(), "does-not-exist.env"))).toEqual({}));

describe("tryAgent: the Try page uses the mock agent unless live is switched on", () => {
  const keyed = { OPENAI_API_KEY: "k", OPENAI_AGENT_MODEL: "m" };
  test("off by default, even with a key", () => expect(tryAgent(keyed)).toBe("mock"));
  test("live only when switched on and a key and model exist", () => {
    expect(tryAgent({ ...keyed, LIVE_DEMO_PROVIDER: "live" })).toBe("live");
    expect(tryAgent({ LIVE_DEMO_PROVIDER: "live" })).toBe("mock");
  });
});
