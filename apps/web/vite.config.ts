import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { createReadStream, statSync } from "node:fs";
import { resolve, sep } from "node:path";

const localDataRoot = resolve(import.meta.dirname, "../../data/local");
export default defineConfig({
  optimizeDeps: { exclude: ["maplibre-gl"] },
  plugins: [
    react(),
    {
      name: "local-dataset",
      configureServer(server) {
        server.middlewares.use("/local-data", (request, response, next) => {
          const requested = resolve(localDataRoot, `.${decodeURIComponent(request.url ?? "/")}`);
          if (!requested.startsWith(`${localDataRoot}${sep}`)) return next();
          try {
            const size = statSync(requested).size;
            response.setHeader("Accept-Ranges", "bytes");
            response.setHeader("Content-Type", requested.endsWith(".json") ? "application/json" : "application/octet-stream");
            const match = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? "");
            if (match) {
              const start = Number(match[1]);
              const end = Math.min(match[2] ? Number(match[2]) : size - 1, size - 1);
              response.statusCode = 206;
              response.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
              response.setHeader("Content-Length", end - start + 1);
              createReadStream(requested, { start, end }).pipe(response);
            } else {
              response.setHeader("Content-Length", size);
              createReadStream(requested).pipe(response);
            }
          } catch {
            next();
          }
        });
      },
    },
  ],
});
