from __future__ import annotations

import json
import tempfile
import threading
import time
from datetime import UTC, datetime, timedelta
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq

ROWS = 10_000
ROW_GROUP_SIZE = 4096
RTT_SECONDS = 0.08
SELECTION_SQL = "SELECT count(*) FROM {relation} WHERE lower(sport_type) LIKE '%run%'"
SUMMARY_SQL = (
    "SELECT count(*),sum(distance_m),sum(elevation_gain_m),max(max_elevation_m) "
    "FROM {relation} WHERE activity_family='run'"
)
TABLE_SQL = (
    "SELECT activity_id,sport_type,start_time,distance_m,elevation_gain_m,max_elevation_m "
    "FROM {relation} WHERE activity_family='run' ORDER BY start_time DESC LIMIT 100"
)


class RangeServer:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.requests = 0
        self.bytes = 0
        parent = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, format: str, *args: object) -> None:
                return

            def do_HEAD(self) -> None:
                size = parent.path.stat().st_size
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Length", str(size))
                self.send_header("Accept-Ranges", "bytes")
                self.end_headers()

            def do_GET(self) -> None:
                size = parent.path.stat().st_size
                start, end = 0, size - 1
                range_header = self.headers.get("Range")
                if range_header and range_header.startswith("bytes="):
                    raw_start, raw_end = range_header.removeprefix("bytes=").split("-", 1)
                    if raw_start:
                        start = int(raw_start)
                    if raw_end:
                        end = min(size - 1, int(raw_end))
                    status = HTTPStatus.PARTIAL_CONTENT
                else:
                    status = HTTPStatus.OK
                length = max(0, end - start + 1)
                time.sleep(RTT_SECONDS)
                parent.requests += 1
                parent.bytes += length
                self.send_response(status)
                self.send_header("Content-Type", "application/octet-stream")
                self.send_header("Content-Length", str(length))
                self.send_header("Accept-Ranges", "bytes")
                if status == HTTPStatus.PARTIAL_CONTENT:
                    self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
                self.end_headers()
                with parent.path.open("rb") as handle:
                    handle.seek(start)
                    self.wfile.write(handle.read(length))

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.server.server_port}/metadata.parquet"

    def start(self) -> None:
        self.thread.start()

    def reset(self) -> None:
        self.requests = 0
        self.bytes = 0

    def close(self) -> None:
        self.server.shutdown()
        self.thread.join()
        self.server.server_close()


def metadata_table() -> pa.Table:
    base = datetime(2020, 1, 1, tzinfo=UTC)
    return pa.table(
        {
            "activity_id": [f"activity-{index:05d}" for index in range(ROWS)],
            "sport_type": ["Run" if index % 2 == 0 else "Ride" for index in range(ROWS)],
            "activity_family": ["run" if index % 2 == 0 else "ride" for index in range(ROWS)],
            "start_time": [base + timedelta(hours=index) for index in range(ROWS)],
            "distance_m": [float(5000 + index % 50_000) for index in range(ROWS)],
            "elapsed_seconds": [float(1800 + index % 7200) for index in range(ROWS)],
            "moving_seconds": [float(1700 + index % 7000) for index in range(ROWS)],
            "elevation_gain_m": [float(index % 3000) for index in range(ROWS)],
            "elevation_loss_m": [float(index % 2900) for index in range(ROWS)],
            "max_elevation_m": [float(1500 + index % 3000) for index in range(ROWS)],
            "xmin": [-105.5 + (index % 100) * 0.001 for index in range(ROWS)],
            "ymin": [39.5 + (index % 100) * 0.001 for index in range(ROWS)],
            "xmax": [-105.49 + (index % 100) * 0.001 for index in range(ROWS)],
            "ymax": [39.51 + (index % 100) * 0.001 for index in range(ROWS)],
        }
    )


def connection() -> duckdb.DuckDBPyConnection:
    conn = duckdb.connect()
    conn.execute("INSTALL httpfs; LOAD httpfs")
    conn.execute("SET enable_object_cache=false")
    return conn


def timed(conn: duckdb.DuckDBPyConnection, sql: str) -> float:
    started = time.perf_counter()
    conn.execute(sql).fetchall()
    return (time.perf_counter() - started) * 1000


def remote_view_case(url: str, server: RangeServer) -> dict[str, object]:
    conn = connection()
    escaped = url.replace("'", "''")
    conn.execute(f"CREATE VIEW activity_source AS SELECT * FROM read_parquet('{escaped}')")
    conn.execute("CREATE TEMP VIEW activities AS SELECT * FROM activity_source")
    server.reset()
    selection_cold = timed(conn, SELECTION_SQL.format(relation="activities"))
    selection_warm = timed(conn, SELECTION_SQL.format(relation="activities"))
    summary = timed(conn, SUMMARY_SQL.format(relation="activities"))
    table = timed(conn, TABLE_SQL.format(relation="activities"))
    result = {
        "selectionColdMs": round(selection_cold, 1),
        "selectionWarmMs": round(selection_warm, 1),
        "summaryMs": round(summary, 1),
        "tableMs": round(table, 1),
        "httpRequests": server.requests,
        "httpBytes": server.bytes,
    }
    conn.close()
    return result


def materialized_case(url: str, server: RangeServer) -> dict[str, object]:
    conn = connection()
    escaped = url.replace("'", "''")
    server.reset()
    started = time.perf_counter()
    conn.execute(f"CREATE TEMP TABLE activity_cache AS SELECT * FROM read_parquet('{escaped}')")
    materialize = (time.perf_counter() - started) * 1000
    requests_after_materialize = server.requests
    bytes_after_materialize = server.bytes
    selection = timed(conn, SELECTION_SQL.format(relation="activity_cache"))
    summary = timed(conn, SUMMARY_SQL.format(relation="activity_cache"))
    table = timed(conn, TABLE_SQL.format(relation="activity_cache"))
    result = {
        "materializeMs": round(materialize, 1),
        "selectionWarmMs": round(selection, 1),
        "summaryMs": round(summary, 1),
        "tableMs": round(table, 1),
        "httpRequests": server.requests,
        "httpBytes": server.bytes,
        "requestsAfterMaterialize": requests_after_materialize,
        "bytesAfterMaterialize": bytes_after_materialize,
    }
    conn.close()
    return result


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="squiggles-metadata-bench-") as temporary:
        path = Path(temporary) / "metadata.parquet"
        pq.write_table(
            metadata_table(),
            path,
            compression="zstd",
            row_group_size=ROW_GROUP_SIZE,
        )
        server = RangeServer(path)
        server.start()
        try:
            old = remote_view_case(server.url, server)
            new = materialized_case(server.url, server)
        finally:
            server.close()
        report = {
            "rows": ROWS,
            "rowGroupSize": ROW_GROUP_SIZE,
            "parquetBytes": path.stat().st_size,
            "simulatedRangeRttMs": round(RTT_SECONDS * 1000),
            "remoteView": old,
            "materialized": new,
        }
        old_warm = float(old["selectionWarmMs"])
        new_warm = float(new["selectionWarmMs"])
        report["warmSelectionSpeedupX"] = round(old_warm / max(new_warm, 0.001), 1)
        print("METADATA_CACHE_BENCHMARK", json.dumps(report, sort_keys=True))


if __name__ == "__main__":
    main()
