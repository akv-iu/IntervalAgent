import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const child = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", "3012"], {
  stdio: "inherit",
  env: { ...process.env, APP_MODE: "public", PUBLIC_TRY: "off", TRY_OPENAI_API_KEY: "", TRY_OPENAI_MODEL: "", DATABASE_URL: "", DATABASE_URL_READONLY: "", DATABASE_URL_LESSONS: "" },
});
child.on("exit", (code) => { process.exitCode = code ?? 1; });
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
