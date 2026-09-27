import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFile } from "node:fs/promises";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "runtime-deployment-in-development",
      configureServer(server) {
        // Development reads the same generated deployment as production.
        server.middlewares.use(async (request, response, next) => {
          const pathname = new URL(request.url || "/", "http://localhost")
            .pathname;
          if (
            !/^\/(?:imd-deployment\.json|abi\/[A-Za-z0-9_-]+\.json)$/.test(
              pathname,
            )
          )
            return next();
          try {
            const bytes = await readFile(
              new URL(`../dist${pathname}`, import.meta.url),
            );
            response.setHeader("Content-Type", "application/json");
            response.end(bytes);
          } catch {
            next();
          }
        });
      },
    },
  ],
  base: "./",
  build: { outDir: "../dist", emptyOutDir: true, sourcemap: false },
});
