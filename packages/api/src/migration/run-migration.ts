import { createHash } from "node:crypto";
import { z } from "zod";

import type { MigrationRun, MigrationRunStatus, MigrationSeverity } from "../domain/overlays";
import type { RepositoryDb } from "../repositories/catalog";
import {
  findOrCreateMigrationRun,
  listMigrationMappingsForRun,
  updateMigrationRun,
} from "../repositories/overlays";
import { importStrapiCatalog } from "./catalog-import";
import { importStrapiOverlays } from "./overlay-import";
import { strapiExportSchema } from "./strapi-export";
import type { CatalogImportReportedRecord } from "./catalog-import";
import type { OverlayImportReportedRecord } from "./overlay-import";
import type { StrapiExport } from "./strapi-export";

export type MigrationReportStatus = MigrationRunStatus;

export interface MigrationRunnerCounts {
  readonly users: number;
  readonly creators: number;
  readonly feeds: number;
  readonly contentItems: number;
  readonly contentSources: number;
  readonly feedContentLinks: number;
  readonly subscriptions: number;
  readonly contentStatuses: number;
  readonly playlists: number;
  readonly playlistItems: number;
}

export interface MigrationReportedRecord {
  readonly oldEntityType: string;
  readonly oldEntityId: string;
  readonly severity: MigrationSeverity;
  readonly reason: string;
}

export interface MigrationSeveritySummary {
  readonly info: number;
  readonly warning: number;
  readonly error: number;
}

export interface MigrationReport {
  readonly status: MigrationReportStatus;
  readonly alreadyImported: boolean;
  readonly migrationRun: MigrationRun | null;
  readonly fingerprint: string | null;
  readonly counts: MigrationRunnerCounts;
  readonly mappingCounts: Record<string, number>;
  readonly warnings: readonly MigrationReportedRecord[];
  readonly failures: readonly MigrationReportedRecord[];
  readonly reportedRecords: readonly MigrationReportedRecord[];
  readonly severitySummary: MigrationSeveritySummary;
}

export interface RunImportMigrationInput {
  readonly exportData: unknown;
  readonly sourceFilename?: string | null;
}

export type RunStrapiMigrationInput = RunImportMigrationInput;

const emptyCounts: MigrationRunnerCounts = {
  users: 0,
  creators: 0,
  feeds: 0,
  contentItems: 0,
  contentSources: 0,
  feedContentLinks: 0,
  subscriptions: 0,
  contentStatuses: 0,
  playlists: 0,
  playlistItems: 0,
};

export async function runStrapiExportMigration(
  db: RepositoryDb,
  input: RunStrapiMigrationInput,
): Promise<MigrationReport> {
  const parsedExport = strapiExportSchema.safeParse(input.exportData);
  if (!parsedExport.success) {
    const failures = parsedExport.error.issues.map(toValidationFailure);
    return buildReport({
      status: "failed",
      alreadyImported: false,
      migrationRun: null,
      fingerprint: null,
      counts: emptyCounts,
      mappingCounts: {},
      warnings: [],
      failures,
    });
  }

  const fingerprint = fingerprintExport(parsedExport.data);
  const migrationRun = await findOrCreateMigrationRun(db, {
    sourceExportFingerprint: fingerprint,
    sourceFilename: input.sourceFilename,
    status: "running",
  });

  if (migrationRun.status === "succeeded") {
    const mappingCounts = await countMappingsByNewEntityType(db, migrationRun.id);
    return buildReport({
      status: "succeeded",
      alreadyImported: true,
      migrationRun,
      fingerprint,
      counts: countsFromRun(migrationRun, mappingCounts),
      mappingCounts,
      warnings: parseStoredReports(migrationRun.warningsJson),
      failures: parseStoredReports(migrationRun.failuresJson),
    });
  }

  const runningRun = migrationRun.status === "running"
    ? migrationRun
    : await updateMigrationRun(db, {
        id: migrationRun.id,
        status: "running",
        completedAt: null,
        warningsJson: null,
        failuresJson: null,
      });

  try {
    const catalogResult = await importStrapiCatalog(db, {
      migrationRunId: runningRun.id,
      exportData: parsedExport.data,
    });
    const overlayResult = await importStrapiOverlays(db, {
      migrationRunId: runningRun.id,
      exportData: parsedExport.data,
    });
    const warnings = [...catalogResult.reportedRecords, ...overlayResult.reportedRecords]
      .map(toRunnerReport)
      .filter((record) => record.severity !== "error");
    const failures = [...catalogResult.reportedRecords, ...overlayResult.reportedRecords]
      .map(toRunnerReport)
      .filter((record) => record.severity === "error");
    const status: MigrationRunStatus = failures.length === 0 ? "succeeded" : "partial";
    const counts: MigrationRunnerCounts = {
      users: overlayResult.counts.users,
      creators: catalogResult.counts.creators,
      feeds: catalogResult.counts.feeds,
      contentItems: catalogResult.counts.contentItems,
      contentSources: catalogResult.counts.contentSources,
      feedContentLinks: catalogResult.counts.feedContentLinks,
      subscriptions: overlayResult.counts.subscriptions,
      contentStatuses: overlayResult.counts.contentStatuses,
      playlists: overlayResult.counts.playlists,
      playlistItems: overlayResult.counts.playlistItems,
    };
    const completedRun = await updateMigrationRun(db, {
      id: runningRun.id,
      status,
      completedAt: new Date(),
      usersImportedCount: counts.users,
      creatorsImportedCount: counts.creators,
      feedsImportedCount: counts.feeds,
      contentItemsImportedCount: counts.contentItems,
      subscriptionsImportedCount: counts.subscriptions,
      playlistsImportedCount: counts.playlists,
      warningsJson: JSON.stringify(warnings),
      failuresJson: JSON.stringify(failures),
    });

    return buildReport({
      status,
      alreadyImported: false,
      migrationRun: completedRun,
      fingerprint,
      counts,
      mappingCounts: await countMappingsByNewEntityType(db, runningRun.id),
      warnings,
      failures,
    });
  } catch (error: unknown) {
    const failure = toRuntimeFailure(error);
    const failedRun = await updateMigrationRun(db, {
      id: runningRun.id,
      status: "failed",
      completedAt: new Date(),
      warningsJson: JSON.stringify([]),
      failuresJson: JSON.stringify([failure]),
    });
    const mappingCounts = await countMappingsByNewEntityType(db, runningRun.id);
    return buildReport({
      status: "failed",
      alreadyImported: false,
      migrationRun: failedRun,
      fingerprint,
      counts: countsFromRun(failedRun, mappingCounts),
      mappingCounts,
      warnings: [],
      failures: [failure],
    });
  }
}

