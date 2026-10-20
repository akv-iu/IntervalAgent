export type VisitorConfig = { mode: "local" | "public"; origin: string; databaseUrl: string };

export function visitorConfig(env: Record<string, string | undefined> = process.env): VisitorConfig | null {
  if (!env.V2_MODE || env.V2_MODE === "off") return null;
  if (env.V2_MODE !== "local" && env.V2_MODE !== "public") throw new Error("Invalid V2_MODE");
  if (!env.V2_ORIGIN || !env.V2_WEB_DATABASE_URL) throw new Error("V2_ORIGIN and V2_WEB_DATABASE_URL are required");
  const origin = new URL(env.V2_ORIGIN), database = new URL(env.V2_WEB_DATABASE_URL);
  const localHttp = env.V2_MODE === "local" && origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if ((!localHttp && origin.protocol !== "https:") || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error("Invalid V2_ORIGIN");
  if (!["postgres:", "postgresql:"].includes(database.protocol)) throw new Error("Invalid V2_WEB_DATABASE_URL");
  return { mode: env.V2_MODE, origin: origin.origin, databaseUrl: env.V2_WEB_DATABASE_URL };
}
