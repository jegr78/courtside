import assert from "node:assert/strict";
import { test } from "node:test";
import { resourceStateSnapshotSql, parseResourceState, captureResourceState } from "./security-resource-state.mjs";

test("given an owned database command, when capturing protected state, then query the actual catalog and preserve rows under a bounded read-only snapshot", async () => {
  // given
  const calls = [];
  const snapshot = { schemaVersion: 1, tables: {
    person: { columns: ["id"], primaryKey: ["id"], rows: [{ id: "person-1" }] }
  } };
  const command = async (args, options) => {
    calls.push({ args, options });
    return { stdout: JSON.stringify(calls.length === 1 ? [{ schema: "public", table: "person" }] : snapshot) };
  };
  // when
  const actual = await captureResourceState(command, ["compose", "--project-name", "owned-security"]);
  // then
  assert.deepEqual(actual, snapshot);
  assert.equal(calls.length, 2);
  for (const { args, options } of calls) {
    assert.deepEqual(args.slice(0, 3), ["compose", "--project-name", "owned-security"]);
    assert.ok(args.includes("ON_ERROR_STOP=1"));
    assert.ok(args.includes("-qAt"));
    assert.ok(options.outputLimitBytes <= 32 * 1024 * 1024);
  }
  assert.match(calls[1].args.at(-1), /REPEATABLE READ READ ONLY/);
});

test("given a missing or foreign database catalog, when capturing protected state, then reject before issuing a row query", async () => {
  // given
  for (const output of ["not-json", "[]", '[{"schema":"foreign","table":"person"}]']) {
    let calls = 0;
    const command = async () => { calls++; return { stdout: output }; };
    // when / then
    await assert.rejects(captureResourceState(command, ["compose"]), /catalog|schema/);
    assert.equal(calls, 1);
  }
});

test("given untrusted catalog identifiers, when constructing a snapshot query, then reject SQL-bearing names", () => {
  // given
  const catalog = [{ table: "user_account; DELETE FROM user_account" }];
  // when / then
  assert.throws(() => resourceStateSnapshotSql(catalog), /identifier/);
  assert.throws(() => resourceStateSnapshotSql([{ table: "person", schema: "foreign" }]), /schema/);
  assert.throws(() => resourceStateSnapshotSql([{ table: "person" }, { table: "person" }]), /duplicate/);
});

test("given a complete generated snapshot, when parsing database output, then preserve every column and row including import and authentication data", () => {
  // given
  const snapshot = { schemaVersion: 1, tables: {
    user_account: { columns: ["id", "password_hash"], primaryKey: ["id"], rows: [{ id: "account-1", password_hash: "private" }] },
    import_preview: { columns: ["id"], primaryKey: ["id"], rows: [{ id: "preview-1" }] },
    spring_session: { columns: ["primary_id"], primaryKey: ["primary_id"], rows: [] }
  } };
  // when
  const actual = parseResourceState(`\n${JSON.stringify(snapshot)}\n`);
  // then
  assert.deepEqual(actual, snapshot);
});

test("given missing malformed or incomplete database output, when parsing a snapshot, then never return an empty protected-state success", () => {
  // given
  const outputs = ["", "not-json", "{}", JSON.stringify({ schemaVersion: 1, tables: {} }),
    JSON.stringify({ schemaVersion: 1, tables: { person: { columns: ["id"], primaryKey: [], rows: [] } } }),
    JSON.stringify({ schemaVersion: 1, tables: { person: { columns: ["id"], primaryKey: ["id"], rows: [{}] } } })];
  // when / then
  for (const output of outputs) assert.throws(() => parseResourceState(output), /snapshot/);
});

test("given a complete valid snapshot, when only its valid primary-key row is duplicated, then parsing rejects the duplicate", () => {
  // given
  const snapshot = { schemaVersion: 1, tables: {
    person: { columns: ["id", "first_name"], primaryKey: ["id"],
      rows: [{ id: "person-1", first_name: "Jane" }] }
  } };
  assert.deepEqual(parseResourceState(JSON.stringify(snapshot)), snapshot);
  const duplicate = structuredClone(snapshot);
  duplicate.tables.person.rows.push(structuredClone(duplicate.tables.person.rows[0]));
  // when / then
  assert.throws(() => parseResourceState(JSON.stringify(duplicate)), /duplicate primary keys/);
});
