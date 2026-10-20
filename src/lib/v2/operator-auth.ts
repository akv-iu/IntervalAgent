import { betterAuth } from "better-auth";
import type { Pool } from "pg";
import type { OperatorConfig } from "./operator-config";

const cookiePrefix = (config: OperatorConfig) => `v2-operator-${config.mode}`;
export const operatorCookieName = (config: OperatorConfig) => `${config.origin.startsWith("https:") ? "__Secure-" : ""}${cookiePrefix(config)}.session_token`;

export function createOperatorAuth(pool: Pool, config: OperatorConfig) {
  // shortcut: auth profiles/expired sessions are retained; add owner-operated cleanup before public scale.
  return betterAuth({
    database: pool,
    baseURL: config.origin,
    basePath: "/api/v2/auth",
    secret: config.secret,
    trustedOrigins: [config.origin],
    socialProviders: { github: { clientId: config.githubClientId, clientSecret: config.githubClientSecret } },
    user: { modelName: "v2_auth_user" },
    session: { modelName: "v2_auth_session", expiresIn: 8 * 60 * 60, disableSessionRefresh: true, cookieCache: { enabled: false } },
    account: { modelName: "v2_auth_account", accountLinking: { enabled: false, disableImplicitLinking: true }, encryptOAuthTokens: true, storeStateStrategy: "database" },
    verification: { modelName: "v2_auth_verification" },
    advanced: { cookiePrefix: cookiePrefix(config), useSecureCookies: config.origin.startsWith("https:"), ipAddress: { disableIpTracking: true }, disableOriginCheck: false, disableCSRFCheck: false },
    // The shared database limit at the HTTP boundary works across processes without trusting proxy IPs.
    rateLimit: { enabled: false },
    telemetry: { enabled: false },
    logger: { disabled: true },
  });
}
export type OperatorAuth = ReturnType<typeof createOperatorAuth>;
