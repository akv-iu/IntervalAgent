import { serveVisitorRequest } from "@/lib/v2/visitor-runtime";
export const POST = (request: Request) => serveVisitorRequest(request, "cases");
