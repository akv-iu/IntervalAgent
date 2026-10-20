import { serveVisitorRequest } from "@/lib/v2/visitor-runtime";
const handle = (request: Request) => serveVisitorRequest(request, "session");
export { handle as GET, handle as POST, handle as DELETE };
