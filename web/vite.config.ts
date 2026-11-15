import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// Only the two inference endpoints are exposed, never model pulls or deletion.
// Each laptop runs its own Vite/preview server and its own Ollama runtime.
const ollama = new URL(process.env.SYMPHONY_OLLAMA_URL || "http://127.0.0.1:11434");
if (!["localhost", "127.0.0.1", "[::1]"].includes(ollama.hostname)) {
  throw new Error("Ollama must run on this computer.");
}
const proxy = {
  "^/api/local-llm/(chat|tags)$": {
    target: ollama.origin,
    changeOrigin: true,
    rewrite: (reqPath: string) => reqPath.replace("/api/local-llm", "/api"),
  },
};

export default defineConfig({
  root: path.resolve(__dirname),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "../shared"),
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: true,
    port: 5173,
    proxy,
  },
  preview: {
    host: true,
    proxy,
  },
  build: {
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          tone: ["tone"],
          vendor: ["react", "react-dom", "lucide-react"],
        },
      },
    },
  },
});
