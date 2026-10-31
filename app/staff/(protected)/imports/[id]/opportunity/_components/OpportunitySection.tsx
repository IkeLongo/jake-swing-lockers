"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IconArrowLeft, IconCheck, IconPlus } from "@tabler/icons-react";
import {
  canContinueFromOpportunity,
  formatOpportunityMeta,
  getContinueHint,
  getOpportunityChoiceBody,
  isSameChoice,
  type OpportunityChoice,
  type OpportunityResolutionResponse,
} from "@/lib/imports/opportunity-page";

interface Props {
  batchId: number;
}

const cardBase =
  "flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60";

function cardClass(selected: boolean) {
  return `${cardBase} ${
    selected
      ? "border-primary bg-primary/10"
      : "border-border bg-card hover:bg-muted"
  }`;
}

function Radio({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden
      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
        selected
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border"
      }`}
    >
      {selected && <IconCheck className="h-3.5 w-3.5" />}
    </span>
  );
}

export function OpportunitySection({ batchId }: Props) {
  const router = useRouter();
  const [data, setData] = useState<OpportunityResolutionResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const endpoint = `/api/staff/imports/${batchId}/opportunity-resolution`;

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      const body = (await response.json()) as
        | OpportunityResolutionResponse
        | { error: string };
      if (!response.ok || !("state" in body)) {
        setLoadError(
          "error" in body ? body.error : "Could not load opportunities.",
        );
        return;
      }
      setData(body);
    } catch {
      setLoadError("Could not load opportunities. Please try again.");
    }
  }, [endpoint]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function choose(choice: OpportunityChoice) {
    if (!data || saving || !data.canModify || isSameChoice(data.state, choice)) {
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const response = await fetch(endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(getOpportunityChoiceBody(choice)),
      });
      const body = (await response.json()) as
        | { success: true; state: OpportunityResolutionResponse["state"] }
        | { error: string };
      if (!response.ok || !("success" in body)) {
        setSaveError(
          "error" in body ? body.error : "Could not save your selection.",
        );
        return;
      }
      setData({ ...data, state: body.state });
    } catch {
      setSaveError("Could not save your selection. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <div className="space-y-4">
        <p className="rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-foreground font-body">
          {loadError}
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-lg border border-border px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted font-subheading"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <p className="text-sm text-muted-foreground font-body">
        Loading opportunities…
      </p>
    );
  }

  const { state, opportunities } = data;
  const isNew = state.opportunityResolution === "new";
  const canContinue = canContinueFromOpportunity(data);
  const hint = getContinueHint(data);
  const noExisting = opportunities.length === 0;

  return (
    <div className="space-y-4">
      {saveError && (
        <p className="rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-foreground font-body">
          {saveError}
        </p>
      )}

      <section aria-labelledby="existing-opportunities">
        <h2
          id="existing-opportunities"
          className="text-xs font-semibold uppercase tracking-wide text-muted-foreground font-subheading"
        >
          Existing Opportunities
        </h2>
        {!data.canSelectExisting ? (
          <p className="mt-2 text-sm text-muted-foreground font-body">
            This customer has no existing opportunities yet. Create a new one
            below.
          </p>
        ) : noExisting ? (
          <p className="mt-2 text-sm text-muted-foreground font-body">
            No open opportunities found for this customer. Create a new one
            below.
          </p>
        ) : (
          <ul className="mt-2 space-y-2" role="radiogroup">
            {opportunities.map((opportunity) => {
              const selected =
                state.opportunityResolution === "existing" &&
                state.selectedGhlOpportunityId === opportunity.id;
              return (
                <li key={opportunity.id}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={saving || !data.canModify}
                    onClick={() =>
                      void choose({
                        resolution: "existing",
                        selectedGhlOpportunityId: opportunity.id,
                      })
                    }
                    className={cardClass(selected)}
                  >
                    <Radio selected={selected} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-foreground font-body">
                        {opportunity.name || "Untitled opportunity"}
                      </span>
                      <span className="mt-0.5 block text-xs capitalize text-muted-foreground font-body">
                        {formatOpportunityMeta(opportunity)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section
        aria-labelledby="new-opportunity"
        className="border-t border-border pt-4"
      >
        <h2
          id="new-opportunity"
          className="text-xs font-semibold uppercase tracking-wide text-muted-foreground font-subheading"
        >
          Or start fresh
        </h2>
        <button
          type="button"
          role="radio"
          aria-checked={isNew}
          disabled={saving || !data.canModify}
          onClick={() => void choose({ resolution: "new" })}
          className={`mt-2 ${cardClass(isNew)} ${
            !isNew && noExisting ? "border-primary/60" : ""
          }`}
        >
          <Radio selected={isNew} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground font-body">
              <IconPlus className="h-4 w-4" />
              Create New Opportunity
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground font-body">
              Starts a new sales pursuit for this customer. It is created when
              the fitting is finalized.
            </span>
          </span>
        </button>
      </section>

      {saving && (
        <p className="text-sm text-muted-foreground font-body">Saving…</p>
      )}

      <div className="border-t border-border pt-3">
        {hint && (
          <p className="mb-2 text-sm text-muted-foreground font-body">{hint}</p>
        )}
        <div className="flex items-center justify-between gap-3">
          <Link
            href={`/staff/imports/${batchId}/map`}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground font-subheading"
          >
            <IconArrowLeft className="h-4 w-4" />
            Back to Review Fitting
          </Link>
          <button
            type="button"
            disabled={!canContinue || saving}
            onClick={() => router.push(`/staff/imports/${batchId}/confirm`)}
            className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50 font-subheading"
          >
            Continue →
          </button>
        </div>
      </div>
    </div>
  );
}
