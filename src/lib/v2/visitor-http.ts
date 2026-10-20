export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function visitorResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  const options = { status, headers: { "Cache-Control": "private, no-store", "Vary": "Cookie", "X-Content-Type-Options": "nosniff", ...headers } };
  return status === 204 ? new Response(null, options) : Response.json(body, options);
}

export async function readVisitorJson(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new HttpError(415, "JSON content required.");
  if (Number(request.headers.get("content-length")) > 4096) throw new HttpError(413, "Request too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "JSON body required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new HttpError(408, "Request body timed out.")), 5000); });
  try {
    for (;;) {
      const { value, done } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      size += value.byteLength;
      if (size > 4096) throw new HttpError(413, "Request too large.");
      if (value.byteLength) chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Invalid JSON body.");
  } finally {
    clearTimeout(deadline);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
