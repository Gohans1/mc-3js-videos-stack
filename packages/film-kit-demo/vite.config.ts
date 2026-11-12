// The demo page (bun run demo): reachable through `tailscale serve` too, whose requests carry the *.ts.net host name
import { defineConfig } from "vite";

export default defineConfig({
  server: { host: "127.0.0.1", port: 4350, strictPort: true, allowedHosts: [".ts.net"] },
});
