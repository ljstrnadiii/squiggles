import path from "node:path";
import { createRequire } from "node:module";

import * as duckdb from "@duckdb/duckdb-wasm";
import * as duckdbBlocking from "@duckdb/duckdb-wasm/dist/duckdb-node-blocking";
import { describe, expect, it } from "vitest";

import { applySpatialFilterSql } from "./spatialSql";

const require = createRequire(import.meta.url);
const duckdbDist = path.dirname(require.resolve("@duckdb/duckdb-wasm"));
const bundles = {
  mvp: { mainModule: path.resolve(duckdbDist, "duckdb-mvp.wasm"), mainWorker: "" },
  eh: { mainModule: path.resolve(duckdbDist, "duckdb-eh.wasm"), mainWorker: "" },
};

const polygon: [number, number][] = [
  [-105.3019681, 39.98],
  [-105.2, 39.98],
  [-105.2, 40.08],
  [-105.3019681, 40.08],
];

function scalar(result: ReturnType<duckdbBlocking.DuckDBConnection["query"]>, name: string) {
  return result.getChild(name)?.get(0)?.toString();
}

describe("drawn spatial filters in DuckDB", () => {
  it("executes the exact worker selection wrapper with DuckDB Spatial", async () => {
    const db = await duckdbBlocking.createDuckDB(
      bundles,
      new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING),
      duckdbBlocking.NODE_RUNTIME,
    );
    await db.instantiate();
    const connection = db.connect();

    // The blocking Node runtime cannot fetch extensions through its synchronous
    // XHR shim. Fetch the exact WASM extension asynchronously and register it in
    // DuckDB's virtual filesystem, then load it normally. This still exercises
    // the real DuckDB-Wasm engine and real Spatial extension used in-browser.
    const version = scalar(connection.query("SELECT library_version FROM pragma_version()"), "library_version");
    const platform = scalar(connection.query("SELECT platform FROM pragma_platform()"), "platform");
    if (!version || !platform) throw new Error("Could not resolve DuckDB-Wasm extension version/platform");
    const response = await fetch(`https://extensions.duckdb.org/${version}/${platform}/spatial.duckdb_extension.wasm`);
    if (!response.ok) throw new Error(`Could not fetch DuckDB-Wasm Spatial extension: ${response.status}`);
    db.registerFileBuffer("spatial.duckdb_extension.wasm", new Uint8Array(await response.arrayBuffer()));
    connection.query("LOAD 'spatial.duckdb_extension.wasm'");

    connection.query(`
      CREATE TABLE activities (
        activity_id VARCHAR,
        xmin DOUBLE,
        ymin DOUBLE,
        xmax DOUBLE,
        ymax DOUBLE,
        geometry DOUBLE[][]
      )
    `);
    connection.query(`
      INSERT INTO activities VALUES (
        'test', -105.31, 39.97, -105.19, 40.09,
        [
          [-105.29, 39.99],
          [-105.25, 40.02],
          [-105.21, 40.07]
        ]
      )
    `);

    for (const predicate of ["intersects", "within"] as const) {
      const sql = applySpatialFilterSql(
        "SELECT activity_id FROM activities",
        { predicate, polygon, visible: false },
      );
      const result = connection.query(`WITH selected AS (${sql}) SELECT * FROM selected`);
      expect(result.numRows).toBe(1);
    }

    connection.close();
    db.terminate();
  });
});
