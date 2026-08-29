import "dotenv/config";

process.env.SESSION_SECRET ||=
  "test-session-secret-at-least-32-characters-long";
process.env.ALLOW_SEED = "false";
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL =
    "postgresql://contractor:contractor_dev@localhost:5432/contractor_platform?schema=public";
}
