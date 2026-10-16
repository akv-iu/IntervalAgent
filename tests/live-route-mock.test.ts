// The route with a local .env and live switched off: answers from the mock agent, no key, no network.
vi.mock("../src/lib/project-env", async (orig) => ({
  ...(await orig<typeof import("../src/lib/project-env")>()),
  projectEnv: () => ({ APP_MODE: "local" }),
}));
import { POST } from "../src/app/api/live/route";

afterEach(() => {
  delete process.env.APP_MODE;
});

test("live off: the mock agent answers without a key", async () => {
  process.env.APP_MODE = "local";
  const res = await POST(new Request("http://localhost/api/live", { method: "POST", body: JSON.stringify({ scenarioId: "S01", version: "guarded", messages: [] }) }));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.text).toMatch(/\$84\.00/);
  expect(body.agent).toBe("mock");
});
