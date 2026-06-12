// Dev utility: mint a session token for a seeded user (local testing only).
import { PrismaClient } from "@prisma/client";
import { generateToken } from "../src/server/crypto";

const prisma = new PrismaClient();
async function main() {
  const email = process.argv[2] ?? "farina@example.com";
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error(`No user ${email} — run pnpm db:seed first`);
  const { token, tokenHash } = generateToken();
  await prisma.session.create({
    data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + 86_400_000) },
  });
  console.log(token);
}
main().finally(() => prisma.$disconnect());
