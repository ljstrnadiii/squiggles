import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { createReadStream, statSync } from "node:fs";
import { resolve, sep } from "node:path";

const localDataRoot = resolve(import.meta.dirname, "../../data/local");
const cartoApiKey = process.env.VITE_CARTO_API_KEY?.trim();
const cartoTileUrls = [
  "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
  "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
];

export default defineConfig({
  optimizeDeps: { exclude: ["maplibre-gl"] },
  plugins: [
    react(),
    {
      name: "carto-basemap-key",
      transform(code, id) {
        if (!cartoApiKey || !id.endsWith("/src/App.tsx")) return null;
        const key = encodeURIComponent(cartoApiKey);
        const transformed = cartoTileUrls.reduce(
          (source, url) => source.replaceAll(url, `${url}?key=${key}`),
          code,
        );
        return transformed === code ? null : { code: transformed, map: null };
      },
    },
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
