import { serveVisitorRequest } from "@/lib/v2/visitor-runtime";
export async function POST(request: Request, context: { params: Promise<{ caseId: string }> }) {
  return serveVisitorRequest(request, "messages", (await context.params).caseId);
}
