import type { ImportSourceType, ImportSummary, ImportWarning } from "@querypilot/shared-types";

/**
 * Service boundaries for ingestion.
 *
 * SchemaImportService is implemented in Release 1 by the .NET schema-processor worker
 * (services/schema-processor). The web app only talks to it through the job queue in PostgreSQL
 * and through this contract for validation performed before a job is created.
 *
 * DataImportService is a Release 2 extension point. It is declared here so the rest of the code base
 * can be written against a stable boundary, but it has NO implementation in Release 1 and no data is ever
 * ingested. Schema versions and data snapshots are deliberately separate aggregates: a snapshot always
 * references the exact schema version used to interpret it, and neither is assumed to exist for the other.
 */

export interface FileValidationResult {
  ok: boolean;
  sourceType: ImportSourceType | null;
  errors: string[];
  warnings: ImportWarning[];
}

export interface SchemaImportService {
  validateSchemaFile(file: { name: string; size: number; head: Uint8Array }): FileValidationResult;
  /** Reads the uploaded artefact and returns raw extracted objects. Implemented by the worker. */
  extractSchema(jobId: string): Promise<void>;
  /** Parses object definitions (ScriptDom) to normalise metadata. Implemented by the worker. */
  parseDatabaseObjects(jobId: string): Promise<void>;
  buildDependencyGraph(versionId: string): Promise<void>;
  generateSchemaMetadata(versionId: string): Promise<ImportSummary>;
}

// ---------------------------------------------------------------------------
// Release 2 - NOT IMPLEMENTED
// ---------------------------------------------------------------------------

export type DataSourceFormat = "bacpac" | "csv" | "other_structured_export";

export interface DataSnapshotRef {
  id: string;
  projectId: string;
  /** The exact schema version used to interpret this snapshot (never implicitly "latest"). */
  schemaVersionId: string;
  format: DataSourceFormat;
}

export interface DataProfile {
  snapshotId: string;
  tableName: string;
  rowCount: number;
  columns: { name: string; nullPercent: number; distinctCount: number | null; duplicateCount: number | null }[];
}

export interface DataQualityReport {
  snapshotId: string;
  /** Sanitised, minimised summary: the only form of data that may ever be offered to an external AI provider. */
  sanitisedSummary: string;
  findings: { severity: string; message: string }[];
}

export interface DataImportService {
  validateDataFile(file: { name: string; size: number }): Promise<FileValidationResult>;
  extractTableData(snapshotId: string): Promise<void>;
  profileTableData(snapshotId: string): Promise<DataProfile[]>;
  generateDataQualityReport(snapshotId: string): Promise<DataQualityReport>;
  compareDataSnapshots(baseSnapshotId: string, targetSnapshotId: string): Promise<unknown>;
}
