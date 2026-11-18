import { CheckCircle2, KeyRound, RefreshCw, RotateCcw, ShieldAlert } from "lucide-react";
import { useId, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import type { PlaygroundConnection, PlaygroundStatus } from "../../src/voice-playground.mjs";
import { Tip } from "../components/Tip";
import { savePlaygroundConfig, testPlaygroundConnection } from "./voice-playground-client";

const sourceLabel = (source: PlaygroundStatus["source"], envKey: string) => {
  switch (source) {
    case "override":
      return "Studio manual override";
    case "env":
      return `Auto · ${envKey}`;
    case "secrets_file":
      return "Auto · ~/.secrets/genvoice.env";
    default:
      return "Not configured";
  }
};

export function VoicePlaygroundKeyPopover({
  status: playgroundStatus,
  connection = "genvoice",
  busyAction,
  showTooltip = true,
}: {
  status: PlaygroundStatus;
  connection?: PlaygroundConnection;
  busyAction: string | null;
  showTooltip?: boolean;
}) {
  const direct = connection !== "genvoice";
  const serviceName =
    connection === "google" ? "Google Gemini" : direct ? "ElevenLabs" : "GenVoice";
  const envKey =
    connection === "google" ? "GEMINI_API_KEY" : direct ? "ELEVENLABS_API_KEY" : "GENVOICE_API_KEY";
  const status: PlaygroundStatus = direct
    ? {
        configured: false,
        source: "none",
        maskedKey: "",
        hasOverride: false,
        ...playgroundStatus.connections?.[connection],
        account: null,
        apiBase:
          connection === "google" ? "generativelanguage.googleapis.com" : "api.elevenlabs.io",
      }
    : playgroundStatus;
  const apiKeyId = useId();
  const [open, setOpen] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [apiBaseInput, setApiBaseInput] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const hasError = Boolean(status.error);
  const isActive = Boolean(status.configured && !hasError);
  const isBusy = busyAction === "config" || busyAction === "status-test";
  const creditsLabel =
    status.account?.credit_balance != null
      ? `${status.account.credit_balance.toLocaleString()} cr`
      : isActive
        ? direct && !playgroundStatus.connections?.[connection]?.verified
          ? "Key set"
          : "Connected"
        : hasError
          ? "Key Error"
          : "API Key";

  const handleSave = async () => {
    setLocalError(null);
    const trimmedKey = apiKeyInput.trim();
    const trimmedBase = apiBaseInput.trim();
    if (!trimmedKey && !trimmedBase) {
      setLocalError(
        direct
          ? `Enter a ${serviceName} API key.`
          : "Enter a GenVoice API key or custom base URL to override.",
      );
      return;
    }
    const bareBase = trimmedBase.replace(/\/+$/, "");
    const normalizedBase = /^https:\/\/api\.genvoice\.pro$/i.test(bareBase)
      ? "https://api.genvoice.pro/v1"
      : bareBase;
    if (normalizedBase && normalizedBase !== "https://api.genvoice.pro/v1" && !trimmedKey) {
      setLocalError("Enter an API key alongside a custom endpoint URL.");
      return;
    }
    try {
      const saved = await savePlaygroundConfig({
        connection,
        ...(trimmedKey ? { apiKey: trimmedKey } : {}),
        ...(trimmedBase ? { apiBase: trimmedBase } : {}),
      });
      if (!direct && saved?.error) {
        setLocalError(saved.error);
        return;
      }
      setApiKeyInput("");
      setApiBaseInput("");
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "Could not save API configuration");
    }
  };

  const handleClearOverride = async () => {
    setLocalError(null);
    try {
      await savePlaygroundConfig({ connection, clearOverride: true });
      setApiKeyInput("");
      setApiBaseInput("");
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "Could not reset override");
    }
  };

  const tipText = isActive
    ? `${serviceName} key configured (${sourceLabel(status.source, envKey)}).`
    : hasError
      ? `${serviceName} API error: ${status.error}`
      : `${serviceName} key missing. Paste a key or set ${envKey}.`;
  const triggerNode = (
    <PopoverTrigger
      render={
        <Button
          type="button"
          variant="subtle"
          size="sm"
          aria-label={`${creditsLabel} · ${serviceName} API key settings`}
          title={!showTooltip ? tipText : undefined}
        />
      }
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          isActive ? "bg-ok" : hasError ? "bg-destructive" : "bg-warn",
        )}
      />
      <KeyRound className="size-3 opacity-80" />
      <span className="tabular-nums">{creditsLabel}</span>
    </PopoverTrigger>
  );

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setLocalError(null);
      }}
    >
      {showTooltip ? <Tip label={tipText}>{triggerNode}</Tip> : triggerNode}
      <PopoverContent align="end" variant="flush" className="w-[min(20rem,calc(100vw-1.5rem))]">
        <div className="flex flex-col gap-2.5 p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <PopoverTitle>{serviceName} API Connection</PopoverTitle>
              <p className="text-muted-foreground text-xs">{sourceLabel(status.source, envKey)}</p>
            </div>
            <Badge variant={isActive ? "done" : "check"}>
              {isActive ? (
                <>
                  <CheckCircle2 />
                  <span>
                    {direct && !playgroundStatus.connections?.[connection]?.verified
                      ? "Key set"
                      : "Active"}
                  </span>
                </>
              ) : hasError ? (
                <>
                  <ShieldAlert />
                  <span>Auth Error</span>
                </>
              ) : (
                <>
                  <ShieldAlert />
                  <span>Missing</span>
                </>
              )}
            </Badge>
          </div>

          <div className="border-hairline bg-surface-subtle flex flex-col gap-1 rounded-md border px-2.5 py-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Key</span>
              <span className="text-foreground font-mono">{status.maskedKey || "Not set"}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Endpoint</span>
              <span className="text-foreground/85 truncate font-mono">{status.apiBase}</span>
            </div>
            {status.account && (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Account</span>
                  <span className="text-foreground truncate">
                    {status.account.email || status.account.name}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Credits</span>
                  <span className="text-primary-text font-semibold tabular-nums">
                    {status.account.credit_balance?.toLocaleString() ?? "Unavailable"}
                  </span>
                </div>
              </>
            )}
          </div>

          {(localError || status.error) && (
            <p role="alert" className="bg-warn-bg/80 text-warn-text rounded px-2 py-1.5 text-xs">
              {localError || status.error}
            </p>
          )}

          <div className="border-hairline flex flex-col gap-1.5 border-t pt-2">
            <label className="text-muted-foreground text-xs font-medium" htmlFor={apiKeyId}>
              Manual Key Override (optional — overrides env automatically)
            </label>
            <Input
              id={apiKeyId}
              type="password"
              size="sm"
              autoComplete="off"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder={
                status.configured ? "Paste key to replace active…" : `Paste ${serviceName} key`
              }
            />
            {!direct && (
              <>
                <label
                  className="text-muted-foreground text-xs font-medium"
                  htmlFor={`${apiKeyId}-base`}
                >
                  API endpoint (optional)
                </label>
                <Input
                  id={`${apiKeyId}-base`}
                  size="sm"
                  value={apiBaseInput}
                  onChange={(e) => setApiBaseInput(e.target.value)}
                  placeholder={status.apiBase || "https://api.genvoice.pro/v1"}
                />
              </>
            )}
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <Button type="button" size="sm" disabled={isBusy} onClick={() => void handleSave()}>
                {busyAction === "config" ? "Saving…" : "Save Override"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={isBusy}
                onClick={() => void testPlaygroundConnection(connection)}
              >
                <RefreshCw
                  className={cn(
                    "size-3",
                    busyAction === "status-test" && "animate-spin motion-reduce:animate-none",
                  )}
                />
                <span>Verify</span>
              </Button>
              {status.hasOverride && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={isBusy}
                  onClick={() => void handleClearOverride()}
                >
                  <RotateCcw className="size-3" />
                  <span>Use Env</span>
                </Button>
              )}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
