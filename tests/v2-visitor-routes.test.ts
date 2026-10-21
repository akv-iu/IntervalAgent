import type { Pool } from "pg";
import { createVisitorApi } from "../src/lib/v2/visitor-api";

vi.mock("next/server", () => ({ connection: async () => {} }));
const serve = vi.hoisted(() => vi.fn());
vi.mock("../src/lib/v2/visitor-runtime", () => ({ serveVisitorRequest: serve }));
import * as session from "../src/app/api/v2/session/route";
import * as collection from "../src/app/api/v2/cases/route";
import * as detail from "../src/app/api/v2/cases/[caseId]/route";
import * as messages from "../src/app/api/v2/cases/[caseId]/messages/route";
import * as activity from "../src/app/api/v2/cases/[caseId]/activity/route";

afterEach(() => { vi.unstubAllEnvs(); serve.mockReset(); });

test("route exports delegate every operation through the visitor boundary and await dynamic IDs", async () => {
  serve.mockResolvedValue(new Response(null, { status: 204 }));
  const request = new Request("https://v2.example/api/v2/session");
  for (const method of [session.GET, session.POST, session.DELETE]) {
    await method(request); expect(serve).toHaveBeenLastCalledWith(request, "session");
  }
  await collection.POST(request); expect(serve).toHaveBeenLastCalledWith(request, "cases");
  await detail.GET(request, { params: Promise.resolve({ caseId: "one" }) }); expect(serve).toHaveBeenLastCalledWith(request, "case", "one");
  await messages.POST(request, { params: Promise.resolve({ caseId: "two" }) }); expect(serve).toHaveBeenLastCalledWith(request, "messages", "two");
  await activity.GET(request, { params: Promise.resolve({ caseId: "two" }) }); expect(serve).toHaveBeenLastCalledWith(request, "activity", "two");
});

test("disabled routes and incomplete opt-in fail closed without database access", async () => {
  const { serveVisitorRequest } = await vi.importActual<typeof import("../src/lib/v2/visitor-runtime")>("../src/lib/v2/visitor-runtime");
  const request = new Request("https://v2.example/api/v2/session");
  vi.stubEnv("V2_MODE", "off");
  expect((await serveVisitorRequest(request, "session")).status).toBe(404);
  vi.stubEnv("V2_MODE", "public"); vi.stubEnv("V2_WEB_DATABASE_URL", "");
  expect((await serveVisitorRequest(request, "session")).status).toBe(503);
});

test("GET rejects an unexpected host and unsupported methods do not create sessions", async () => {
  const pool = { query: vi.fn(), connect: vi.fn() };
  const api = createVisitorApi(pool as unknown as Pool, { mode: "public", origin: "https://v2.example", databaseUrl: "unused" });
  expect((await api.handle(new Request("https://evil.example/api/v2/session"), "session")).status).toBe(403);
  expect((await api.handle(new Request("https://v2.example/api/v2/session", { method: "PUT", headers: { origin: "https://v2.example" } }), "session")).status).toBe(405);
  expect(pool.connect).not.toHaveBeenCalled();
});

test("canonical Host is checked independently of a framework-internal request URL", async () => {
  const pool = { query: vi.fn(), connect: vi.fn() };
  const api = createVisitorApi(pool as unknown as Pool, { mode: "public", origin: "https://v2.example", databaseUrl: "unused" });
  const request = new Request("http://localhost:3000/api/v2/session", { headers: { host: "v2.example" } });
  expect((await api.handle(request, "session")).status).toBe(401);
  expect((await api.handle(new Request(request, { headers: { host: "evil.example", "x-forwarded-host": "v2.example" } }), "session")).status).toBe(403);
  expect(pool.query).not.toHaveBeenCalled();
});
