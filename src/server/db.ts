import { PrismaClient } from "@prisma/client";

// Single Prisma instance. ONLY the service layer (src/server/services) and the
// infrastructure utilities in src/server may import this — never route handlers.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
