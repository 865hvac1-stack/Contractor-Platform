import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { resetSummitDemoCompany } from "@/lib/demo/seed-summit";

async function main() {
  if (process.env.ALLOW_SUMMIT_DEMO_SEED !== "true") {
    console.error("Refusing to seed Summit demo. Set ALLOW_SUMMIT_DEMO_SEED=true for an explicit run.");
    process.exit(1);
  }
  const prisma = new PrismaClient();
  try {
    const result = await resetSummitDemoCompany(prisma);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
