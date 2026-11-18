import type { PlaygroundConnection } from "../../src/voice-playground.mjs";
import type { GenerationQuote } from "./voice-playground-pricing";

export function VoiceGenerationPrice({
  quote,
  connection = "genvoice",
  mode,
  variations = 1,
  exportTranscript = false,
}: {
  quote: GenerationQuote;
  connection?: PlaygroundConnection;
  mode: string;
  variations?: number;
  exportTranscript?: boolean;
}) {
  return (
    <section
      aria-label="Generation price details"
      className="bg-surface-subtle border-hairline rounded-lg border p-2.5"
    >
      <div className="text-muted-foreground flex flex-col items-start gap-1 text-xs tabular-nums">
        <span className="text-foreground font-medium">Estimated total: Unknown fee</span>
        {quote.baseCredits !== null && (
          <span>
            Model baseline: about {quote.baseCredits.toLocaleString()}{" "}
            {connection === "elevenlabs" ? "ElevenLabs credits" : "credits"}
            {mode === "tts" && variations > 1 ? ` / ${variations} takes` : ""}
          </span>
        )}
        <span className="text-foreground">
          {connection === "google" ? (
            "Gemini reports token usage. Account pricing determines the final fee."
          ) : connection === "elevenlabs" ? (
            "Voice fees may vary. Studio saves the charge if ElevenLabs reports it."
          ) : (
            <>
              Voice fees unverified
              {exportTranscript && mode === "tts"
                ? ", including the approximate 15% subtitle surcharge"
                : ""}
              . Actual charge appears after generation.
            </>
          )}
        </span>
        {mode === "dialogue" &&
          quote.rows.map((row) => (
            <span key={row.label}>
              {row.label}: {row.characters.toLocaleString()} chars /{" "}
              {row.baseCredits === null
                ? "unknown baseline"
                : `about ${row.baseCredits.toLocaleString()} model credits`}
            </span>
          ))}
      </div>
    </section>
  );
}
