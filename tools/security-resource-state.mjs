const identifier = /^[a-z][a-z0-9_]{0,62}$/;

export async function captureResourceState(command, composeArguments) {
  const query = async (sql, outputLimitBytes) => (await command([...composeArguments,
    "exec", "-T", "db", "psql", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "courtside",
    "-d", "courtside_security", "-c", sql], { outputLimitBytes })).stdout;
  let catalog;
  try { catalog = JSON.parse(await query(resourceStateCatalogSql, 1024 * 1024)); }
  catch { throw new Error("The database returned an invalid snapshot catalog"); }
  const sql = resourceStateSnapshotSql(catalog);
  return parseResourceState(await query(sql, 32 * 1024 * 1024));
}

export const resourceStateCatalogSql = `SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'schema', table_schema, 'table', table_name) ORDER BY table_schema, table_name), '[]'::jsonb)
  FROM information_schema.tables WHERE table_type = 'BASE TABLE'
  AND table_schema NOT IN ('information_schema', 'pg_catalog')`;

export function resourceStateSnapshotSql(catalog) {
  if (!Array.isArray(catalog) || catalog.length === 0) throw new Error("The snapshot catalog is empty");
  const tables = catalog.map(({ table, schema = "public" }) => {
    if (schema !== "public") throw new Error("The snapshot encountered an unsupported schema");
    if (typeof table !== "string" || !identifier.test(table)) throw new Error("Invalid snapshot table identifier");
    return table;
  }).sort();
  if (new Set(tables).size !== tables.length) throw new Error("The snapshot catalog contains duplicate tables");
  const entries = tables.map((table) => `SELECT '${table}' AS name, jsonb_build_object(
    'columns', (SELECT jsonb_agg(column_name ORDER BY column_name) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = '${table}'),
    'primaryKey', (SELECT jsonb_agg(k.column_name ORDER BY k.ordinal_position)
      FROM information_schema.table_constraints c JOIN information_schema.key_column_usage k
        USING (constraint_catalog, constraint_schema, constraint_name, table_catalog, table_schema, table_name)
      WHERE c.table_schema = 'public' AND c.table_name = '${table}' AND c.constraint_type = 'PRIMARY KEY'),
    'rows', (SELECT COALESCE(jsonb_agg(to_jsonb(r)), '[]'::jsonb) FROM public."${table}" r)) AS value`).join(" UNION ALL ");
  return `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
    SELECT jsonb_build_object('schemaVersion', 1, 'tables', jsonb_object_agg(name, value))
    FROM (${entries}) entries
    HAVING (SELECT jsonb_agg(jsonb_build_object('schema', table_schema, 'table', table_name)
      ORDER BY table_schema, table_name) FROM information_schema.tables
      WHERE table_type = 'BASE TABLE' AND table_schema NOT IN ('information_schema', 'pg_catalog'))
      = '${JSON.stringify(tables.map((table) => ({ schema: "public", table })))}'::jsonb;
    COMMIT;`;
}

export function parseResourceState(output) {
  let snapshot;
  try { snapshot = JSON.parse(output); }
  catch { throw new Error("The database returned an invalid resource snapshot"); }
  if (snapshot?.schemaVersion !== 1 || !snapshot.tables || typeof snapshot.tables !== "object"
    || Array.isArray(snapshot.tables) || Object.keys(snapshot.tables).length === 0) {
    throw new Error("The database returned an incomplete resource snapshot");
  }
  for (const [name, table] of Object.entries(snapshot.tables)) {
    if (!identifier.test(name) || !Array.isArray(table.columns) || table.columns.length === 0
      || table.columns.some((column) => typeof column !== "string" || !identifier.test(column))
      || new Set(table.columns).size !== table.columns.length || !Array.isArray(table.primaryKey)
      || table.primaryKey.length === 0 || table.primaryKey.some((key) => !table.columns.includes(key))
      || new Set(table.primaryKey).size !== table.primaryKey.length || !Array.isArray(table.rows)) {
      throw new Error("The resource snapshot has invalid table metadata");
    }
    const keys = new Set();
    for (const row of table.rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)
        || JSON.stringify(Object.keys(row).sort()) !== JSON.stringify([...table.columns].sort())
        || table.primaryKey.some((key) => row[key] === null || row[key] === undefined)) {
        throw new Error("The resource snapshot has an incomplete row");
      }
      const key = JSON.stringify(table.primaryKey.map((column) => row[column]));
      if (keys.has(key)) throw new Error("The resource snapshot has duplicate primary keys");
      keys.add(key);
    }
  }
  return snapshot;
}
