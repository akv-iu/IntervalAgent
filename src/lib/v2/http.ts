import { z } from "zod";
import { investigate } from "./agents";
import { boundedModel } from "./model";
import { describeFailure } from "./failures";
import { CaseCommand } from "./contracts";
import { beginCommand, budgetUsage, commitResult, createWorkspace, failRun, readWorkspace, recordLive, reserveLive, resetWorkspace, startLive, V2Error, v2Config } from "./store";

const COOKIE = "recovery_v2";
const ControlSchema = z.object({ action: z.enum(["create", "reset"]) }).strict();
const response = (data: unknown, status = 200, cookie?: string) => Response.json(data, { status, headers: { "Cache-Control": "no-store", ...(cookie ? { "Set-Cookie": cookie } : {}) } });

async function body(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new V2Error(400, "Request body required.");
  const chunks: Uint8Array[] = []; let length = 0;
  while (true) {
    const chunk = await reader.read(); if (chunk.done) break;
    length += chunk.value.length;
    if (length > 16_384) { await reader.cancel(); throw new V2Error(413, "Request is too large."); }
    chunks.push(chunk.value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new V2Error(400, "Valid JSON required."); }
}

export async function handleV2(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const host = request.headers.get("host") ?? "";
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/.test(host)) throw new V2Error(403, "Phase 1 is a local-only demonstration.");
    v2Config();
    const token = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) ?? "";
    if (request.method === "GET") return response({ workspace: await readWorkspace(token), budget: await budgetUsage() });
    if (request.method !== "POST") return response({ error: "Method not allowed" }, 405);
    // Next.js normalizes loopback URLs to localhost; Host retains the browser's authority.
    if (request.headers.get("origin") !== `${url.protocol}//${host}`) throw new V2Error(403, "Same-origin action required.");
    const value = await body(request);
    const control = ControlSchema.safeParse(value);
    if (control.success) {
      if (control.data.action === "reset") return response({ workspace: await resetWorkspace(token), budget: await budgetUsage() });
      if (token) {
        try { return response({ workspace: await readWorkspace(token), budget: await budgetUsage() }); }
        catch (error) { if (!(error instanceof V2Error) || ![401, 410].includes(error.status)) throw error; }
      }
      const created = await createWorkspace();
      return response({ workspace: created.view, budget: await budgetUsage() }, 201, `${COOKIE}=${created.token}; Path=/api/v2; Max-Age=86400; HttpOnly; SameSite=Strict`);
    }
    const command = CaseCommand.safeParse(value);
    if (!command.success) throw new V2Error(400, "Invalid case action or message.");
    const job = await beginCommand(token, command.data);
    if (job) {
      try {
        const config = v2Config();
        if (!config.apiKey) throw new V2Error(503, "Live model key is missing. Set V2_OPENAI_API_KEY in ignored .env.v2.");
        const signal = AbortSignal.any([request.signal, AbortSignal.timeout(90_000)]);
        const model = boundedModel({ apiKey: config.apiKey, reserve: (id) => reserveLive(id, { token, job }), start: (call) => startLive(call, { token, job }), record: (call) => recordLive(call, { token, job }), signal });
        const result = await investigate(job.input, model, signal);
        await commitResult(token, job, result);
      } catch (error) {
        const failure = error instanceof V2Error ? { kind: "configuration", status: error.status, message: error.message } : describeFailure(error);
        await failRun(token, job, failure).catch(() => {});
        if (error instanceof V2Error) throw error;
        throw new V2Error(503, failure.message);
      }
    }
    return response({ workspace: await readWorkspace(token), budget: await budgetUsage() });
  } catch (error) {
    return error instanceof V2Error ? response({ error: error.message }, error.status) : response({ error: "V2 is temporarily unavailable. Check the isolated local setup." }, 503);
  }
}
