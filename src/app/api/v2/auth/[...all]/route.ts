import { serveOperatorRequest } from "@/lib/v2/operator-runtime";
export const GET = (request: Request) => serveOperatorRequest(request, "auth");
export const POST = (request: Request) => serveOperatorRequest(request, "auth");
