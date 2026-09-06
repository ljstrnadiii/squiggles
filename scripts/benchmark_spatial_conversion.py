from __future__ import annotations

import json
import statistics
import time

import duckdb
import pyarrow as pa

ROUTES = 2_000
POINTS_PER_ROUTE = 200
REPEATS = 5

CURRENT_CONVERSION = (
    "ST_MakeLine(list_transform(geometry, lambda p : "
    "ST_Point(list_extract(p, 1), list_extract(p, 2))))"
)
NATIVE_CONVERSION = (
    "CAST(CAST(list_transform(geometry, lambda p : "
    "struct_pack(x := list_extract(p, 1), y := list_extract(p, 2))) "
    "AS LINESTRING_2D) AS GEOMETRY)"
)
POLYGON = (
    "ST_GeomFromText('POLYGON((-105.3 39.8,-104.7 39.8,-104.7 40.2,-105.3 40.2,-105.3 39.8))')"
)


def routes_table() -> pa.Table:
    ids: list[str] = []
    routes: list[list[list[float]]] = []
    for route_index in range(ROUTES):
        longitude = -105.6 + (route_index % 80) * 0.015
        latitude = 39.6 + (route_index // 80) * 0.025
        route = [
            [longitude + point * 0.0003, latitude + point * 0.00015]
            for point in range(POINTS_PER_ROUTE)
        ]
        ids.append(f"activity-{route_index:05d}")
        routes.append(route)
    return pa.table({"activity_id": ids, "geometry": routes})


def median_ms(conn: duckdb.DuckDBPyConnection, sql: str) -> float:
    samples: list[float] = []
    for _ in range(REPEATS):
        started = time.perf_counter()
        conn.execute(sql).fetchall()
        samples.append((time.perf_counter() - started) * 1000)
    return statistics.median(samples)


def conversion_ms(conn: duckdb.DuckDBPyConnection, expression: str, name: str) -> float:
    samples: list[float] = []
    for _ in range(REPEATS):
        conn.execute(f"DROP TABLE IF EXISTS {name}")
        started = time.perf_counter()
        conn.execute(
            f"CREATE TEMP TABLE {name} AS SELECT activity_id,{expression} route FROM routes"
        )
        samples.append((time.perf_counter() - started) * 1000)
    return statistics.median(samples)


def main() -> None:
    conn = duckdb.connect()
    conn.execute("INSTALL spatial; LOAD spatial")
    conn.register("route_arrow", routes_table())
    conn.execute("CREATE TEMP TABLE routes AS SELECT * FROM route_arrow")

    current_conversion_ms = conversion_ms(conn, CURRENT_CONVERSION, "current_routes")
    native_conversion_ms = conversion_ms(conn, NATIVE_CONVERSION, "native_routes")
    current_predicate_ms = median_ms(
        conn,
        f"SELECT count(*) FROM current_routes WHERE ST_Intersects(route,{POLYGON})",
    )
    native_predicate_ms = median_ms(
        conn,
        f"SELECT count(*) FROM native_routes WHERE ST_Intersects(route,{POLYGON})",
    )
    current_total_ms = median_ms(
        conn,
        f"SELECT count(*) FROM routes WHERE ST_Intersects({CURRENT_CONVERSION},{POLYGON})",
    )
    native_total_ms = median_ms(
        conn,
        f"SELECT count(*) FROM routes WHERE ST_Intersects({NATIVE_CONVERSION},{POLYGON})",
    )
    report = {
        "routes": ROUTES,
        "pointsPerRoute": POINTS_PER_ROUTE,
        "repeats": REPEATS,
        "current": {
            "conversionMs": round(current_conversion_ms, 1),
            "predicateMs": round(current_predicate_ms, 1),
            "totalMs": round(current_total_ms, 1),
        },
        "nativeLinestring": {
            "conversionMs": round(native_conversion_ms, 1),
            "predicateMs": round(native_predicate_ms, 1),
            "totalMs": round(native_total_ms, 1),
        },
        "conversionSpeedupX": round(current_conversion_ms / max(native_conversion_ms, 0.001), 2),
        "totalSpeedupX": round(current_total_ms / max(native_total_ms, 0.001), 2),
    }
    print("SPATIAL_CONVERSION_BENCHMARK", json.dumps(report, sort_keys=True))


if __name__ == "__main__":
    main()
