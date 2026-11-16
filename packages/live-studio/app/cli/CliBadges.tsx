import {
  CheckCircle2,
  Clock,
  Coins,
  Download,
  Eye,
  FolderGit2,
  KeyRound,
  Pencil,
  Server,
  ShieldAlert,
  Square,
  TriangleAlert,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";

import type { CliEnvKey, CliMeta } from "../../src/cli-catalog.ts";
import { getCostLabel, getEffectLabel, getSpeedLabel } from "./model";

export function CliHazardBadges({
  meta,
  missingEnvGroups,
  compact = false,
}: {
  meta: CliMeta;
  missingEnvGroups?: readonly (readonly CliEnvKey[])[];
  compact?: boolean;
}) {
  const hasMissing = Boolean(missingEnvGroups?.length);
  const showGuarded = Boolean(meta.guard?.disabled);
  const showPaid = meta.cost !== "free";
  const showEffect = meta.effect !== "read";
  const showSpeed = meta.speed === "long";

  if (!showGuarded && !showPaid && !showEffect && !showSpeed && !hasMissing) {
    return compact ? null : (
      <Badge variant="tag">
        <Eye aria-hidden />
        Read
      </Badge>
    );
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      {showGuarded && (
        <Badge variant="claim">
          <ShieldAlert aria-hidden />
          Guarded
        </Badge>
      )}
      {showPaid && (
        <Badge variant="check">
          <Coins aria-hidden />
          {meta.cost === "paid" ? "Paid" : "Optional $"}
        </Badge>
      )}
      {hasMissing && (
        <Badge variant="destructive">
          <KeyRound aria-hidden />
          Missing key
        </Badge>
      )}
      {meta.effect === "destructive" && (
        <Badge variant="destructive">
          <TriangleAlert aria-hidden />
          Destructive
        </Badge>
      )}
      {meta.effect === "install" && (
        <Badge variant="open">
          <Download aria-hidden />
          Install
        </Badge>
      )}
      {meta.effect === "write" && (
        <Badge variant="tag">
          <Pencil aria-hidden />
          Writes
        </Badge>
      )}
      {meta.effect === "daemon" && !showGuarded && (
        <Badge variant="open">
          <Server aria-hidden />
          Server
        </Badge>
      )}
      {showSpeed && (
        <Badge variant="tag">
          <Clock aria-hidden />
          Slow
        </Badge>
      )}
    </div>
  );
}

function getCancelBadge(meta: CliMeta): { variant: "tag" | "claim"; label: string } {
  if (meta.cancellable) return { variant: "tag", label: "Stoppable" };
  if (meta.effect === "read") return { variant: "tag", label: "Finishes cleanly" };
  if (meta.effect === "daemon") return { variant: "tag", label: "Server · Stop closes" };
  return { variant: "claim", label: "Kills process · side effects persist" };
}

export function CliBehaviorStrip({
  meta,
  targetLabel,
  missingEnvGroups,
  compact = false,
}: {
  meta: CliMeta;
  targetLabel: string;
  missingEnvGroups: readonly (readonly CliEnvKey[])[];
  compact?: boolean;
}) {
  const effectIcon =
    meta.effect === "destructive" ? (
      <TriangleAlert aria-hidden />
    ) : meta.effect === "install" ? (
      <Download aria-hidden />
    ) : meta.effect === "write" ? (
      <Pencil aria-hidden />
    ) : meta.effect === "daemon" ? (
      <Server aria-hidden />
    ) : (
      <Eye aria-hidden />
    );

  const effectVariant =
    meta.effect === "destructive"
      ? "destructive"
      : meta.effect === "install"
        ? "open"
        : meta.effect === "write"
          ? "check"
          : "tag";

  const costVariant = meta.cost === "free" ? "done" : "check";

  const costBadgeText =
    meta.cost === "free"
      ? "Free local"
      : meta.costHint && meta.costHint.length <= 28
        ? getCostLabel(meta)
        : meta.cost === "paid"
          ? "Paid API"
          : "Optional paid";
  const showCostDetail = Boolean(meta.costHint && meta.costHint.length > 28);
  const cancelBadge = getCancelBadge(meta);

  return (
    <div
      aria-label="Command behavior and safety indicators"
      className={`bg-card border-hairline flex min-w-0 flex-col border ${
        compact ? "gap-1 rounded-lg p-1.5" : "gap-1.5 rounded-xl p-2"
      }`}
    >
      <div className={`flex min-w-0 flex-wrap items-center ${compact ? "gap-1" : "gap-1.5"}`}>
        <Badge variant={effectVariant}>
          {effectIcon}
          {getEffectLabel(meta.effect)}
        </Badge>

        <Badge variant={costVariant} title={meta.costHint}>
          {meta.cost === "free" ? <CheckCircle2 aria-hidden /> : <Coins aria-hidden />}
          {costBadgeText}
        </Badge>

        <Badge variant={meta.speed === "long" ? "check" : "tag"}>
          <Clock aria-hidden />
          {getSpeedLabel(meta.speed)}
        </Badge>

        <Badge variant={cancelBadge.variant}>
          <Square aria-hidden />
          {cancelBadge.label}
        </Badge>

        <Badge variant="tag" title={targetLabel} className="max-w-full min-w-0">
          <FolderGit2 aria-hidden className="shrink-0" />
          <span className="min-w-0 truncate">{targetLabel}</span>
        </Badge>

        {missingEnvGroups.length > 0 && (
          <Badge variant="destructive">
            <KeyRound aria-hidden />
            Need {missingEnvGroups.map((g) => g.join(" or ")).join(" + ")}
          </Badge>
        )}
      </div>

      {showCostDetail && (
        <p
          title={meta.costHint}
          className={`text-tag text-muted-foreground min-w-0 ${
            compact ? "truncate leading-tight" : "leading-snug"
          }`}
        >
          {meta.costHint}
        </p>
      )}
    </div>
  );
}
