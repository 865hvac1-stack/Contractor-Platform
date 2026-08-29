import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

/**
 * Development seed ONLY.
 * Refuses to run unless ALLOW_SEED=true.
 * Never set ALLOW_SEED=true in production.
 */
async function main() {
  if (process.env.ALLOW_SEED !== "true") {
    console.error("Refusing to seed: set ALLOW_SEED=true for local/dev use only.");
    process.exit(1);
  }
  if (process.env.NODE_ENV === "production") {
    console.error("Refusing to seed in production.");
    process.exit(1);
  }

  const prisma = new PrismaClient();
  const ownerEmail = (process.env.SEED_OWNER_EMAIL || "owner@865hvac.local").toLowerCase();
  const ownerPassword = process.env.SEED_OWNER_PASSWORD;
  const adminEmail = (process.env.SEED_PLATFORM_ADMIN_EMAIL || "admin@platform.local").toLowerCase();
  const adminPassword = process.env.SEED_PLATFORM_ADMIN_PASSWORD;

  if (!ownerPassword || !adminPassword) {
    console.error("SEED_OWNER_PASSWORD and SEED_PLATFORM_ADMIN_PASSWORD are required.");
    process.exit(1);
  }

  const ownerHash = await bcrypt.hash(ownerPassword, 12);
  const adminHash = await bcrypt.hash(adminPassword, 12);

  const platformAdmin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: { passwordHash: adminHash, isPlatformAdmin: true },
    create: {
      email: adminEmail,
      passwordHash: adminHash,
      firstName: "Platform",
      lastName: "Admin",
      isPlatformAdmin: true,
    },
  });

  const owner = await prisma.user.upsert({
    where: { email: ownerEmail },
    update: { passwordHash: ownerHash },
    create: {
      email: ownerEmail,
      passwordHash: ownerHash,
      firstName: "Demo",
      lastName: "Owner",
    },
  });

  let company = await prisma.company.findFirst({
    where: {
      businessName: "865 HVAC",
      memberships: { some: { userId: owner.id } },
    },
  });

  if (!company) {
    company = await prisma.company.create({
      data: {
        businessName: "865 HVAC",
        legalName: "865 HVAC LLC",
        industry: "HVAC",
        phone: "865-555-0100",
        email: "office@865hvac.local",
        city: "Knoxville",
        state: "TN",
        zip: "37902",
        timezone: "America/New_York",
        companySize: "2-5",
        serviceArea: "Knoxville metro",
        status: "ACTIVE",
        onboardingStep: 5,
        memberships: {
          create: {
            userId: owner.id,
            role: "COMPANY_OWNER",
            status: "ACTIVE",
            joinedAt: new Date(),
          },
        },
        numberSequences: {
          create: [
            { kind: "JOB", prefix: "JOB", nextValue: 1 },
            { kind: "ESTIMATE", prefix: "EST", nextValue: 1 },
            { kind: "INVOICE", prefix: "INV", nextValue: 1 },
          ],
        },
      },
    });
  }

  await prisma.auditLog.create({
    data: {
      companyId: company.id,
      actorId: owner.id,
      action: "seed.completed",
      entityType: "Company",
      entityId: company.id,
      metadata: {
        note: "Development seed only — demo company 865 HVAC with zero operational records",
        platformAdminId: platformAdmin.id,
      },
    },
  });

  console.log("Seed complete (development only).");
  console.log(`  Company: ${company.businessName} (${company.id})`);
  console.log(`  Owner:   ${ownerEmail}`);
  console.log(`  Admin:   ${adminEmail}`);
  console.log("  No fake customers, jobs, or financial records were created.");

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
