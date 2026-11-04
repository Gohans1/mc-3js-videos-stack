// Opens this film in the studio, which lives in its own repo: node_modules/live-studio links to it.
import { fileURLToPath } from "node:url";

process.env.LIVE_PROJECT = fileURLToPath(new URL("..", import.meta.url));
await import("live-studio/src/live.mjs");
