import { execSync } from "node:child_process";

// Apply migrations to the test database once per run.
export default function setup() {
  const url =
    process.env.TEST_DATABASE_URL ?? "postgresql://seneschal:seneschal@localhost:5432/seneschal_test";
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
}
