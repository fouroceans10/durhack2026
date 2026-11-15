import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "./shared"),
      "@": path.resolve(__dirname, "./web/src"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: [
      "shared/**/*.test.ts",
      "web/src/**/*.test.ts",
      "web/src/**/*.test.tsx",
      "signalling/**/*.test.ts",
    ],
  },
});
