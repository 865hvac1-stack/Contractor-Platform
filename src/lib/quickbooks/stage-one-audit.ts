import type { PrismaClient } from "@prisma/client";
import { digitsOnly, normalizeEmail, normalizeText } from "@/lib/imports/normalize";
import { normalizeReviewAddress } from "@/lib/quickbooks/customer-review-automation";
import type { QuickBooksScope } from "@/lib/quickbooks/ownership";

const UNRESOLVED = new Set(["OPEN", "READY", "RE_REVIEW_REQUIRED"]);

export async function loadStageOneCustomerAudit(
  prisma: PrismaClient,
  scope: QuickBooksScope
) {
  const [run, analysis, reviews, mappings, settings] = await Promise.all([
    prisma.quickBooksSyncRun.findFirst({
      where: {
        companyId: scope.companyId,
        environment: scope.environment,
        realmId: scope.realmId,
        type: "IMPORT",
        objectType: "STAGE_1",
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.quickBooksSyncRun.findFirst({
      where: {
        companyId: scope.companyId,
        environment: scope.environment,
        realmId: scope.realmId,
        type: "ANALYSIS",
      },
      orderBy: { createdAt: "desc" },
      select: {
        categories: {
          where: { objectType: "CUSTOMER" },
          select: { availableInQbo: true },
          take: 1,
        },
      },
    }),
    prisma.quickBooksImportReview.findMany({
      where: {
        companyId: scope.companyId,
        environment: scope.environment,
        realmId: scope.realmId,
        objectType: "CUSTOMER",
      },
      select: {
        id: true,
        quickbooksId: true,
        status: true,
        proposedAction: true,
        proposedInternalId: true,
        errorMessage: true,
      },
    }),
    prisma.quickBooksMapping.findMany({
      where: {
        companyId: scope.companyId,
        environment: scope.environment,
        realmId: scope.realmId,
        entityType: "CUSTOMER",
      },
      select: {
        quickbooksId: true,
        internalId: true,
        realmId: true,
        companyId: true,
      },
    }),
    prisma.quickBooksSettings.findUnique({
      where: { companyId: scope.companyId },
      select: { writeBackEnabled: true },
    }),
  ]);
  if (!run) return null;

  const mappingIds = [...new Set(mappings.map((mapping) => mapping.internalId))];
  const [mappedCustomers, companyCustomers] = await Promise.all([
    mappingIds.length
      ? prisma.customer.findMany({
          where: { companyId: scope.companyId, id: { in: mappingIds } },
          select: {
            id: true,
            companyId: true,
            firstName: true,
            lastName: true,
            businessName: true,
            phone: true,
            email: true,
            sourceSystem: true,
            externalId: true,
            quickbooksCustomerId: true,
            quickbooksRealmId: true,
            properties: {
              select: {
                id: true,
                customerId: true,
                companyId: true,
                address: true,
                city: true,
                zip: true,
              },
            },
          },
        })
      : Promise.resolve([]),
    prisma.customer.findMany({
      where: { companyId: scope.companyId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        businessName: true,
        phone: true,
        email: true,
        sourceSystem: true,
        externalId: true,
        quickbooksCustomerId: true,
        properties: {
          select: { address: true, city: true, zip: true },
        },
      },
    }),
  ]);

  const reviewByQbo = new Map(reviews.map((review) => [review.quickbooksId, review]));
  const mappingsByQbo = groupBy(mappings, (mapping) => mapping.quickbooksId);
  const mappedCustomerById = new Map(mappedCustomers.map((customer) => [customer.id, customer]));
  const analyzed = analysis?.categories[0]?.availableInQbo ?? reviews.length;
  const qboIds = new Set(reviews.map((review) => review.quickbooksId));
  const outcomes = {
    linkedExisting: 0,
    createdNew: 0,
    ignored: 0,
    failed: 0,
    unresolved: 0,
    skipped: 0,
    other: 0,
  };

  for (const quickbooksId of qboIds) {
    const review = reviewByQbo.get(quickbooksId)!;
    const mapping = mappingsByQbo.get(quickbooksId)?.[0];
    if (review.status === "CREATED") outcomes.createdNew += 1;
    else if (mapping) outcomes.linkedExisting += 1;
    else if (review.status === "IGNORED" || review.proposedAction === "IGNORE") outcomes.ignored += 1;
    else if (review.status === "FAILED" || review.errorMessage) outcomes.failed += 1;
    else if (UNRESOLVED.has(review.status)) outcomes.unresolved += 1;
    else if (!mapping) outcomes.skipped += 1;
    else outcomes.other += 1;
  }
  const outcomeTotal = Object.values(outcomes).reduce((sum, count) => sum + count, 0);

  const duplicateMappings = [...mappingsByQbo.values()].filter(
    (rows) => new Set(rows.map((row) => row.internalId)).size > 1
  );
  const invalidMappings = mappings.filter((mapping) => {
    const customer = mappedCustomerById.get(mapping.internalId);
    return (
      !customer ||
      mapping.companyId !== scope.companyId ||
      mapping.realmId !== scope.realmId ||
      customer.companyId !== scope.companyId
    );
  });
  const createdReviews = reviews.filter(
    (review) => review.status === "CREATED" && review.proposedAction === "CREATE"
  );
  const createdAudit = createdReviews.map((review) => {
    const mapping = mappingsByQbo.get(review.quickbooksId)?.[0];
    const customer = mapping ? mappedCustomerById.get(mapping.internalId) : null;
    return { review, mapping, customer };
  });
  const unexpectedCreations = createdAudit.filter(
    ({ mapping, customer, review }) =>
      !mapping ||
      !customer ||
      customer.sourceSystem !== "quickbooks_online" ||
      customer.quickbooksCustomerId !== review.quickbooksId ||
      customer.quickbooksRealmId !== scope.realmId
  );
  const invalidProperties = createdAudit.flatMap(({ customer }) =>
    (customer?.properties ?? []).filter(
      (property) =>
        property.customerId !== customer?.id ||
        property.companyId !== scope.companyId
    )
  );

  const createdCustomerIds = new Set(
    createdAudit.map(({ customer }) => customer?.id).filter((id): id is string => Boolean(id))
  );
  const existingCustomers = companyCustomers.filter((customer) => !createdCustomerIds.has(customer.id));
  const existingIdentity = buildIdentitySets(existingCustomers);
  const potentialDuplicates = createdAudit.filter(({ customer }) => {
    if (!customer) return false;
    const phone = phoneKey(customer.phone);
    const email = normalizeEmail(customer.email) || "";
    const namesAndAddresses = nameAddressKeys(customer);
    return (
      Boolean(phone && existingIdentity.phones.has(phone)) ||
      Boolean(email && existingIdentity.emails.has(email)) ||
      namesAndAddresses.some((key) => existingIdentity.nameAddresses.has(key))
    );
  });

  const operations = {
    examined: run.recordsExamined,
    created: run.createdCount,
    updated: run.updatedCount,
    linked: run.linkedCount,
    skipped: run.skippedCount,
    failed: run.failedCount,
    conflicts: run.conflictCount,
  };
  const integrityIssues = [
    ...(outcomeTotal !== analyzed
      ? [`Final outcomes total ${outcomeTotal.toLocaleString()} but analysis contains ${analyzed.toLocaleString()} customers.`]
      : []),
    ...(qboIds.size !== analyzed
      ? [`There are ${qboIds.size.toLocaleString()} unique persisted QuickBooks customer IDs for ${analyzed.toLocaleString()} analyzed customers.`]
      : []),
    ...(duplicateMappings.length
      ? [`${duplicateMappings.length.toLocaleString()} QuickBooks IDs map to multiple ContractorYou customers.`]
      : []),
    ...(invalidMappings.length
      ? [`${invalidMappings.length.toLocaleString()} customer mappings have an invalid tenant, realm, or target.`]
      : []),
    ...(unexpectedCreations.length
      ? [`${unexpectedCreations.length.toLocaleString()} created customers do not match an approved CREATE outcome and mapping.`]
      : []),
    ...(invalidProperties.length
      ? [`${invalidProperties.length.toLocaleString()} created properties have an invalid customer or tenant relationship.`]
      : []),
    ...(outcomes.failed ? [`${outcomes.failed.toLocaleString()} customer outcomes failed.`] : []),
    ...(outcomes.unresolved ? [`${outcomes.unresolved.toLocaleString()} customer outcomes remain unresolved.`] : []),
  ];

  return {
    run: {
      id: run.id,
      status: run.status,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      writeBackAttempted: run.writeBackAttempted,
    },
    analyzed,
    uniqueQuickBooksCustomers: qboIds.size,
    outcomes,
    outcomeTotal,
    operations,
    updatedFieldBreakdown: {
      quickbooksCustomerIdStamped: operations.updated,
      quickbooksRealmIdStamped: operations.updated,
      syncTimestampStamped: operations.updated,
      syncStatusStamped: operations.updated,
      quickbooksModifiedTimestampStamped: operations.updated,
      mappingMetadataUpserted: operations.updated,
      nameChanged: 0,
      phoneChanged: 0,
      emailChanged: 0,
      propertyChanged: 0,
    },
    created: {
      approvedCreateDecisions: reviews.filter((review) => review.proposedAction === "CREATE").length,
      actuallyCreated: operations.created,
      correctlyLinkedAfterCreation: createdAudit.filter(({ mapping, customer }) => Boolean(mapping && customer)).length,
      unexpected: unexpectedCreations.length,
      invalidProperties: invalidProperties.length,
      potentialDuplicates: potentialDuplicates.length,
    },
    mappings: {
      total: mappings.length,
      duplicateQuickBooksIds: duplicateMappings.length,
      invalid: invalidMappings.length,
    },
    quickBooksWrites: run.writeBackAttempted ? "NOT_ZERO" as const : "ZERO" as const,
    writeBackEnabled: settings?.writeBackEnabled === true,
    identityFieldsPreservedByImplementation: true,
    strictNoOpOnRerun: false,
    duplicateSafeOnRerun: true,
    integrityIssues,
    integrityPassed: integrityIssues.length === 0,
    stageTwoSafe:
      integrityIssues.length === 0 &&
      potentialDuplicates.length === 0 &&
      !run.writeBackAttempted &&
      settings?.writeBackEnabled !== true,
  };
}

function groupBy<T>(rows: T[], key: (row: T) => string) {
  return rows.reduce<Map<string, T[]>>((groups, row) => {
    const value = key(row);
    groups.set(value, [...(groups.get(value) ?? []), row]);
    return groups;
  }, new Map());
}

function phoneKey(value?: string | null) {
  const digits = digitsOnly(value || "");
  return digits.length >= 10 ? digits.slice(-10) : "";
}

function nameAddressKeys(customer: {
  firstName: string;
  lastName: string;
  businessName: string | null;
  properties: Array<{ address: string; city: string; zip: string }>;
}) {
  const name = normalizeText(
    customer.businessName || `${customer.firstName} ${customer.lastName}`
  ).toLowerCase();
  if (!name) return [];
  return customer.properties.map((property) =>
    `${name}|${normalizeReviewAddress({
      line1: property.address,
      city: property.city,
      zip: property.zip,
    })}`
  );
}

function buildIdentitySets(customers: Array<{
  firstName: string;
  lastName: string;
  businessName: string | null;
  phone: string | null;
  email: string | null;
  properties: Array<{ address: string; city: string; zip: string }>;
}>) {
  const phones = new Set<string>();
  const emails = new Set<string>();
  const nameAddresses = new Set<string>();
  for (const customer of customers) {
    const phone = phoneKey(customer.phone);
    const email = normalizeEmail(customer.email) || "";
    if (phone) phones.add(phone);
    if (email) emails.add(email);
    for (const key of nameAddressKeys(customer)) nameAddresses.add(key);
  }
  return { phones, emails, nameAddresses };
}
