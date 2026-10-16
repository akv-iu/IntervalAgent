import { existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

// The public web app must never reach LLM code, the conversation loop, or database write code.
const FORBIDDEN = ["src/lib/llm", "src/lib/sim/loop", "src/lib/sim/eval", "src/lib/db-admin", "src/lib/lessons-store"];
const ROOT = resolve(".");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}

function resolveImport(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? join(ROOT, "src", spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(from), spec) : null;
  if (!base) return null; // package import
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null; // e.g. JSON or CSS
}

function reachable(entries: string[]): Set<string> {
  const seen = new Set<string>();
  const stack = [...entries];
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    const src = readFileSync(f, "utf8");
    // import x from "a", export * from "a", import("a"), and bare side-effect import "a"
    for (const m of src.matchAll(/(?:import|export)[^"';]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|(?:^|;)\s*import\s*["']([^"']+)["']/gm)) {
      const next = resolveImport(f, m[1] ?? m[2] ?? m[3]);
      if (next) stack.push(next);
    }
  }
  return seen;
}

// The only exception: the local-only live demo route, which refuses to run unless APP_MODE is local
// and a key is present in the project .env file (the deployed site has neither).
const LIVE_ROUTE = join("src", "app", "api", "live", "route.ts");

test("app and components never import LLM, loop, or write-side code", () => {
  const entries = [...files("src/app"), ...(existsSync("src/components") ? files("src/components") : [])].filter((f) => !f.endsWith(LIVE_ROUTE));
  expect(entries.length).toBeGreaterThan(0);
  const bad = [...reachable(entries)].map((f) => f.replace(ROOT, "").replace(/\\/g, "/").replace(/^\//, "")).filter((f) => FORBIDDEN.some((x) => f.startsWith(x)));
  expect(bad).toEqual([]);
});

test("the walker does detect a forbidden import (sanity check)", () => {
  const seen = [...reachable([resolve("scripts/eval.ts")])].map((f) => f.replace(/\\/g, "/"));
  expect(seen.some((f) => f.includes("src/lib/llm/openai"))).toBe(true);
});

test("the walker also follows bare side-effect imports", () => {
  const probe = resolve("tests/.probe-side-effect.ts");
  writeFileSync(probe, '"use client"; import "../src/lib/llm/openai";\n');
  try {
    const seen = [...reachable([probe])].map((f) => f.replace(/\\/g, "/"));
    expect(seen.some((f) => f.includes("src/lib/llm/openai"))).toBe(true);
  } finally {
    unlinkSync(probe);
  }
});

test("the live route is the single exception and guards itself", () => {
  const src = readFileSync(LIVE_ROUTE, "utf8");
  expect(src).toContain('process.env.APP_MODE !== "local"'); // host must explicitly be local
  expect(src).toContain('env.APP_MODE !== "local"'); // and the .env file too
  expect(src).toContain("projectEnv()"); // key read from the .env file, never the host environment
  expect(src).toContain('{ error: "not found" }, 404');
  const allApi = files(join("src", "app", "api"));
  const norm = (f: string) => f.replace(/\\/g, "/");
  const reachingLlm = allApi.filter((f) => [...reachable([f])].some((x) => norm(x).includes("src/lib/llm"))).map(norm);
  expect(reachingLlm).toEqual([norm(LIVE_ROUTE)]);
  const reachingWrites = allApi.filter((f) => [...reachable([f])].some((x) => norm(x).includes("src/lib/lessons-store"))).map(norm);
  expect(reachingWrites).toEqual([norm(LIVE_ROUTE)]);
});
