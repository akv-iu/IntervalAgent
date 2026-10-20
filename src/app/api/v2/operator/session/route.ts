import { serveOperatorRequest } from "@/lib/v2/operator-runtime";
export const GET = (request: Request) => serveOperatorRequest(request, "session");
