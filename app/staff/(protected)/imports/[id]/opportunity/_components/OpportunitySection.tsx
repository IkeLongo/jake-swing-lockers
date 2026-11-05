"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IconArrowLeft, IconCheck, IconPlus } from "@tabler/icons-react";
import {
  applyDateChange,
  buildNamingDraft,
  buildNewOpportunityBody,
  canContinueFromOpportunity,
  formatOpportunityMeta,
  getContinueHint,
  getOpportunityChoiceBody,
  isNameCustomized,
  requiresNamingSave,
  isSameChoice,
  resetToSuggested,
  validateNamingDraft,
  type NamingDraft,
  type OpportunityChoice,
  type OpportunityNamingInfo,
  type OpportunityResolutionResponse,
} from "@/lib/imports/opportunity-page";

type LoadedData = OpportunityResolutionResponse & OpportunityNamingInfo;

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
  const [data, setData] = useState<LoadedData | null>(null);
  const [draft, setDraft] = useState<NamingDraft>({ name: "", date: "" });
  // "Create New" chosen but not yet saved (needed while the fitting date is unknown).
  const [pendingNew, setPendingNew] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const endpoint = `/api/staff/imports/${batchId}/opportunity-resolution`;

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      const body = (await response.json()) as
        | (LoadedData & {
            contactDecision?: "existing" | "new" | null;
          })
        | { error: string; code?: string };
      if (
        !response.ok &&
        "code" in body &&
        body.code === "ghl_approval_required"
      ) {
        router.replace(`/staff/imports/${batchId}/customer`);
        return;
      }
      if (!response.ok || !("state" in body)) {
        setLoadError(
          "error" in body ? body.error : "Could not load opportunities.",
        );
        return;
      }
      setData(body);
      setDraft(buildNamingDraft(body));
      setPendingNew(false);
    } catch {
      setLoadError("Could not load opportunities. Please try again.");
    }
  }, [endpoint, router, batchId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function put(requestBody: Record<string, unknown>): Promise<boolean> {
    setSaving(true);
    setSaveError(null);
    try {
      const response = await fetch(endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      const body = (await response.json()) as
        | { success: true; state: OpportunityResolutionResponse["state"] }
        | { error: string; code?: string };
      if (!response.ok || !("success" in body)) {
        if ("code" in body && body.code === "ghl_approval_required") {
          router.replace(`/staff/imports/${batchId}/customer`);
          return false;
        }
        setSaveError(
          "error" in body ? body.error : "Could not save your selection.",
        );
        return false;
      }
      return true;
    } catch {
      setSaveError("Could not save your selection. Please try again.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function choose(choice: OpportunityChoice) {
    if (!data || saving || !data.canModify) return;
    if (choice.resolution === "new") {
      // Only reveals the naming form; persisted by "Save and Continue".
      setSaveError(null);
      setPendingNew(true);
      return;
    }
    setPendingNew(false);
    if (isSameChoice(data.state, choice)) return;
    if (await put(getOpportunityChoiceBody(choice))) await load();
  }

  async function saveAndContinue() {
    if (!data || saving) return;
    const error = validateNamingDraft(draft, data.fittingDateSource);
    if (error) {
      setSaveError(error);
      return;
    }
    if (await put(buildNewOpportunityBody(draft, data.fittingDateSource))) {
      router.push(`/staff/imports/${batchId}/confirm`);
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
  const isNew = state.opportunityResolution === "new" || pendingNew;
  const needsSave = requiresNamingSave(isNew, draft, data);
  // Unsaved or edited new-opportunity details can only proceed via save.
  const canContinue = canContinueFromOpportunity(data) && !needsSave;
  const hint = isNew ? null : getContinueHint(data);
  const noExisting = opportunities.length === 0;
  const fromTrackman = data.fittingDateSource === "trackman";
  const customized = isNameCustomized(draft, data.customerName);
  const inputClass =
    "mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground font-body disabled:opacity-60";

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
            A new GHL contact will be created for this customer, so there are
            no existing opportunities to choose from. Create a new one below.
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
                !pendingNew &&
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

        {isNew && (
          <div className="mt-3 space-y-3 rounded-xl border border-border bg-card px-4 py-3">
            <div>
              <span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground font-subheading">
                Fitting date
              </span>
              {fromTrackman ? (
                <p className="mt-1 text-sm text-foreground font-body">
                  {new Date(`${draft.date}T00:00:00Z`).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                    timeZone: "UTC",
                  })}
                  <span className="ml-2 text-xs text-muted-foreground">
                    from the TrackMan file
                  </span>
                </p>
              ) : (
                <>
                  <input
                    type="date"
                    aria-label="Fitting date"
                    required
                    value={draft.date}
                    disabled={saving || !data.canModify}
                    onChange={(event) =>
                      setDraft(
                        applyDateChange(draft, data.customerName, event.target.value),
                      )
                    }
                    className={inputClass}
                  />
                  <p className="mt-1 text-xs text-muted-foreground font-body">
                    The TrackMan file has no fitting date. Enter it to continue.
                  </p>
                </>
              )}
            </div>
            <div>
              <label
                htmlFor="opportunity-name"
                className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground font-subheading"
              >
                Opportunity name
              </label>
              <input
                id="opportunity-name"
                type="text"
                maxLength={255}
                value={draft.name}
                disabled={saving || !data.canModify}
                onChange={(event) =>
                  setDraft({ ...draft, name: event.target.value })
                }
                className={inputClass}
              />
              <div className="mt-2 flex items-center gap-3">
                <button
                  type="button"
                  disabled={saving || !data.canModify || !customized}
                  onClick={() =>
                    setDraft(resetToSuggested(draft, data.customerName))
                  }
                  className="rounded-lg border border-border px-3 py-1.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 font-subheading"
                >
                  Reset to suggested
                </button>
              </div>
            </div>
          </div>
        )}
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
            disabled={saving || (needsSave ? !data.canModify : !canContinue)}
            onClick={() =>
              needsSave
                ? void saveAndContinue()
                : router.push(`/staff/imports/${batchId}/confirm`)
            }
            className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50 font-subheading"
          >
            {isNew ? "Save and Continue →" : "Continue →"}
          </button>
        </div>
      </div>
    </div>
  );
}
