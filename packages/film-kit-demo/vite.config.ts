import { defineConfig } from "vite";

export default defineConfig({
  server: { host: "127.0.0.1", port: 4350, strictPort: true, allowedHosts: [".ts.net"] },
});
