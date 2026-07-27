import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";

/**
 * The studio is a standalone vite app (the old-editor model). `superwall
 * dev` serves the BUILT dist — assets under `/__studio/` so they can never
 * collide with the project's own vite graph — plus the data endpoint
 * (`/__studio/project.json`) and the `/preview/<kind>/<id>` mounts the
 * studio iframes.
 *
 * Working ON the studio: run `bun dev` here against a live project dev
 * server (`superwall dev` in any project, default port 6100) — previews and
 * project data proxy through.
 */
export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss()],
  // Build for the /__studio/ mount; local studio dev serves from the root
  // so pathname routing (/paywall/<id>) works.
  base: command === "build" ? "/__studio/" : "/",
  server: {
    port: 6200,
    proxy: {
      "/preview": "http://localhost:6100",
      "/__studio/project.json": "http://localhost:6100",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
}));
