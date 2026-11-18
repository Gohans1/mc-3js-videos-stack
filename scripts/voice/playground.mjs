import { runVoicePlaygroundCli } from "../../packages/live-studio/src/voice-playground-cli.mjs";

const code = await runVoicePlaygroundCli(process.argv.slice(2));
process.stdout.write("", () => process.stderr.write("", () => process.exit(code)));