export function runImportMigration(db: RepositoryDb, input: RunImportMigrationInput): Promise<MigrationReport> {
  return runStrapiExportMigration(db, input);
}

function fingerprintExport(exportData: StrapiExport): string {
  return createHash("sha256").update(stableStringify(exportData)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  return `{${Object.entries(value)
    .sort()
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
    .join(",")}}`;
}

function toValidationFailure(issue: z.ZodIssue): MigrationReportedRecord {
  return {
    oldEntityType: "strapi-export",
    oldEntityId: issue.path.join(".") || "root",
    severity: "error",
    reason: issue.message,
  };
}

function toRuntimeFailure(error: unknown): MigrationReportedRecord {
  return {
    oldEntityType: "migration-runner",
    oldEntityId: "runtime",
    severity: "error",
    reason: error instanceof Error ? error.message : "Migration failed with an unknown runtime error.",
  };
}

function toRunnerReport(record: CatalogImportReportedRecord | OverlayImportReportedRecord): MigrationReportedRecord {
  return {
    oldEntityType: record.oldEntityType,
    oldEntityId: record.oldEntityId,
    severity: record.severity,
    reason: record.reason,
  };
}

function buildReport(input: {
  readonly status: MigrationReportStatus;
  readonly alreadyImported: boolean;
  readonly migrationRun: MigrationRun | null;
  readonly fingerprint: string | null;
  readonly counts: MigrationRunnerCounts;
  readonly mappingCounts: Record<string, number>;
  readonly warnings: readonly MigrationReportedRecord[];
  readonly failures: readonly MigrationReportedRecord[];
}): MigrationReport {
  const reportedRecords = [...input.warnings, ...input.failures];
  return {
    status: input.status,
    alreadyImported: input.alreadyImported,
    migrationRun: input.migrationRun,
    fingerprint: input.fingerprint,
    counts: input.counts,
    mappingCounts: input.mappingCounts,
    warnings: input.warnings,
    failures: input.failures,
    reportedRecords,
    severitySummary: summarizeSeverity(reportedRecords),
  };
}

function summarizeSeverity(records: readonly MigrationReportedRecord[]): MigrationSeveritySummary {
  const summary: MigrationSeveritySummary = { info: 0, warning: 0, error: 0 };
  return records.reduce(
    (current, record) => ({
      ...current,
      [record.severity]: current[record.severity] + 1,
    }),
    summary,
  );
}

function countsFromRun(run: MigrationRun, mappingCounts: Readonly<Record<string, number>>): MigrationRunnerCounts {
  const mappedContentSourceCount = mappingCounts["content-source"] ?? 0;
  return {
    ...emptyCounts,
    users: run.usersImportedCount,
    creators: run.creatorsImportedCount,
    feeds: run.feedsImportedCount,
    contentItems: run.contentItemsImportedCount,
    contentSources: Math.max(mappedContentSourceCount, run.contentItemsImportedCount),
    feedContentLinks: mappingCounts["feed-content"] ?? 0,
    subscriptions: run.subscriptionsImportedCount,
    contentStatuses: mappingCounts["content-status"] ?? 0,
    playlists: run.playlistsImportedCount,
    playlistItems: mappingCounts["playlist-item"] ?? 0,
  };
}

async function countMappingsByNewEntityType(db: RepositoryDb, migrationRunId: string): Promise<Record<string, number>> {
  const mappings = await listMigrationMappingsForRun(db, migrationRunId);
  const counts: Record<string, number> = {};
  for (const mapping of mappings) {
    counts[mapping.newEntityType] = (counts[mapping.newEntityType] ?? 0) + 1;
  }
  return counts;
}

function parseStoredReports(json: string | null): readonly MigrationReportedRecord[] {
  if (json === null) {
    return [];
  }
  const parsed = storedReportsSchema.safeParse(JSON.parse(json));
  if (!parsed.success) {
    return [];
  }
  return parsed.data;
}

const storedReportsSchema = z.array(
  z.object({
    oldEntityType: z.string(),
    oldEntityId: z.string(),
    severity: z.enum(["info", "warning", "error"]),
    reason: z.string(),
  }),
);
