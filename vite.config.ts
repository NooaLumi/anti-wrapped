import { defineConfig } from "vite";

export default defineConfig({
  base: "/anti-wrapped/",
  root: ".",
  publicDir: "public",
  build: {
    outDir: "dist",
  },
  server: {
    open: true,
  },
});
