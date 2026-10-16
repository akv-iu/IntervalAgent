import { projectEnv } from "../../src/lib/project-env";

// Fail loudly instead of silently skipping the suite.
const url = process.env.TEST_DATABASE_URL || projectEnv().TEST_DATABASE_URL;
if (!url) throw new Error("npm run test:db needs TEST_DATABASE_URL (a dedicated throwaway database) in .env");
process.env.TEST_DATABASE_URL = url;
