# Worker-open performance budget

The hosted Chromium smoke is the regression harness for browser startup. Before optimizing worker open, capture the current production baseline and keep the same smoke as the red/green check. Network timing output should make DuckDB WASM/worker and Parquet metadata costs visible without uploading artifacts on successful runs.
