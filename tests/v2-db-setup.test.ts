const setup = vi.hoisted(() => ({ pools: [] as { query: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }[], migrate: vi.fn() }));
vi.mock("pg", () => ({ Pool: class {
  query = vi.fn().mockResolvedValue({ rows: [] });
  end = vi.fn().mockResolvedValue(undefined);
  constructor() { setup.pools.push(this); }
} }));
vi.mock("../src/lib/db-admin", () => ({ migrate: setup.migrate }));
import { testSchema } from "./db/helpers";

test("failed database setup removes only its newly created test schema and closes its pools", async () => {
  const failure = new Error("injected migration failure");
  setup.migrate.mockRejectedValue(failure);
  await expect(testSchema()).rejects.toBe(failure);
  const [admin, pool] = setup.pools;
  const schema = admin.query.mock.calls[0][0].match(/^create schema (test_[a-f0-9]{12})$/)?.[1];
  expect(schema).toBeTruthy();
  expect(admin.query.mock.calls).toEqual([[`create schema ${schema}`], [`drop schema ${schema} cascade`]]);
  expect(pool.end).toHaveBeenCalledOnce(); expect(admin.end).toHaveBeenCalledOnce();
});
