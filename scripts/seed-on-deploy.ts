// Optional build-time bootstrap for serverless deployments: when
// SEED_ON_DEPLOY=true, run the idempotent seed during `vercel-build`
// (DATABASE_URL is already required at that point). SEED_ADMIN_EMAIL attaches
// a real operator inbox as FIDUCIARY so the sign-in OTP has somewhere to go.
//
// Build logs are project-private but they are a passive record read by anyone
// with project access, and a proof-upload link is a live bearer credential
// (#57). In production the link is withheld and the operator is pointed at the
// app instead; outside production it is printed, because that is where an
// operator is wiring up a preview and the link is disposable.
import { runSeed } from "../src/server/seed";
import { prisma } from "../src/server/db";

async function main() {
  if (process.env.SEED_ON_DEPLOY !== "true") {
    console.log("seed-on-deploy: skipped (set SEED_ON_DEPLOY=true to bootstrap)");
    return;
  }
  const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim() || undefined;
  const result = await runSeed({ adminEmail });
  console.log("seed-on-deploy: complete");
  if (adminEmail) console.log(`seed-on-deploy: operator login enabled for ${adminEmail}`);
  if (result.proofLinkUrl) {
    console.log(
      process.env.NODE_ENV === "production"
        ? "seed-on-deploy: a live proof-upload link was created — open it from the proof request in the app"
        : `seed-on-deploy: live proof-upload link → ${result.proofLinkUrl}`,
    );
  }
}

main()
  .catch((e) => {
    console.error("seed-on-deploy failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
