import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const MIGRATION = "20260913223000_quickbooks_realm_environment_isolation";
const prisma = new PrismaClient();

function runResolve(mode) {
  const result = spawnSync(
    "npx",
    ["prisma", "migrate", "resolve", mode, MIGRATION],
    { stdio: "inherit", env: process.env }
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function includesColumns(indexDefinitions, table, columns, unique = false) {
  const quoted = columns.map((column) => `"${column}"`).join(", ");
  return indexDefinitions.some(
    (row) =>
      row.tablename === table &&
      (!unique || row.indexdef.includes("CREATE UNIQUE INDEX")) &&
      row.indexdef.includes(`(${quoted})`)
  );
}

try {
  const failed = await prisma.$queryRawUnsafe(
    `SELECT migration_name, logs, started_at
       FROM "_prisma_migrations"
      WHERE finished_at IS NULL
        AND rolled_back_at IS NULL
      ORDER BY started_at ASC`
  );

  if (failed.length === 0) {
    console.info("No unresolved Prisma migration found.");
    process.exit(0);
  }
  if (failed.length !== 1 || failed[0].migration_name !== MIGRATION) {
    console.error(
      `Refusing automatic resolution: unresolved migrations are ${failed
        .map((row) => row.migration_name)
        .join(", ")}.`
    );
    process.exit(1);
  }

  const columns = await prisma.$queryRawUnsafe(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (
          (table_name = 'IntegrationConnection' AND column_name = 'environment') OR
          (table_name = 'QuickBooksSettings' AND column_name IN ('syncEnvironment', 'syncRealmId', 'syncActivatedAt')) OR
          (table_name = 'QuickBooksMapping' AND column_name IN ('environment', 'realmId', 'ownershipStatus')) OR
          (table_name = 'QuickBooksSyncEvent' AND column_name IN ('environment', 'realmId', 'ownershipStatus'))
        )`
  );
  const indexes = await prisma.$queryRawUnsafe(
    `SELECT tablename, indexname, indexdef
       FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename IN ('QuickBooksMapping', 'QuickBooksSyncEvent')`
  );

  const expectedColumns = new Set([
    "IntegrationConnection.environment",
    "QuickBooksSettings.syncEnvironment",
    "QuickBooksSettings.syncRealmId",
    "QuickBooksSettings.syncActivatedAt",
    "QuickBooksMapping.environment",
    "QuickBooksMapping.realmId",
    "QuickBooksMapping.ownershipStatus",
    "QuickBooksSyncEvent.environment",
    "QuickBooksSyncEvent.realmId",
    "QuickBooksSyncEvent.ownershipStatus",
  ]);
  const presentColumns = new Set(columns.map((row) => `${row.table_name}.${row.column_name}`));
  const allColumnsExist = [...expectedColumns].every((column) => presentColumns.has(column));
  const oldMappingUniqueExists = indexes.some(
    (row) => row.indexname === "QuickBooksMapping_companyId_entityType_internalId_key"
  );
  const oldSecondaryIndexesExist = indexes.some((row) =>
    [
      "QuickBooksMapping_companyId_entityType_quickbooksId_idx",
      "QuickBooksSyncEvent_companyId_createdAt_idx",
      "QuickBooksSyncEvent_companyId_entityType_internalId_idx",
    ].includes(row.indexname)
  );
  const allNewIndexesExist =
    includesColumns(
      indexes,
      "QuickBooksMapping",
      ["companyId", "environment", "realmId", "entityType", "internalId"],
      true
    ) &&
    includesColumns(indexes, "QuickBooksMapping", ["companyId", "entityType", "internalId"]) &&
    includesColumns(indexes, "QuickBooksMapping", [
      "companyId",
      "environment",
      "realmId",
      "entityType",
      "quickbooksId",
    ]) &&
    includesColumns(indexes, "QuickBooksMapping", ["companyId", "ownershipStatus"]) &&
    includesColumns(indexes, "QuickBooksSyncEvent", [
      "companyId",
      "environment",
      "realmId",
      "createdAt",
    ]) &&
    includesColumns(indexes, "QuickBooksSyncEvent", [
      "companyId",
      "environment",
      "realmId",
      "entityType",
      "internalId",
    ]) &&
    includesColumns(indexes, "QuickBooksSyncEvent", ["companyId", "ownershipStatus"]);

  const fullyApplied =
    allColumnsExist && allNewIndexesExist && !oldMappingUniqueExists && !oldSecondaryIndexesExist;
  console.info(
    JSON.stringify({
      migration: MIGRATION,
      startedAt: failed[0].started_at,
      databaseError: failed[0].logs || null,
      observedState: {
        intendedColumnsPresent: presentColumns.size,
        intendedColumnsExpected: expectedColumns.size,
        oldMappingUniqueExists,
        oldSecondaryIndexesExist,
        allNewIndexesExist,
      },
      resolution: fullyApplied ? "applied" : "rolled-back",
    })
  );

  await prisma.$disconnect();
  runResolve(fullyApplied ? "--applied" : "--rolled-back");
} catch (error) {
  console.error(
    `QuickBooks migration recovery inspection failed: ${
      error instanceof Error ? error.message : "unknown error"
    }`
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect().catch(() => undefined);
}

