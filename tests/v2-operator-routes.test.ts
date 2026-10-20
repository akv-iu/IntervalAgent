vi.mock("next/server", () => ({ connection: async () => {} }));
const serve = vi.hoisted(() => vi.fn());
vi.mock("../src/lib/v2/operator-runtime", () => ({ serveOperatorRequest: serve }));
import * as auth from "../src/app/api/v2/auth/[...all]/route";
import * as session from "../src/app/api/v2/operator/session/route";
import * as detail from "../src/app/api/v2/operator/cases/[businessId]/[workspaceId]/[caseId]/route";

afterEach(() => { vi.unstubAllEnvs(); serve.mockReset(); });
test("operator routes delegate through their separate boundary and await scoped path parameters", async () => {
  serve.mockResolvedValue(new Response(null, { status: 204 }));
  const request = new Request("https://v2.example/api/v2/operator/session");
  for (const method of [auth.GET, auth.POST]) {
    await method(request); expect(serve).toHaveBeenLastCalledWith(request, "auth");
  }
  await session.GET(request); expect(serve).toHaveBeenLastCalledWith(request, "session");
  const key = { businessId: "northside", workspaceId: "one", caseId: "two" };
  await detail.GET(request, { params: Promise.resolve(key) });
  expect(serve).toHaveBeenLastCalledWith(request, "case", key);
});

test("disabled operator endpoints and incomplete opt-in fail closed without a database", async () => {
  const { serveOperatorRequest } = await vi.importActual<typeof import("../src/lib/v2/operator-runtime")>("../src/lib/v2/operator-runtime");
  const request = new Request("https://v2.example/api/v2/operator/session");
  vi.stubEnv("V2_MODE", "off"); vi.stubEnv("V2_OPERATOR_AUTH", "true");
  expect((await serveOperatorRequest(request, "session")).status).toBe(404);
  vi.stubEnv("V2_MODE", "public"); vi.stubEnv("V2_OPERATOR_AUTH", "false");
  expect((await serveOperatorRequest(request, "session")).status).toBe(404);
  vi.stubEnv("V2_OPERATOR_AUTH", "true"); vi.stubEnv("V2_OPERATOR_DATABASE_URL", "");
  expect((await serveOperatorRequest(request, "session")).status).toBe(503);
});
