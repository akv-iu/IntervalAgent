import { visitorConfig, type VisitorConfig } from "./visitor-config";

export type OperatorConfig = VisitorConfig & { secret: string; githubClientId: string; githubClientSecret: string };

export function operatorConfig(env: Record<string, string | undefined> = process.env): OperatorConfig | null {
  if (!env.V2_MODE || env.V2_MODE === "off" || !env.V2_OPERATOR_AUTH || env.V2_OPERATOR_AUTH === "false") return null;
  if (env.V2_OPERATOR_AUTH !== "true") throw new Error("Invalid V2_OPERATOR_AUTH");
  const config = visitorConfig({ ...env, V2_WEB_DATABASE_URL: env.V2_OPERATOR_DATABASE_URL });
  if (!config || !env.V2_AUTH_SECRET || env.V2_AUTH_SECRET.length < 32 || !env.V2_GITHUB_CLIENT_ID?.trim() || !env.V2_GITHUB_CLIENT_SECRET?.trim()) throw new Error("Operator authentication configuration required");
  return { ...config, secret: env.V2_AUTH_SECRET, githubClientId: env.V2_GITHUB_CLIENT_ID, githubClientSecret: env.V2_GITHUB_CLIENT_SECRET };
}
