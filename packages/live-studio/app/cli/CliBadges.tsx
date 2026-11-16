import {
  Clock,
  Coins,
  Download,
  Eye,
  KeyRound,
  Pencil,
  Server,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";

import type { CliEnvKey, CliMeta } from "../../src/cli-catalog.ts";
import { getEffectLabel, getSpeedLabel } from "./model";

const effectTones: Record<CliMeta["effect"], string> = {
  read: "text-ok-text",
  write: "text-warn-text",
  install: "text-warn-text",
  destructive: "text-destructive",
  daemon: "text-foreground",
};

export function CliAccessLabel({ effect }: { effect: CliMeta["effect"] }) {
  return <span className={effectTones[effect]}>{getEffectLabel(effect)}</span>;
}

export function CliCostLabel({ cost }: { cost: CliMeta["cost"] }) {
  return (
    <span className={cost === "free" ? "text-ok-text" : "text-warn-text"}>
      {cost === "free" ? "Free local" : cost === "paid" ? "Paid API" : "Paid options"}
    </span>
  );
}

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
      <Badge appearance="text" size="comfortable" variant="tag">
        <Eye aria-hidden />
        Read
      </Badge>
    );
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      {showGuarded && (
        <Badge appearance="text" size="comfortable" variant="claim">
          <ShieldAlert aria-hidden />
          Guarded
        </Badge>
      )}
      {showPaid && (
        <Badge appearance="text" size="comfortable" variant="check">
          <Coins aria-hidden />
          {meta.cost === "paid" ? "Paid" : "Optional $"}
        </Badge>
      )}
      {hasMissing && (
        <Badge appearance="text" size="comfortable" variant="destructive">
          <KeyRound aria-hidden />
          Missing key
        </Badge>
      )}
      {meta.effect === "destructive" && (
        <Badge appearance="text" size="comfortable" variant="destructive">
          <TriangleAlert aria-hidden />
          Destructive
        </Badge>
      )}
      {meta.effect === "install" && (
        <Badge appearance="text" size="comfortable" variant="open">
          <Download aria-hidden />
          Install
        </Badge>
      )}
      {meta.effect === "write" && (
        <Badge appearance="text" size="comfortable" variant="tag">
          <Pencil aria-hidden />
          Writes
        </Badge>
      )}
      {meta.effect === "daemon" && !showGuarded && (
        <Badge appearance="text" size="comfortable" variant="open">
          <Server aria-hidden />
          Server
        </Badge>
      )}
      {showSpeed && (
        <Badge appearance="text" size="comfortable" variant="tag">
          <Clock aria-hidden />
          Slow
        </Badge>
      )}
    </div>
  );
}

export function CliBehaviorStrip({
  meta,
  targetLabel,
  missingEnvGroups,
}: {
  meta: CliMeta;
  targetLabel: string;
  missingEnvGroups: readonly (readonly CliEnvKey[])[];
}) {
  const writesFiles =
    meta.effect === "write" || meta.effect === "install" || meta.effect === "destructive";
  return (
    <section aria-label="Command details" className="border-hairline min-w-0 border-b pb-3">
      <dl className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-2 text-sm leading-normal">
        <div>
          <dt className="text-muted-foreground text-ui">Access</dt>
          <dd className="font-medium">
            <CliAccessLabel effect={meta.effect} />
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-ui">Cost</dt>
          <dd className="font-medium">
            <CliCostLabel cost={meta.cost} />
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-ui">Time</dt>
          <dd className="text-foreground">{getSpeedLabel(meta.speed)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-ui">When stopped</dt>
          <dd className="text-foreground">
            {meta.effect === "daemon" ? "Server closes" : "Process ends"}
          </dd>
        </div>
        <div className="col-span-2 min-w-0">
          <dt className="text-muted-foreground text-ui">Runs in</dt>
          <dd className="text-foreground font-mono break-words">{targetLabel}</dd>
        </div>
      </dl>
      {writesFiles && (
        <p className="text-muted-foreground mt-2 text-sm leading-normal">
          Stopping does not undo saved changes.
        </p>
      )}
      {meta.costHint && (
        <p className="text-muted-foreground mt-2 text-sm leading-normal" title={meta.costHint}>
          {meta.costHint}
        </p>
      )}
      {missingEnvGroups.length > 0 && (
        <p className="text-warn-text mt-2 text-sm leading-normal">
          Add {missingEnvGroups.map((group) => group.join(" or ")).join(" and ")} before running
          paid options.
        </p>
      )}
    </section>
  );
}
