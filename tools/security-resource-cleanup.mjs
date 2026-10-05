import { createHash } from "node:crypto";
import {
  compareResourceIntegrity, resourceIntegrityLimits, resourceIntegritySchema,
  resourceIntegritySnapshotFingerprint, validatedResourceBookingIds
} from "./security-resource-integrity.mjs";
import { parseResourceState, resourceStateCatalogSql } from "./security-resource-state.mjs";

export const resourceCleanupLimits = Object.freeze({ bookings: 256, sqlBytes: 32 * 1024 * 1024 });

export const resourceCleanupNativeProofRequirements = Object.freeze([
  "Execute the generated transaction against the isolated SECURITY database with errors stopping execution.",
  "Prove target booking and child updates, additions and removals abort before deletion and roll back all writes.",
  "Prove concurrent writers cannot change target rows between the locked precondition and deletion.",
  "Prove the native foreign keys cascade only allocations and participants, and schema drift aborts.",
  "Capture the complete actual cleanup snapshot and verify it against the expected fingerprint, including audit and mail rows."
]);

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const targetTables = Object.freeze(["booking", "court_allocation", "booking_participant"]);

function closedKeys(value, keys) {
  return value && Object.getPrototypeOf(value) === Object.prototype
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function snapshotFingerprint(snapshot) {
  const fingerprint = resourceIntegritySnapshotFingerprint(snapshot);
  if (!closedKeys(snapshot, ["schemaVersion", "tables"]) || Object.values(snapshot.tables)
    .some(table => !closedKeys(table, ["columns", "primaryKey", "rows"]))) {
    throw new Error("cleanup-metadata-unsupported");
  }
  parseResourceState(JSON.stringify(snapshot));
  return fingerprint;
}

function refused(outcome, code, integrity = null) {
  return { schemaVersion: 1, outcome, code, integrity, bookingIds: [], sql: null,
    expected: null, expectedFingerprint: null, nativeProofRequired: true };
}

function targetRows(snapshot, ids) {
  return Object.fromEntries(targetTables.map(table => [table, snapshot.tables[table].rows
    .filter(row => ids.has(table === "booking" ? row.id : row.booking_id))
    .map(row => structuredClone(row)).sort((left, right) => left.id.localeCompare(right.id))]));
}

function rowsFingerprint(rows) {
  const canonical = value => value === null || typeof value !== "object" ? JSON.stringify(value)
    : Array.isArray(value) ? `[${value.map(canonical).join(",")}]`
      : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return `sha256:${createHash("sha256").update(canonical(rows)).digest("hex")}`;
}

function jsonSql(value) {
  return `convert_from(decode('${Buffer.from(JSON.stringify(value), "utf8").toString("hex")}', 'hex'), 'UTF8')::jsonb`;
}

function cleanupSql(ids, captured) {
  const idArray = `ARRAY[${ids.map(id => `'${id}'::uuid`).join(", ")}]`;
  const catalog = Object.keys(resourceIntegritySchema).sort().map(table => ({ schema: "public", table }));
  const metadata = targetTables.map(table => `SELECT '${table}' AS name, jsonb_build_object(
    'columns', (SELECT jsonb_agg(column_name ORDER BY column_name) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = '${table}'),
    'primaryKey', (SELECT jsonb_agg(k.column_name ORDER BY k.ordinal_position)
      FROM information_schema.table_constraints c JOIN information_schema.key_column_usage k
        USING (constraint_catalog, constraint_schema, constraint_name, table_catalog, table_schema, table_name)
      WHERE c.table_schema = 'public' AND c.table_name = '${table}' AND c.constraint_type = 'PRIMARY KEY')) AS value`).join(" UNION ALL ");
  const nativeRows = targetTables.map(table => `'${table}', (SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.id), '[]'::jsonb)
    FROM public.${table} r WHERE ${table === "booking" ? "id" : "booking_id"} = ANY (${idArray}))`).join(",\n    ");
  const cascades = ["booking_participant", "court_allocation"].map(table => ({ schema: "public", table,
    columns: ["booking_id"], targetSchema: "public", target: "booking", targetColumns: ["id"], action: "c" }));
  const sql = `BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10s';
LOCK TABLE public.booking, public.court_allocation, public.booking_participant IN SHARE ROW EXCLUSIVE MODE;
DO $courtside_cleanup$
DECLARE removed integer;
BEGIN
  IF current_database() <> 'courtside_security' THEN
    RAISE EXCEPTION 'cleanup-environment-mismatch';
  END IF;
  IF (${resourceStateCatalogSql}) IS DISTINCT FROM ${jsonSql(catalog)}
    OR (SELECT jsonb_object_agg(name, value) FROM (${metadata}) entries)
      IS DISTINCT FROM ${jsonSql(Object.fromEntries(targetTables.map(table => [table, resourceIntegritySchema[table]])))} THEN
    RAISE EXCEPTION 'cleanup-schema-drift';
  END IF;
  IF (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'schema', ns.nspname, 'table', src.relname,
      'columns', (SELECT jsonb_agg(a.attname ORDER BY keys.position)
        FROM unnest(f.conkey) WITH ORDINALITY keys(number, position)
        JOIN pg_attribute a ON a.attrelid = f.conrelid AND a.attnum = keys.number),
      'targetSchema', nt.nspname, 'target', dst.relname,
      'targetColumns', (SELECT jsonb_agg(a.attname ORDER BY keys.position)
        FROM unnest(f.confkey) WITH ORDINALITY keys(number, position)
        JOIN pg_attribute a ON a.attrelid = f.confrelid AND a.attnum = keys.number),
      'action', f.confdeltype::text) ORDER BY ns.nspname, src.relname, f.conname), '[]'::jsonb)
    FROM pg_constraint f JOIN pg_class src ON src.oid = f.conrelid JOIN pg_namespace ns ON ns.oid = src.relnamespace
      JOIN pg_class dst ON dst.oid = f.confrelid JOIN pg_namespace nt ON nt.oid = dst.relnamespace
    WHERE f.contype = 'f' AND f.confrelid IN ('public.booking'::regclass,
      'public.court_allocation'::regclass, 'public.booking_participant'::regclass))
    IS DISTINCT FROM ${jsonSql(cascades)} THEN
    RAISE EXCEPTION 'cleanup-cascade-drift';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid IN ('public.booking'::regclass,
      'public.court_allocation'::regclass, 'public.booking_participant'::regclass) AND NOT tgisinternal)
    OR EXISTS (SELECT 1 FROM pg_rewrite WHERE ev_class IN ('public.booking'::regclass,
      'public.court_allocation'::regclass, 'public.booking_participant'::regclass)) THEN
    RAISE EXCEPTION 'cleanup-cascade-drift';
  END IF;
  IF jsonb_build_object(${nativeRows}) IS DISTINCT FROM ${jsonSql(captured)} THEN
    RAISE EXCEPTION 'cleanup-target-drift';
  END IF;
  DELETE FROM public.booking WHERE id = ANY (${idArray});
  GET DIAGNOSTICS removed = ROW_COUNT;
  IF removed <> ${ids.length} THEN
    RAISE EXCEPTION 'cleanup-delete-count-mismatch';
  END IF;
END;
$courtside_cleanup$;
COMMIT;`;
  if (Buffer.byteLength(sql) > resourceCleanupLimits.sqlBytes) throw new Error("cleanup-sql-budget-exceeded");
  return sql;
}

export function planResourceCleanup(input) {
  let integrity = null;
  try {
    const comparison = { before: input?.before, after: input?.effects, contract: input?.contract, journal: input?.journal };
    integrity = compareResourceIntegrity(comparison);
    if (integrity.outcome !== "passed") return refused(integrity.outcome, "cleanup-effects-unproven", integrity);
    snapshotFingerprint(input.before);
    snapshotFingerprint(input.effects);
    const bookingIds = validatedResourceBookingIds(comparison);
    if (bookingIds.length > resourceCleanupLimits.bookings || bookingIds.length > resourceIntegrityLimits.bookings
        || new Set(bookingIds).size !== bookingIds.length || bookingIds.some(id => !uuid.test(id))) {
      return refused("incomplete", "cleanup-targets-invalid", integrity);
    }
    const previous = new Set(input.before.tables.booking.rows.map(row => row.id));
    const current = new Set(input.effects.tables.booking.rows.map(row => row.id));
    if (bookingIds.some(id => previous.has(id) || !current.has(id))) return refused("failed", "cleanup-target-not-new", integrity);
    const ids = new Set(bookingIds);
    const captured = targetRows(input.effects, ids);
    for (const table of targetTables) {
      const protectedIds = new Set(input.before.tables[table].rows.map(row => row.id));
      if (captured[table].some(row => protectedIds.has(row.id))) return refused("failed", "cleanup-protected-target", integrity);
    }
    const expected = structuredClone(input.effects);
    for (const table of targetTables) expected.tables[table].rows = expected.tables[table].rows
      .filter(row => !ids.has(table === "booking" ? row.id : row.booking_id));
    return { schemaVersion: 1, outcome: "passed", code: "cleanup-planned", integrity, bookingIds,
      expected, expectedFingerprint: snapshotFingerprint(expected), capturedTargets: captured,
      targetFingerprint: rowsFingerprint(captured), sql: bookingIds.length ? cleanupSql(bookingIds, captured) : null,
      nativeProofRequired: true };
  } catch {
    return refused("incomplete", "cleanup-input-incomplete", integrity);
  }
}

export function verifyResourceCleanup(input) {
  const plan = planResourceCleanup(input);
  const proof = { schemaVersion: 1, outcome: plan.outcome, code: plan.code,
    expectedFingerprint: plan.expectedFingerprint, actualFingerprint: null, nativeProofRequired: true };
  if (plan.outcome !== "passed") return proof;
  try {
    proof.actualFingerprint = snapshotFingerprint(input.actual);
    proof.outcome = proof.actualFingerprint === plan.expectedFingerprint ? "passed" : "failed";
    proof.code = proof.outcome === "passed" ? "cleanup-verified" : "cleanup-state-mismatch";
  } catch {
    const comparison = compareResourceIntegrity({ before: plan.expected, after: input.actual,
      contract: input.contract, journal: { schemaVersion: 1, complete: true, effectsSettled: true,
        operations: [], mailReceipts: [], publications: [] } });
    proof.outcome = comparison.outcome === "failed" ? "failed" : "incomplete";
    proof.code = proof.outcome === "failed" ? "cleanup-state-mismatch" : "cleanup-capture-incomplete";
  }
  return proof;
}

export function verifyResourceCleanupPrecondition(input) {
  const plan = planResourceCleanup(input);
  const proof = { schemaVersion: 1, outcome: plan.outcome, code: plan.code,
    expectedTargetFingerprint: plan.targetFingerprint ?? null, actualTargetFingerprint: null, nativeProofRequired: true };
  if (plan.outcome !== "passed") return proof;
  try {
    snapshotFingerprint(input.current);
    proof.actualTargetFingerprint = rowsFingerprint(targetRows(input.current, new Set(plan.bookingIds)));
    proof.outcome = proof.actualTargetFingerprint === plan.targetFingerprint ? "passed" : "failed";
    proof.code = proof.outcome === "passed" ? "cleanup-precondition-verified" : "cleanup-target-drift";
  } catch {
    proof.outcome = "incomplete";
    proof.code = "cleanup-capture-incomplete";
  }
  return proof;
}
