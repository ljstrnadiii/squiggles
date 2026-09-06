from __future__ import annotations

import json
import tempfile
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq

SHARDS = 8
ROWS_PER_SHARD = 1024
ROW_GROUP_SIZE = 256
RTT_SECONDS = 0.08
TARGET_SHARD = 6
TARGET_ROW = 700


class RangeServer:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.requests = 0
        self.bytes = 0
        parent = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, format: str, *args: object) -> None:
                return

            def file_path(self) -> Path:
                relative = unquote(urlparse(self.path).path).lstrip("/")
                path = (parent.root / relative).resolve()
                if parent.root.resolve() not in path.parents:
                    raise FileNotFoundError(relative)
                return path

            def do_HEAD(self) -> None:
                path = self.file_path()
                size = path.stat().st_size
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Length", str(size))
                self.send_header("Accept-Ranges", "bytes")
                self.end_headers()

            def do_GET(self) -> None:
                path = self.file_path()
                size = path.stat().st_size
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
                with path.open("rb") as handle:
                    handle.seek(start)
                    self.wfile.write(handle.read(length))

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.server.server_port}"

    def start(self) -> None:
        self.thread.start()

    def reset(self) -> None:
        self.requests = 0
        self.bytes = 0

    def close(self) -> None:
        self.server.shutdown()
        self.thread.join()
        self.server.server_close()


def write_shards(root: Path) -> list[Path]:
    paths: list[Path] = []
    for shard in range(SHARDS):
        directory = root / "activities" / "activity_family=run"
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / f"part-{shard:03d}.parquet"
        start = shard * ROWS_PER_SHARD
        ids = [f"activity-{start + row:05d}" for row in range(ROWS_PER_SHARD)]
        table = pa.table(
            {
                "activity_id": ids,
                "name": [f"Synthetic activity {activity_id}" for activity_id in ids],
                "distance_m": [float(10_000 + row) for row in range(ROWS_PER_SHARD)],
                "payload": [f"{activity_id}-" + "x" * 512 for activity_id in ids],
            }
        )
        pq.write_table(table, path, compression="zstd", row_group_size=ROW_GROUP_SIZE)
        paths.append(path)
    return paths


def connection() -> duckdb.DuckDBPyConnection:
    conn = duckdb.connect()
    conn.execute("INSTALL httpfs; LOAD httpfs")
    conn.execute("SET enable_object_cache=false")
    return conn


def timed(conn: duckdb.DuckDBPyConnection, sql: str) -> float:
    started = time.perf_counter()
    rows = conn.execute(sql).fetchall()
    elapsed = (time.perf_counter() - started) * 1000
    if len(rows) != 1:
        raise RuntimeError(f"expected one detail row, got {len(rows)}")
    return elapsed


def benchmark_case(
    urls: list[str],
    target_id: str,
    server: RangeServer,
) -> dict[str, object]:
    conn = connection()
    relation = ",".join(f"'{url.replace(chr(39), chr(39) * 2)}'" for url in urls)
    sql = (
        "SELECT activity_id,name,distance_m,payload "
        f"FROM read_parquet([{relation}],hive_partitioning=true) "
        f"WHERE activity_id='{target_id}' LIMIT 1"
    )
    server.reset()
    cold = timed(conn, sql)
    cold_requests = server.requests
    cold_bytes = server.bytes
    server.reset()
    warm = timed(conn, sql)
    result = {
        "coldMs": round(cold, 1),
        "warmMs": round(warm, 1),
        "coldHttpRequests": cold_requests,
        "coldHttpBytes": cold_bytes,
        "warmHttpRequests": server.requests,
        "warmHttpBytes": server.bytes,
    }
    conn.close()
    return result


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="squiggles-detail-bench-") as temporary:
        root = Path(temporary)
        paths = write_shards(root)
        target_id = f"activity-{TARGET_SHARD * ROWS_PER_SHARD + TARGET_ROW:05d}"
        server = RangeServer(root)
        server.start()
        try:
            urls = [
                f"{server.base_url}/{path.relative_to(root).as_posix()}" for path in paths
            ]
            broad = benchmark_case(urls, target_id, server)
            targeted = benchmark_case([urls[TARGET_SHARD]], target_id, server)
        finally:
            server.close()

        report = {
            "shards": SHARDS,
            "rowsPerShard": ROWS_PER_SHARD,
            "rowGroupSize": ROW_GROUP_SIZE,
            "simulatedRangeRttMs": round(RTT_SECONDS * 1000),
            "targetShard": TARGET_SHARD,
            "broadCanonicalRead": broad,
            "targetedCanonicalRead": targeted,
            "coldSpeedupX": round(
                float(broad["coldMs"]) / max(float(targeted["coldMs"]), 0.001), 1
            ),
            "warmSpeedupX": round(
                float(broad["warmMs"]) / max(float(targeted["warmMs"]), 0.001), 1
            ),
        }
        print("CANONICAL_DETAIL_BENCHMARK", json.dumps(report, sort_keys=True))


if __name__ == "__main__":
    main()
