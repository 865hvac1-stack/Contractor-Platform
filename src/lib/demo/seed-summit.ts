import type { Prisma, PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import {
  DEMO_CUSTOMER_EMAIL_DOMAIN,
  DEMO_PASSWORD,
  DEMO_PROVIDER,
  DEMO_SOURCE,
  SUMMIT_ADDRESS,
  SUMMIT_CITY,
  SUMMIT_COMPANY_NAME,
  SUMMIT_DESCRIPTION,
  SUMMIT_EMAIL,
  SUMMIT_HOURS,
  SUMMIT_LOGO_HORIZONTAL,
  SUMMIT_NAVY,
  SUMMIT_ORANGE,
  SUMMIT_PHONE,
  SUMMIT_SERVICE_AREA,
  SUMMIT_STATE,
  SUMMIT_TAGLINE,
  SUMMIT_TEAM,
  SUMMIT_WEBSITE,
  SUMMIT_ZIP,
  demoUserEmail,
} from "@/lib/demo/constants";
import { CITIES, FIRST_NAMES, LAST_NAMES, PRICEBOOK, STREETS } from "@/lib/demo/catalog";
import { addDemoDays, atDemoHour, monthsAgo } from "@/lib/demo/dates";
import { assertResettableDemoCompany } from "@/lib/demo/guard";
import { wipeDemoCompany } from "@/lib/demo/wipe";
import { getStarterTemplate } from "@/lib/playbooks/templates";
import { assignPlaybookToJob } from "@/lib/playbooks/assign";
import { seedCustomer360Showcase } from "@/lib/demo/seed-customer-360";

export type DemoSeedCounts = {
  companyId: string;
  companyName: string;
  team: number;
  customers: number;
  properties: number;
  equipment: number;
  historicalJobs: number;
  todayJobs: number;
  upcomingJobs: number;
  estimates: number;
  invoices: number;
  payments: number;
  memberships: number;
  leads: number;
  threads: number;
  reviews: number;
  expenses: number;
  receipts: number;
  socialPosts: number;
  playbooks: number;
  pricebookCategories: number;
  pricebookItems: number;
};

function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function pick<T>(random: () => number, items: readonly T[]) {
  return items[Math.floor(random() * items.length)]!;
}

async function ensurePlaybook(prisma: PrismaClient, companyId: string, userId: string, templateKey: string, name: string) {
  const template = getStarterTemplate(templateKey);
  if (!template) throw new Error(`Missing playbook template ${templateKey}`);
  const playbook = await prisma.playbook.create({
    data: { companyId, name, status: "ACTIVE", sortOrder: 1 },
  });
  const version = await prisma.playbookVersion.create({
    data: {
      companyId,
      playbookId: playbook.id,
      versionNumber: 1,
      definition: template.definition as unknown as Prisma.InputJsonValue,
      createdById: userId,
    },
  });
  await prisma.playbook.update({ where: { id: playbook.id }, data: { currentVersionId: version.id } });
  return playbook;
}

export async function resetSummitDemoCompany(prisma: PrismaClient, now = new Date()): Promise<DemoSeedCounts> {
  let company = await prisma.company.findFirst({
    where: { isDemo: true, businessName: SUMMIT_COMPANY_NAME },
  });
  if (company) {
    assertResettableDemoCompany(company);
    await wipeDemoCompany(prisma, company.id);
    company = await prisma.company.update({
      where: { id: company.id },
      data: {
        legalName: "Summit Home Services LLC",
        tradeName: "Summit",
        industry: "HVAC",
        phone: SUMMIT_PHONE,
        email: SUMMIT_EMAIL,
        website: SUMMIT_WEBSITE,
        address: SUMMIT_ADDRESS,
        city: SUMMIT_CITY,
        state: SUMMIT_STATE,
        zip: SUMMIT_ZIP,
        timezone: "America/New_York",
        logoUrl: SUMMIT_LOGO_HORIZONTAL,
        primaryColor: SUMMIT_NAVY,
        accentColor: SUMMIT_ORANGE,
        tagline: SUMMIT_TAGLINE,
        description: SUMMIT_DESCRIPTION,
        hoursNote: SUMMIT_HOURS,
        serviceArea: SUMMIT_SERVICE_AREA,
        isDemo: true,
        allowExternalIntegrationTesting: true,
        status: "ACTIVE",
        companySize: "18-25",
      },
    });
  } else {
    company = await prisma.company.create({
      data: {
        businessName: SUMMIT_COMPANY_NAME,
        legalName: "Summit Home Services LLC",
        tradeName: "Summit",
        industry: "HVAC",
        phone: SUMMIT_PHONE,
        email: SUMMIT_EMAIL,
        website: SUMMIT_WEBSITE,
        address: SUMMIT_ADDRESS,
        city: SUMMIT_CITY,
        state: SUMMIT_STATE,
        zip: SUMMIT_ZIP,
        timezone: "America/New_York",
        logoUrl: SUMMIT_LOGO_HORIZONTAL,
        primaryColor: SUMMIT_NAVY,
        accentColor: SUMMIT_ORANGE,
        tagline: SUMMIT_TAGLINE,
        description: SUMMIT_DESCRIPTION,
        hoursNote: SUMMIT_HOURS,
        serviceArea: SUMMIT_SERVICE_AREA,
        isDemo: true,
        allowExternalIntegrationTesting: true,
        status: "ACTIVE",
        companySize: "18-25",
      },
    });
  }

  if (!company) throw new Error("Summit demo company could not be created.");
  const tenant = company;

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const users: Record<string, { id: string; role: (typeof SUMMIT_TEAM)[number]["role"] }> = {};
  for (const member of SUMMIT_TEAM) {
    const email = demoUserEmail(member.firstName, member.lastName);
    const user = await prisma.user.upsert({
      where: { email },
      update: { passwordHash, firstName: member.firstName, lastName: member.lastName },
      create: { email, passwordHash, firstName: member.firstName, lastName: member.lastName },
    });
    await prisma.membership.create({
      data: { companyId: tenant.id, userId: user.id, role: member.role, status: "ACTIVE", joinedAt: monthsAgo(now, 10) },
    });
    users[member.key] = { id: user.id, role: member.role };
  }

  const ownerId = users.jake!.id;
  await prisma.numberSequence.createMany({
    data: [
      { companyId: tenant.id, kind: "JOB", prefix: "SUM", nextValue: 1300, padding: 5 },
      { companyId: tenant.id, kind: "ESTIMATE", prefix: "SE", nextValue: 400, padding: 4 },
      { companyId: tenant.id, kind: "INVOICE", prefix: "SI", nextValue: 400, padding: 4 },
    ],
  });

  const playbooks = {
    service: await ensurePlaybook(prisma, company.id, ownerId, "residential_service", "Residential Service Call"),
    maintenance: await ensurePlaybook(prisma, company.id, ownerId, "residential_maintenance", "Residential Maintenance"),
    install: await ensurePlaybook(prisma, company.id, ownerId, "residential_changeout", "System Replacement / Install"),
    sales: await ensurePlaybook(prisma, company.id, ownerId, "estimate_sales", "Sales Estimate"),
    plumbing: await ensurePlaybook(prisma, company.id, ownerId, "residential_service", "Plumbing Service"),
  };

  const serviceTypes = await Promise.all(
    [
      ["no_cooling", "No Cooling", playbooks.service.id],
      ["no_heat", "No Heat", playbooks.service.id],
      ["hvac_diagnostic", "HVAC Diagnostic", playbooks.service.id],
      ["maintenance", "Maintenance", playbooks.maintenance.id],
      ["install", "Installation", playbooks.install.id],
      ["estimate", "System Estimate", playbooks.sales.id],
      ["plumbing", "Plumbing Service", playbooks.plumbing.id],
      ["water_heater", "Water Heater", playbooks.plumbing.id],
    ].map(([key, name, playbookId], index) =>
      prisma.serviceType.create({
        data: { companyId: tenant.id, key, name, playbookId, sortOrder: index, description: name },
      })
    )
  );

  const categories: Record<string, string> = {};
  let pricebookItems = 0;
  const catalogItems: Array<{ id: string; name: string; price: number; cost: number }> = [];
  for (const [index, group] of PRICEBOOK.entries()) {
    const category = await prisma.pricebookCategory.create({
      data: { companyId: tenant.id, name: group.category, sortOrder: index },
    });
    categories[group.category] = category.id;
    for (const [itemIndex, item] of group.items.entries()) {
      const created = await prisma.pricebookItem.create({
        data: {
          companyId: tenant.id,
          categoryId: category.id,
          name: item.name,
          type: "SERVICE",
          standardPriceCents: item.price,
          memberPriceCents: Math.round(item.price * 0.9),
          internalCostCents: item.cost,
          sortOrder: itemIndex,
          customerDescription: item.name,
        },
      });
      catalogItems.push({ id: created.id, name: created.name, price: item.price, cost: item.cost });
      pricebookItems += 1;
    }
  }

  const plan = await prisma.membershipPlan.create({
    data: {
      companyId: tenant.id,
      name: "Summit Comfort Club",
      description: "2 maintenance visits, priority scheduling, reduced diagnostic fee, and repair discount.",
      priceCents: 19900,
      billingFrequency: "ANNUAL",
      includedVisits: 2,
      discountPercent: 10,
      priorityService: true,
      benefits: "2 maintenance visits · priority scheduling · reduced diagnostic fee · repair discount · member reminders",
      terms: "Demo membership plan. Not a real offer.",
    },
  });

  const random = rng(8652026);
  const customers: Array<{ id: string; propertyIds: string[]; firstName: string; lastName: string; phone: string; showcase?: string }> = [];

  const showcase = [
    { first: "Patricia", last: "Holloway", tag: "member-two-systems", city: 0 },
    { first: "Raymond", last: "Whitaker", tag: "aging-system", city: 1 },
    { first: "Olivia", last: "Grant", tag: "google-emergency", city: 0 },
    { first: "Nathan", last: "Crowe", tag: "landlord", city: 2 },
    { first: "Camille", last: "Ortega", tag: "install-customer", city: 3 },
  ];

  for (let i = 0; i < 100; i += 1) {
    const first = i < 5 ? showcase[i]!.first : FIRST_NAMES[i]!;
    const last = i < 5 ? showcase[i]!.last : LAST_NAMES[i]!;
    const city = CITIES[i < 5 ? showcase[i]!.city : i % CITIES.length]!;
    const created = monthsAgo(now, 1 + (i % 11), 4 + (i % 20));
    const customer = await prisma.customer.create({
      data: {
        companyId: tenant.id,
        firstName: first,
        lastName: last,
        businessName:
          i < 5 ? null : i % 17 === 0 ? `${last} Holdings` : i % 23 === 0 ? `${last} Properties` : null,
        email: `${first}.${last}.${i}@${DEMO_CUSTOMER_EMAIL_DOMAIN}`.toLowerCase(),
        phone: `(865) 555-${String(1000 + i).padStart(4, "0")}`,
        preferredContactMethod: i % 3 === 0 ? "TEXT" : i % 3 === 1 ? "PHONE" : "EMAIL",
        notes: i < 5 ? `Showcase customer — ${showcase[i]!.tag}` : i % 9 === 0 ? "Prefers afternoon windows." : "Residential account.",
        status: i % 31 === 0 ? "INACTIVE" : "ACTIVE",
        tags: i < 5 ? ["Showcase", showcase[i]!.tag] : i % 4 === 0 ? ["Member"] : i % 7 === 0 ? ["Repeat"] : ["Residential"],
        source: pick(random, ["Google LSA", "Website", "Referral", "Repeat", "Facebook", "Direct"]),
        sourceSystem: DEMO_SOURCE,
        createdAt: created,
      },
    });
    const extra = i === 3 ? 2 : i % 8 === 0 ? 1 : 0;
    const propertyIds: string[] = [];
    for (let p = 0; p <= extra; p += 1) {
      const property = await prisma.property.create({
        data: {
          companyId: tenant.id,
          customerId: customer.id,
          name: p === 0 ? "Primary home" : `Rental ${p}`,
          address: `${100 + i * 3 + p} ${STREETS[(i + p) % STREETS.length]}`,
          city: city.city,
          state: "TN",
          zip: city.zip,
          propertyType: i === 3 || i % 23 === 0 ? "MULTI_FAMILY" : i % 19 === 0 ? "COMMERCIAL" : "RESIDENTIAL",
          isPrimary: p === 0,
          sourceSystem: DEMO_SOURCE,
        },
      });
      propertyIds.push(property.id);
    }
    customers.push({
      id: customer.id,
      propertyIds,
      firstName: first,
      lastName: last,
      phone: `(865) 555-${String(1000 + i).padStart(4, "0")}`,
      showcase: i < 5 ? showcase[i]!.tag : undefined,
    });
  }

  let equipmentCount = 0;
  for (const [index, customer] of customers.entries()) {
    for (const [pIndex, propertyId] of customer.propertyIds.entries()) {
      const age = 2 + ((index + pIndex) % 14);
      await prisma.equipment.create({
        data: {
          companyId: tenant.id,
          customerId: customer.id,
          propertyId,
          name: age > 12 ? "Aging heat pump" : "Heat pump",
          equipmentType: "HEAT_PUMP",
          manufacturer: pick(random, ["Carrier", "Trane", "Lennox", "Rheem", "Goodman"]),
          model: `SHS-${3 + (index % 4)}T-HP`,
          serialNumber: `DEMO-HP-${String(index + 1).padStart(4, "0")}-${pIndex}`,
          installDate: monthsAgo(now, age * 12, 8),
          warrantyExpiresAt: age < 5 ? addDemoDays(now, 400) : monthsAgo(now, 8),
          warrantyNotes: age < 5 ? "Parts warranty active" : "Warranty expired",
          notes: age > 12 ? "Repeated repairs on the outdoor unit." : null,
          sourceSystem: DEMO_SOURCE,
        },
      });
      equipmentCount += 1;
      if (index % 5 === 0 || customer.showcase === "member-two-systems") {
        await prisma.equipment.create({
          data: {
            companyId: tenant.id,
            customerId: customer.id,
            propertyId,
            name: "Gas furnace",
            equipmentType: "FURNACE",
            manufacturer: "Trane",
            model: "SHS-80F",
            serialNumber: `DEMO-FN-${String(index + 1).padStart(4, "0")}`,
            installDate: monthsAgo(now, 6 * 12, 3),
            sourceSystem: DEMO_SOURCE,
          },
        });
        equipmentCount += 1;
      }
      if (index % 6 === 0 || customer.showcase === "landlord") {
        await prisma.equipment.create({
          data: {
            companyId: tenant.id,
            customerId: customer.id,
            propertyId,
            name: age > 10 ? "Water heater near replacement" : "Tank water heater",
            equipmentType: "WATER_HEATER",
            manufacturer: "Rheem",
            model: "SHS-40G",
            serialNumber: `DEMO-WH-${String(index + 1).padStart(4, "0")}-${pIndex}`,
            installDate: monthsAgo(now, Math.max(3, age) * 12, 15),
            sourceSystem: DEMO_SOURCE,
          },
        });
        equipmentCount += 1;
      }
    }
  }

  const techs = ["chris", "daniel", "marcus", "austin", "ryan", "jordan"] as const;
  const jobTypes = [
    { type: "No Cooling", trade: "HVAC" as const, playbook: playbooks.service.id, service: "no_cooling" },
    { type: "No Heat", trade: "HVAC" as const, playbook: playbooks.service.id, service: "no_heat" },
    { type: "HVAC Diagnostic", trade: "HVAC" as const, playbook: playbooks.service.id, service: "hvac_diagnostic" },
    { type: "Maintenance", trade: "HVAC" as const, playbook: playbooks.maintenance.id, service: "maintenance" },
    { type: "AC Repair", trade: "HVAC" as const, playbook: playbooks.service.id, service: "no_cooling" },
    { type: "Heat Pump Repair", trade: "HVAC" as const, playbook: playbooks.service.id, service: "hvac_diagnostic" },
    { type: "Plumbing Diagnostic", trade: "PLUMBING" as const, playbook: playbooks.plumbing.id, service: "plumbing" },
    { type: "Leak Repair", trade: "PLUMBING" as const, playbook: playbooks.plumbing.id, service: "plumbing" },
    { type: "Water Heater Repair", trade: "PLUMBING" as const, playbook: playbooks.plumbing.id, service: "water_heater" },
    { type: "System Replacement", trade: "HVAC" as const, playbook: playbooks.install.id, service: "install" },
  ];

  let jobSeq = 1001;
  const jobs: Array<{ id: string; customerId: string; propertyId: string; completed: boolean; type: string; when: Date }> = [];

  async function createJob(input: {
    customer: (typeof customers)[number];
    when: Date;
    type: (typeof jobTypes)[number];
    status: "SCHEDULED" | "DISPATCHED" | "IN_PROGRESS" | "COMPLETED" | "CANCELED" | "ON_HOLD";
    techKey: string;
    completed?: boolean;
    description: string;
    showcase?: boolean;
    unassigned?: boolean;
    priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT";
    scheduleLocked?: boolean;
  }) {
    const number = `SUM-${String(jobSeq).padStart(5, "0")}`;
    jobSeq += 1;
    const serviceType = serviceTypes.find((row) => row.key === input.type.service);
    const job = await prisma.job.create({
      data: {
        companyId: tenant.id,
        customerId: input.customer.id,
        propertyId: input.customer.propertyIds[0]!,
        jobNumber: number,
        jobType: input.type.type,
        serviceTypeId: serviceType?.id,
        trade: input.type.trade,
        status: input.status,
        priority: input.priority ?? (input.type.type.includes("No Cooling") ? "HIGH" : "NORMAL"),
        source: input.customer.showcase === "google-emergency" ? "GOOGLE_LSA" : "Repeat",
        description: input.description,
        internalNotes: input.showcase ? "Showcase job for sales walkthrough." : null,
        scheduledStart: input.when,
        scheduledEnd: new Date(input.when.getTime() + 90 * 60 * 1000),
        scheduleLocked: input.scheduleLocked ?? false,
        completedAt: input.completed ? new Date(input.when.getTime() + 2 * 60 * 60 * 1000) : null,
        playbookId: input.type.playbook,
        sourceSystem: DEMO_SOURCE,
        importMode: "LIVE",
      },
    });
    const tech = users[input.techKey];
    if (tech && !input.unassigned) {
      await prisma.jobAssignment.create({ data: { jobId: job.id, userId: tech.id } });
    }
    if (input.showcase || input.status !== "COMPLETED") {
      await assignPlaybookToJob({ companyId: tenant.id, jobId: job.id, playbookId: input.type.playbook });
    }
    jobs.push({
      id: job.id,
      customerId: input.customer.id,
      propertyId: input.customer.propertyIds[0]!,
      completed: Boolean(input.completed),
      type: input.type.type,
      when: input.when,
    });
    return job;
  }

  for (let i = 0; i < 210; i += 1) {
    const customer = customers[i % customers.length]!;
    const daysBack = 2 + Math.floor(i * 1.4);
    const when = addDemoDays(now, -daysBack, 8 + (i % 8), i % 2 === 0 ? 0 : 30);
    const type = jobTypes[i % jobTypes.length]!;
    const techKey = type.trade === "PLUMBING" ? "jordan" : techs[i % (techs.length - 1)]!;
    const status = i % 37 === 0 ? "CANCELED" : i % 29 === 0 ? "ON_HOLD" : "COMPLETED";
    await createJob({
      customer,
      when,
      type,
      status,
      techKey,
      completed: status === "COMPLETED",
      description: `${type.type} at the ${customer.lastName} property.`,
      showcase: Boolean(customer.showcase) && i < 8,
    });
  }

  const todayPlan: Array<{
    hour: number;
    minute: number;
    type: (typeof jobTypes)[number];
    status: "SCHEDULED" | "DISPATCHED" | "IN_PROGRESS" | "COMPLETED" | "ON_HOLD";
    tech: string;
    customer: number;
    description: string;
    scheduleLocked?: boolean;
  }> = [
    { hour: 7, minute: 30, type: jobTypes[3]!, status: "COMPLETED", tech: "chris", customer: 0, description: "Comfort Club maintenance, upstairs system." },
    { hour: 8, minute: 0, type: jobTypes[0]!, status: "COMPLETED", tech: "daniel", customer: 2, description: "Upstairs unit stopped cooling overnight." },
    { hour: 8, minute: 30, type: jobTypes[7]!, status: "IN_PROGRESS", tech: "jordan", customer: 8, description: "Kitchen supply line leak." },
    { hour: 9, minute: 0, type: jobTypes[2]!, status: "IN_PROGRESS", tech: "marcus", customer: 1, description: "Heat pump short-cycling." },
    { hour: 10, minute: 30, type: jobTypes[3]!, status: "DISPATCHED", tech: "austin", customer: 10, description: "Spring maintenance visit." },
    { hour: 11, minute: 0, type: jobTypes[0]!, status: "DISPATCHED", tech: "ryan", customer: 12, description: "No cooling in the bonus room." },
    { hour: 12, minute: 30, type: jobTypes[9]!, status: "SCHEDULED", tech: "ethan", customer: 4, description: "System replacement walkthrough and start." },
    { hour: 13, minute: 0, type: jobTypes[8]!, status: "SCHEDULED", tech: "jordan", customer: 15, description: "Water heater making popping sounds." },
    { hour: 14, minute: 0, type: jobTypes[4]!, status: "SCHEDULED", tech: "chris", customer: 18, description: "Follow-up AC repair after Saturday call.", scheduleLocked: true },
    { hour: 14, minute: 30, type: jobTypes[3]!, status: "SCHEDULED", tech: "daniel", customer: 21, description: "Member tune-up." },
    { hour: 15, minute: 30, type: jobTypes[0]!, status: "SCHEDULED", tech: "marcus", customer: 24, description: "No cooling, older condenser." },
    { hour: 16, minute: 0, type: jobTypes[2]!, status: "ON_HOLD", tech: "austin", customer: 1, description: "Estimate follow-up after diagnostic." },
    { hour: 16, minute: 0, type: jobTypes[9]!, status: "SCHEDULED", tech: "chris", customer: 6, description: "Replacement estimate for the aging outdoor unit." },
    { hour: 16, minute: 30, type: jobTypes[4]!, status: "SCHEDULED", tech: "daniel", customer: 7, description: "Repair after the morning no-cooling call." },
    { hour: 11, minute: 30, type: jobTypes[4]!, status: "SCHEDULED", tech: "marcus", customer: 9, description: "Callback after Saturday diagnostic." },
  ];

  let todayJobs = 0;
  for (const row of todayPlan) {
    await createJob({
      customer: customers[row.customer]!,
      when: atDemoHour(now, row.hour, row.minute),
      type: row.type,
      status: row.status,
      techKey: row.tech,
      completed: row.status === "COMPLETED",
      description: row.description,
      showcase: row.customer < 5,
      scheduleLocked: row.scheduleLocked,
    });
    todayJobs += 1;
  }

  await createJob({
    customer: customers[30]!,
    when: atDemoHour(now, 13, 0),
    type: jobTypes[0]!,
    status: "SCHEDULED",
    techKey: "chris",
    unassigned: true,
    priority: "URGENT",
    description: "Emergency no cooling — waiting for the next available HVAC technician.",
    showcase: true,
  });
  todayJobs += 1;

  let upcomingJobs = 0;
  for (let i = 1; i <= 12; i += 1) {
    await createJob({
      customer: customers[(i * 3) % customers.length]!,
      when: addDemoDays(now, i, 8 + (i % 6), 0),
      type: jobTypes[i % jobTypes.length]!,
      status: "SCHEDULED",
      techKey: techs[i % techs.length]!,
      description: "Upcoming scheduled work.",
    });
    upcomingJobs += 1;
  }

  const completedJobs = jobs.filter((job) => job.completed);
  let invoiceSeq = 1001;
  let estimateSeq = 1001;
  let invoices = 0;
  let payments = 0;
  let estimates = 0;

  for (const [index, job] of completedJobs.slice(0, 36).entries()) {
    const item = catalogItems[index % catalogItems.length]!;
    const qty = 1;
    const total = item.price * qty;
    const paid = index % 7 === 0 ? Math.round(total * 0.4) : index % 11 === 0 ? 0 : total;
    const overdue = index % 11 === 0;
    const invoice = await prisma.invoice.create({
      data: {
        companyId: tenant.id,
        customerId: job.customerId,
        propertyId: job.propertyId,
        jobId: job.id,
        invoiceNumber: `SI-${String(invoiceSeq).padStart(4, "0")}`,
        status: paid === 0 ? (overdue ? "OVERDUE" : "SENT") : paid < total ? "PARTIALLY_PAID" : "PAID",
        issueDate: job.when,
        dueDate: addDemoDays(job.when, overdue ? -6 : 14),
        subtotalCents: total,
        totalCents: total,
        amountPaidCents: paid,
        balanceCents: total - paid,
        notes: "Demo invoice — no live processor.",
        updatedAt: job.when,
        sourceSystem: DEMO_SOURCE,
        publicToken: nanoid(12),
        lineItems: {
          create: [{ name: item.name, quantity: qty, unitPriceCents: item.price, taxable: true, sortOrder: 0 }],
        },
      },
    });
    invoiceSeq += 1;
    invoices += 1;
    if (paid > 0) {
      await prisma.payment.create({
        data: {
          companyId: tenant.id,
          invoiceId: invoice.id,
          customerId: job.customerId,
          jobId: job.id,
          amountCents: paid,
          method: pick(random, ["CREDIT_CARD", "ACH", "CHECK", "CASH"]),
          status: "SUCCEEDED",
          provider: "DEMO",
          providerPaymentId: `demo_pay_${invoice.id}`,
          reference: "DEMO",
          paidAt: job.when,
          notes: "Synthetic demo payment — no live processor.",
          sourceSystem: DEMO_SOURCE,
        },
      });
      payments += 1;
    }
    await prisma.jobCost.create({
      data: {
        companyId: tenant.id,
        jobId: job.id,
        category: "MATERIALS",
        description: item.name,
        amountCents: index === 5 ? item.price : item.cost,
        sourceType: "MANUAL",
        createdById: ownerId,
      },
    });
    await prisma.jobCost.create({
      data: {
        companyId: tenant.id,
        jobId: job.id,
        category: "LABOR",
        description: index === 5 ? "Callback labor" : "Technician labor",
        amountCents: index === 5 ? 42000 : 9000 + (index % 5) * 1500,
        sourceType: "LABOR",
        createdById: ownerId,
      },
    });
  }

  const openEstimateJobs = [customers[1]!, customers[4]!, customers[7]!, customers[11]!, customers[16]!];
  for (let i = 0; i < 26; i += 1) {
    const customer = i < 5 ? openEstimateJobs[i] : customers[(i * 2) % customers.length]!;
    const status = (["DRAFT", "SENT", "VIEWED", "APPROVED", "DECLINED", "EXPIRED"] as const)[i % 6];
    const good = catalogItems.find((row) => row.name.includes("Good"))!;
    const better = catalogItems.find((row) => row.name.includes("Better"))!;
    const best = catalogItems.find((row) => row.name.includes("Best"))!;
    const replacement = i % 4 === 0;
    const estimate = await prisma.estimate.create({
      data: {
        companyId: tenant.id,
        customerId: customer.id,
        propertyId: customer.propertyIds[0]!,
        estimateNumber: `SE-${String(estimateSeq).padStart(4, "0")}`,
        status,
        issueDate: addDemoDays(now, -((i % 20) + 1)),
        expirationDate: addDemoDays(now, status === "EXPIRED" ? -2 : 18),
        followUpAt: status === "SENT" || status === "VIEWED" ? addDemoDays(now, -1, 9) : null,
        approvedAt: status === "APPROVED" ? addDemoDays(now, -3) : null,
        declinedAt: status === "DECLINED" ? addDemoDays(now, -4) : null,
        subtotalCents: replacement ? better.price : catalogItems[i % 8]!.price,
        totalCents: replacement ? better.price : catalogItems[i % 8]!.price,
        notes: replacement ? "Good / Better / Best system options." : "Repair recommendation.",
        sourceSystem: DEMO_SOURCE,
        publicToken: nanoid(12),
        createdById: users.tyler!.id,
      },
    });
    estimateSeq += 1;
    estimates += 1;
    if (replacement) {
      const optionDefs = [
        { name: "Good", item: good },
        { name: "Better", item: better },
        { name: "Best", item: best },
      ];
      for (const [sortOrder, option] of optionDefs.entries()) {
        const created = await prisma.estimateOption.create({
          data: { companyId: tenant.id, estimateId: estimate.id, name: option.name, sortOrder, description: `${option.name} replacement package` },
        });
        await prisma.estimateLineItem.create({
          data: {
            estimateId: estimate.id,
            optionId: created.id,
            pricebookItemId: option.item.id,
            name: option.item.name,
            quantity: 1,
            unitPriceCents: option.item.price,
            costCents: option.item.cost,
            sortOrder: 0,
          },
        });
      }
    } else {
      const item = catalogItems[i % catalogItems.length]!;
      await prisma.estimateLineItem.create({
        data: {
          estimateId: estimate.id,
          pricebookItemId: item.id,
          name: item.name,
          quantity: 1,
          unitPriceCents: item.price,
          costCents: item.cost,
        },
      });
    }
  }

  let memberships = 0;
  for (let i = 0; i < 38; i += 1) {
    const customer = customers[i]!;
    const status = i > 33 ? "EXPIRED" : i > 30 ? "PENDING" : "ACTIVE";
    await prisma.customerMembership.create({
      data: {
        companyId: tenant.id,
        customerId: customer.id,
        propertyId: customer.propertyIds[0],
        planId: plan.id,
        soldById: i % 4 === 0 ? users.chris!.id : users.tyler!.id,
        status,
        priceCents: 19900,
        saleDate: i < 2 ? now : monthsAgo(now, (i % 10) + 1),
        startDate: monthsAgo(now, (i % 10) + 1),
        renewalDate: addDemoDays(now, i > 28 ? 12 : 80 + i),
        visitsUsed: i % 3,
        importMode: "LIVE",
      },
    });
    memberships += 1;
  }

  const leadSources = ["GOOGLE_LSA", "GOOGLE_ADS", "GOOGLE_BUSINESS_PROFILE", "FACEBOOK", "WEBSITE", "REFERRAL", "REPEAT_CUSTOMER", "ORGANIC_SEARCH", "PHONE"] as const;
  const leadStatuses = ["NEW", "CONTACTED", "BOOKED", "ESTIMATE_SCHEDULED", "ESTIMATE_SENT", "WON", "LOST"] as const;
  let leads = 0;
  for (let i = 0; i < 32; i += 1) {
    const source = leadSources[i % leadSources.length]!;
    const status = leadStatuses[i % leadStatuses.length]!;
    const won = status === "WON";
    const customer = won ? customers[i % 12]! : null;
    const lead = await prisma.lead.create({
      data: {
        companyId: tenant.id,
        customerId: customer?.id,
        firstName: FIRST_NAMES[(i + 20) % FIRST_NAMES.length]!,
        lastName: LAST_NAMES[(i + 7) % LAST_NAMES.length]!,
        phone: `(865) 555-${String(2000 + i).padStart(4, "0")}`,
        email: `lead.${i}@${DEMO_CUSTOMER_EMAIL_DOMAIN}`,
        source,
        sourceDetail: source.replaceAll("_", " "),
        provider: DEMO_PROVIDER,
        message: i === 0 ? "Need someone today, upstairs is 82 degrees." : "Looking for service availability.",
        receivedAt: addDemoDays(now, -((i % 25) + 1), 10),
        status,
        assignedUserId: users.megan!.id,
        convertedAt: won ? addDemoDays(now, -2) : null,
        attributedRevenueCents: won ? 84000 / 7 : null,
        estimatedOpportunityCents: 48000 + i * 1000,
        campaignName: source === "GOOGLE_LSA" ? "Google Local Services" : null,
        firstTouch: source,
        lastTouch: source,
      },
    });
    leads += 1;
    if (won && customer) {
      const paidInvoice = await prisma.invoice.findFirst({
        where: { companyId: tenant.id, customerId: customer.id, status: "PAID" },
      });
      await prisma.attributionEvent.create({
        data: {
          companyId: tenant.id,
          leadId: lead.id,
          customerId: customer.id,
          invoiceId: paidInvoice?.id,
          source,
          revenueCents: paidInvoice?.totalCents ?? 120000,
          note: "Demo attribution from seeded lead.",
        },
      });
    }
  }

  await prisma.marketingSpend.createMany({
    data: [
      { companyId: tenant.id, source: "GOOGLE_LSA", provider: DEMO_PROVIDER, externalId: "demo-lsa-month", periodStart: monthsAgo(now, 0, 1), periodEnd: now, amountCents: 180000, campaignName: "Google Local Services" },
      { companyId: tenant.id, source: "FACEBOOK", provider: DEMO_PROVIDER, externalId: "demo-fb-month", periodStart: monthsAgo(now, 0, 1), periodEnd: now, amountCents: 42000, campaignName: "Facebook seasonal" },
      { companyId: tenant.id, source: "WEBSITE", provider: DEMO_PROVIDER, externalId: "demo-web-month", periodStart: monthsAgo(now, 0, 1), periodEnd: now, amountCents: 15000, campaignName: "Website" },
    ],
  });

  const conversations = [
    {
      customer: customers[2]!,
      preview: "My upstairs unit stopped cooling again.",
      messages: [
        { direction: "INBOUND", body: "My upstairs unit stopped cooling again." },
        { direction: "OUTBOUND", body: "I can get Chris there between 1:00 and 3:00 today." },
        { direction: "INBOUND", body: "Perfect, thank you." },
      ],
    },
    {
      customer: customers[1]!,
      preview: "Can someone give me a price on replacing our system?",
      messages: [
        { direction: "INBOUND", body: "Can someone give me a price on replacing our system?" },
        { direction: "OUTBOUND", body: "Tyler can be there tomorrow morning with Good / Better / Best options." },
      ],
    },
    {
      customer: customers[0]!,
      preview: "Your Summit Home Services technician is on the way.",
      messages: [{ direction: "OUTBOUND", body: "Your Summit Home Services technician is on the way." }],
    },
    {
      customer: customers[15]!,
      preview: "Do you guys work on tankless water heaters?",
      messages: [
        { direction: "INBOUND", body: "Do you guys work on tankless water heaters?" },
        { direction: "OUTBOUND", body: "Yes — Jordan can diagnose tankless units. I can put you on tomorrow’s board." },
      ],
    },
    {
      customer: customers[3]!,
      preview: "Will someone walk us through the new thermostat after install?",
      messages: [
        { direction: "INBOUND", body: "Will someone walk us through the new thermostat after install?" },
        { direction: "OUTBOUND", body: "Ethan will do a full walkthrough and leave the Comfort Club booklet." },
      ],
    },
    {
      customer: customers[8]!,
      preview: "Do I need to be home for the spring tune-up?",
      messages: [
        { direction: "INBOUND", body: "Do I need to be home for the spring tune-up?" },
        { direction: "OUTBOUND", body: "Someone 18+ needs to be there so we can review filter and thermostat settings." },
      ],
    },
    {
      customer: customers[12]!,
      preview: "Can you email the paid invoice for the capacitor job?",
      messages: [
        { direction: "INBOUND", body: "Can you email the paid invoice for the capacitor job?" },
        { direction: "OUTBOUND", body: "Sent to your example inbox — reply here if it does not come through." },
      ],
    },
    {
      customer: customers[20]!,
      preview: "Are you open Saturday morning?",
      messages: [
        { direction: "INBOUND", body: "Are you open Saturday morning?" },
        { direction: "OUTBOUND", body: "Yes — Saturday 8 to 2, plus after-hours emergency coverage." },
      ],
    },
    {
      customer: customers[24]!,
      preview: "The drain is gurgling again at the rental on Cedar.",
      messages: [
        { direction: "INBOUND", body: "The drain is gurgling again at the rental on Cedar." },
        { direction: "OUTBOUND", body: "I can put Jordan on a same-day leak check after lunch." },
      ],
    },
    {
      customer: customers[31]!,
      preview: "Membership renewal came through. Thank you.",
      messages: [
        { direction: "OUTBOUND", body: "Your Summit Comfort Club renewal is coming up. Want us to keep the same card on file?" },
        { direction: "INBOUND", body: "Membership renewal came through. Thank you." },
      ],
    },
    {
      customer: customers[7]!,
      preview: "The upstairs is still a little warm after yesterday.",
      messages: [
        { direction: "INBOUND", body: "The upstairs is still a little warm after yesterday." },
        { direction: "OUTBOUND", body: "Chris can swing by for a callback this afternoon and recheck airflow." },
      ],
    },
    {
      customer: customers[18]!,
      preview: "Can Tyler send the Good / Better / Best options in writing?",
      messages: [
        { direction: "INBOUND", body: "Can Tyler send the Good / Better / Best options in writing?" },
        { direction: "OUTBOUND", body: "Yes — he will send the estimate tonight after the site visit." },
      ],
    },
  ];
  for (const [index, row] of conversations.entries()) {
    const thread = await prisma.communicationThread.create({
      data: {
        companyId: tenant.id,
        provider: DEMO_PROVIDER,
        externalId: `demo-thread-${index + 1}`,
        channel: "SMS",
        customerId: row.customer.id,
        contactName: `${row.customer.firstName} ${row.customer.lastName}`,
        phone: row.customer.phone,
        lastPreview: row.preview,
        lastActivityAt: addDemoDays(now, index === 0 ? 0 : -index, 11),
        unread: index === 1,
      },
    });
    for (const [messageIndex, message] of row.messages.entries()) {
      await prisma.communicationMessage.create({
        data: {
          companyId: tenant.id,
          threadId: thread.id,
          provider: DEMO_PROVIDER,
          externalId: `demo-msg-${index + 1}-${messageIndex + 1}`,
          direction: message.direction,
          channel: "SMS",
          kind: "SMS",
          body: message.body,
          occurredAt: addDemoDays(now, index === 0 ? 0 : -index, 10 + messageIndex),
          status: "DELIVERED",
        },
      });
    }
  }

  const reviewBodies = [
    "Chris was on time and explained the repair clearly.",
    "Summit got our AC back on the same afternoon.",
    "Professional install crew. House is comfortable again.",
    "Jordan fixed the leak and cleaned up after himself.",
    "Membership visit was thorough. Filters and drain were perfect.",
  ];
  for (let i = 0; i < 32; i += 1) {
    const customer = customers[i]!;
    await prisma.review.create({
      data: {
        companyId: tenant.id,
        provider: DEMO_PROVIDER,
        externalId: `demo-review-${i + 1}`,
        rating: i % 9 === 0 ? 4 : 5,
        authorName: `${customer.firstName} ${customer.lastName[0]}.`,
        body: reviewBodies[i % reviewBodies.length],
        reviewedAt: i < 4 ? now : addDemoDays(now, -(i + 2)),
        customerId: customer.id,
        jobId: completedJobs[i]?.id,
      },
    });
  }
  await prisma.reviewRequest.create({
    data: {
      companyId: tenant.id,
      customerId: customers[2]!.id,
      jobId: jobs.find((job) => job.customerId === customers[2]!.id && job.completed)?.id,
      channel: "SMS",
      status: "SUGGESTED",
    },
  });

  const expenseVendors = [
    { vendor: "Johnstone Supply", category: "MATERIALS" as const, amount: 42800 },
    { vendor: "East TN Fuel", category: "FUEL" as const, amount: 18600 },
    { vendor: "Uniform Supply", category: "OFFICE" as const, amount: 9400 },
    { vendor: "Google Ads", category: "ADVERTISING" as const, amount: 22000 },
    { vendor: "Truck Service Center", category: "VEHICLE" as const, amount: 31200 },
  ];
  let expenses = 0;
  let receipts = 0;
  for (let i = 0; i < 18; i += 1) {
    const row = expenseVendors[i % expenseVendors.length]!;
    const receipt = await prisma.receipt.create({
      data: {
        companyId: tenant.id,
        uploadedById: ownerId,
        fileName: `demo-receipt-${i + 1}.txt`,
        filePath: `/demo/summit/receipts/demo-receipt-${i + 1}.txt`,
        mimeType: "text/plain",
        fileSizeBytes: 120,
        processingStatus: "CONFIRMED",
        assignment: "OVERHEAD",
        vendor: row.vendor,
        receiptDate: addDemoDays(now, -(i + 1)),
        totalCents: row.amount,
        description: "Demo receipt placeholder",
        confirmedAt: addDemoDays(now, -(i + 1)),
      },
    });
    receipts += 1;
    await prisma.expense.create({
      data: {
        companyId: tenant.id,
        vendor: row.vendor,
        date: addDemoDays(now, -(i + 1)),
        amountCents: row.amount,
        category: row.category,
        description: `${row.vendor} operating expense`,
        status: "POSTED",
        createdById: ownerId,
        receiptId: receipt.id,
        sourceSystem: DEMO_SOURCE,
      },
    });
    expenses += 1;
  }

  const socialBodies = [
    "Spring is here. Book your Summit Comfort Club tune-up before the first heat wave.",
    "Technician spotlight: Chris Walker — 11 years of diagnostics and a calm truck-side manner.",
    "Another family in Farragut is cooling quietly tonight after a Summit system replacement.",
    "“They showed up when they said they would.” — a 5-star note from this week.",
    "Tankless water heater sounding like popcorn? We service those too.",
    "Draft: Hardin Valley install recap with before/after photos.",
  ];
  for (const [index, body] of socialBodies.entries()) {
    await prisma.socialPost.create({
      data: {
        companyId: tenant.id,
        channel: index % 2 === 0 ? "FACEBOOK" : "INSTAGRAM",
        provider: DEMO_PROVIDER,
        status: index < 3 ? "PUBLISHED" : index === 3 ? "SCHEDULED" : "DRAFT",
        body,
        scheduledAt: index === 3 ? addDemoDays(now, 2, 9) : null,
        publishedAt: index < 3 ? addDemoDays(now, -(index + 1)) : null,
      },
    });
  }

  await prisma.performanceGoal.createMany({
    data: [
      { companyId: tenant.id, metricKey: "revenue", target: 5_000_000, period: "MONTH" },
      { companyId: tenant.id, metricKey: "close_rate", target: 400, period: "MONTH" },
      { companyId: tenant.id, metricKey: "reviews", target: 30, period: "MONTH" },
      { companyId: tenant.id, metricKey: "memberships", target: 8, period: "MONTH" },
      { companyId: tenant.id, metricKey: "gross_margin", target: 450, period: "MONTH" },
    ],
  });

  await prisma.automation.createMany({
    data: [
      {
        companyId: tenant.id,
        name: "Weekday estimate review",
        trigger: "Weekday morning",
        action: "estimate.identify_followups",
        enabled: false,
        status: "DRAFT",
      },
      {
        companyId: tenant.id,
        name: "Overdue invoice review",
        trigger: "Daily",
        action: "invoice.identify_overdue",
        enabled: false,
        status: "DRAFT",
      },
      {
        companyId: tenant.id,
        name: "Membership renewal review",
        trigger: "Weekly",
        action: "membership.identify_renewals",
        enabled: false,
        status: "DRAFT",
      },
      {
        companyId: tenant.id,
        name: "Daily dispatch review",
        trigger: "Weekday 7am",
        action: "job.propose_assignment",
        enabled: false,
        status: "DRAFT",
      },
      {
        companyId: tenant.id,
        name: "Weekly social draft preparation",
        trigger: "Monday morning",
        action: "social.create_draft",
        enabled: false,
        status: "DRAFT",
      },
    ],
  });

  await prisma.vehicle.createMany({
    data: [
      { companyId: tenant.id, name: "Service 12", unitNumber: "S12", year: 2022, make: "Ford", model: "Transit" },
      { companyId: tenant.id, name: "Service 18", unitNumber: "S18", year: 2021, make: "Ram", model: "ProMaster" },
      { companyId: tenant.id, name: "Install 4", unitNumber: "I4", year: 2020, make: "Ford", model: "F-250" },
    ],
  });

  await seedCustomer360Showcase({
    prisma,
    companyId: tenant.id,
    ownerId,
    customers,
    now,
  });

  const historicalJobs = jobs.filter((job) => job.when.getTime() < startOfToday(now)).length;

  return {
    companyId: tenant.id,
    companyName: company.businessName,
    team: SUMMIT_TEAM.length,
    customers: customers.length,
    properties: customers.reduce((sum, row) => sum + row.propertyIds.length, 0),
    equipment: equipmentCount,
    historicalJobs,
    todayJobs,
    upcomingJobs,
    estimates,
    invoices,
    payments,
    memberships,
    leads,
    threads: conversations.length,
    reviews: 32,
    expenses,
    receipts,
    socialPosts: socialBodies.length,
    playbooks: 5,
    pricebookCategories: PRICEBOOK.length,
    pricebookItems,
  };
}

function startOfToday(now: Date) {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}
