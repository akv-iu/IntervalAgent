import { serveVisitorRequest } from "@/lib/v2/visitor-runtime";
export async function GET(request: Request, context: { params: Promise<{ caseId: string }> }) {
  return serveVisitorRequest(request, "case", (await context.params).caseId);
}
