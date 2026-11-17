import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

if (existsSync(".env.v2")) throw new Error(".env.v2 already exists; keep its configuration and start the existing database");
const password = randomBytes(24).toString("hex");
const result = spawnSync("docker", ["run", "--detach", "--pull=missing", "--name", "intervalagent-v2-phase1", "--publish", "127.0.0.1:55442:5432", "--env", `POSTGRES_PASSWORD=${password}`, "--env", "POSTGRES_DB=intervalagent_v2", "--volume", "intervalagent-v2-phase1:/var/lib/postgresql/data", "postgres:17-alpine"], { stdio: ["ignore", "pipe", "pipe"] });
if (result.status !== 0) throw new Error("Cannot start the isolated V2 container. Check Docker/container/port availability; existing databases were not changed.");
writeFileSync(".env.v2", `V2_ENABLED=true\nV2_DATABASE_URL=postgresql://postgres:${password}@127.0.0.1:55442/intervalagent_v2\n`, { flag: "wx" });
console.log("Isolated local V2 database started on loopback port 55442. Configuration saved to ignored .env.v2. No V1 connection used.");
