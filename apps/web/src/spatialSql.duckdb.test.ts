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

const segmentMacro = `
CREATE OR REPLACE TEMP MACRO squiggles_segments_intersect(a_x, a_y, b_x, b_y, c_x, c_y, d_x, d_y) AS (
  greatest(a_x,b_x) >= least(c_x,d_x)
  AND least(a_x,b_x) <= greatest(c_x,d_x)
  AND greatest(a_y,b_y) >= least(c_y,d_y)
  AND least(a_y,b_y) <= greatest(c_y,d_y)
  AND ((d_x-c_x)*(a_y-c_y)-(d_y-c_y)*(a_x-c_x)) * ((d_x-c_x)*(b_y-c_y)-(d_y-c_y)*(b_x-c_x)) <= 0
  AND ((b_x-a_x)*(c_y-a_y)-(b_y-a_y)*(c_x-a_x)) * ((b_x-a_x)*(d_y-a_y)-(b_y-a_y)*(d_x-a_x)) <= 0
)`;

describe("drawn spatial filters in DuckDB", () => {
  it("parses the exact worker selection wrapper", async () => {
    const db = await duckdbBlocking.createDuckDB(
      bundles,
      new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING),
      duckdbBlocking.NODE_RUNTIME,
    );
    await db.instantiate();
    const connection = db.connect();
    connection.query(segmentMacro);
    connection.query(`
      CREATE TABLE activities (
        activity_id VARCHAR,
        xmin DOUBLE,
        ymin DOUBLE,
        xmax DOUBLE,
        ymax DOUBLE,
        track_points STRUCT(longitude DOUBLE, latitude DOUBLE, clean BOOLEAN)[]
      )
    `);
    connection.query(`
      INSERT INTO activities VALUES (
        'test', -105.31, 39.97, -105.19, 40.09,
        [
          {'longitude': -105.29, 'latitude': 39.99, 'clean': true},
          {'longitude': -105.25, 'latitude': 40.02, 'clean': true},
          {'longitude': -105.21, 'latitude': 40.07, 'clean': true}
        ]
      )
    `);

    expect(() => connection.query("SELECT squiggles_segments_intersect(0,0,2,2,0,2,2,0)")).not.toThrow();

    for (const predicate of ["intersects", "within"] as const) {
      const sql = applySpatialFilterSql(
        "SELECT activity_id FROM activities",
        { predicate, polygon, visible: false },
      );
      expect(() => connection.query(`WITH selected AS (${sql}) SELECT * FROM selected LIMIT 0`)).not.toThrow();
    }

    connection.close();
    db.terminate();
  });
});
