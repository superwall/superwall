import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist/lib",
    emptyOutDir: true,
    lib: {
      entry: { index: "src/index.ts", products: "src/lib/products.ts" },
      formats: ["es"],
      fileName: (_format, name) => `${name}.js`,
      cssFileName: "studio",
    },
    rollupOptions: {
      external: ["react", "react-dom", "react/jsx-runtime", "react-dom/client", "sonner"],
    },
  },
});
