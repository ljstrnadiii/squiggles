# DuckDB-Wasm pin

Squiggles currently pins `@duckdb/duckdb-wasm` to `1.33.1-dev20.0` because later `1.33.1-dev` builds have an upstream GeoParquet regression where `read_parquet()` can fail in the browser with `stoi: no conversion` while parsing GeoParquet metadata.

Do not upgrade this dependency without running the hosted Chromium smoke against the production GeoParquet dataset.
