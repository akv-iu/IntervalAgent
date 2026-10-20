import { serveOperatorRequest } from "@/lib/v2/operator-runtime";
export async function GET(request: Request, context: { params: Promise<{ businessId: string; workspaceId: string; caseId: string }> }) {
  return serveOperatorRequest(request, "case", await context.params);
}
