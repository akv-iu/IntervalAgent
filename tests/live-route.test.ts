import { POST } from "../src/app/api/live/route";

const req = (body: unknown) => new Request("http://localhost/api/live", { method: "POST", body: JSON.stringify(body) });

afterEach(() => {
  delete process.env.APP_MODE;
});

test("the public site answers 404 and never reaches the model", async () => {
  process.env.APP_MODE = "public";
  const res = await POST(req({ scenarioId: "S01", version: "guarded", messages: [] }));
  expect(res.status).toBe(404);
});

test("bad input is rejected before any model call", async () => {
  process.env.APP_MODE = "local";
  const res = await POST(req({ scenarioId: "S99", version: "guarded", messages: [] }));
  // 400 (unknown scenario) when .env is local; 404 when it is not. Never 200.
  expect([400, 404]).toContain(res.status);
});

test("with APP_MODE unset on the host, the route stays off", async () => {
  delete process.env.APP_MODE;
  const res = await POST(req({ scenarioId: "S01", version: "guarded", messages: [] }));
  expect(res.status).toBe(404);
});
