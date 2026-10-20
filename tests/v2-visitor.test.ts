import type { Pool } from "pg";
import { visitorConfig } from "../src/lib/v2/visitor-config";
import { createVisitorApi } from "../src/lib/v2/visitor-api";

const config = { mode: "public" as const, origin: "https://v2.example", databaseUrl: "unused" };
const req = (body: unknown, headers: Record<string, string> = {}) => new Request(`${config.origin}/api/v2/session`, { method: "POST", headers: { origin: config.origin, "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const mockPool = () => ({ query: vi.fn(), connect: vi.fn() });

test("V2 is explicitly opt-in and never falls back to an owner connection", () => {
  expect(visitorConfig({})).toBeNull();
  expect(visitorConfig({ V2_MODE: "off", DATABASE_URL: "private" })).toBeNull();
  expect(() => visitorConfig({ V2_MODE: "public", V2_ORIGIN: config.origin, DATABASE_URL: "private" })).toThrow();
  expect(() => visitorConfig({ V2_MODE: "typo" })).toThrow();
});

test("public mode requires a canonical HTTPS origin; HTTP is explicit loopback-local only", () => {
  for (const origin of ["http://v2.example", "https://v2.example/path", "https://user:password@v2.example", "https://v2.example?x=1", "https://v2.example/#x"]) {
    expect(() => visitorConfig({ V2_MODE: "public", V2_ORIGIN: origin, V2_WEB_DATABASE_URL: "postgres://example/db" })).toThrow();
  }
  expect(visitorConfig({ V2_MODE: "local", V2_ORIGIN: "http://localhost:3000/", V2_WEB_DATABASE_URL: "postgres://example/db" })).toMatchObject({ mode: "local", origin: "http://localhost:3000" });
  expect(() => visitorConfig({ V2_MODE: "local", V2_ORIGIN: "http://v2.example", V2_WEB_DATABASE_URL: "postgres://example/db" })).toThrow();
});

test("cross-origin, missing-origin and unsupported-content requests fail before database access", async () => {
  const pool = mockPool(), api = createVisitorApi(pool as unknown as Pool, config);
  for (const origin of ["https://evil.example", "null", ""]) expect((await api.handle(req({ businessId: "northside" }, { origin }), "session")).status).toBe(403);
  expect((await api.handle(req({ businessId: "northside" }, { "content-type": "text/plain" }), "session")).status).toBe(415);
  expect(pool.query).not.toHaveBeenCalled(); expect(pool.connect).not.toHaveBeenCalled();
});

test("session bodies reject forged scope/roles and are bounded by actual bytes", async () => {
  const pool = mockPool(), api = createVisitorApi(pool as unknown as Pool, config);
  expect((await api.handle(req({ businessId: "northside", workspaceId: "demo", kind: "operator" }), "session")).status).toBe(400);
  expect((await api.handle(req({ businessId: "unknown" }), "session")).status).toBe(400);
  expect((await api.handle(req({ businessId: "northside", padding: "é".repeat(3000) }, { "content-length": "1" }), "session")).status).toBe(413);
  expect(pool.query).not.toHaveBeenCalled(); expect(pool.connect).not.toHaveBeenCalled();
});

test("missing, malformed, duplicate and local-only cookies cannot authenticate in public mode", async () => {
  const pool = mockPool(), api = createVisitorApi(pool as unknown as Pool, config);
  for (const cookie of ["", "__Host-recovery-v2=forged", `recovery-v2-local=${"a".repeat(43)}`, `__Host-recovery-v2=${"a".repeat(43)}; __Host-recovery-v2=${"b".repeat(43)}`]) {
    const response = await api.handle(new Request(`${config.origin}/api/v2/cases/one`, { headers: { cookie } }), "case", "one");
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toContain("no-store");
  }
  expect(pool.query).not.toHaveBeenCalled();
});

test("database failures expose no connection details or session secrets", async () => {
  const pool = mockPool(); pool.query.mockRejectedValue(new Error("PRIVATE DATABASE DETAIL"));
  const api = createVisitorApi(pool as unknown as Pool, config);
  const response = await api.handle(new Request(`${config.origin}/api/v2/session`, { headers: { cookie: `__Host-recovery-v2=${"a".repeat(43)}` } }), "session");
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("PRIVATE");
  expect(response.headers.get("vary")).toBe("Cookie");
  expect(response.headers.get("access-control-allow-origin")).toBeNull();
});

test("a stalled JSON upload times out before opening a database connection", async () => {
  const pool = mockPool(), api = createVisitorApi(pool as unknown as Pool, config);
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
  const init: RequestInit & { duplex: "half" } = { method: "POST", headers: { origin: config.origin, "content-type": "application/json" }, body, duplex: "half" };
  vi.useFakeTimers();
  let response: Response | undefined;
  const pending = api.handle(new Request(`${config.origin}/api/v2/session`, init), "session").then((r) => { response = r; });
  try {
    await vi.advanceTimersByTimeAsync(5000);
    expect(response?.status).toBe(408);
    expect(pool.connect).not.toHaveBeenCalled();
  } finally {
    try { controller.close(); } catch { /* The timeout may already have cancelled the stream. */ }
    await pending; vi.useRealTimers();
  }
});
