import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "0.0.0.0",
    allowedHosts: ["nick-asus.kingfisher-pain.ts.net"],
  },
});
