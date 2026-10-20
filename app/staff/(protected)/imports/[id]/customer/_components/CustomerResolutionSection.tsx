"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { IconCheck, IconUserPlus, IconUserSearch } from "@tabler/icons-react";
import { ClientPicker } from "@/app/staff/_components/ClientPicker";
import type { ClientPickerValue } from "@/app/staff/_components/ClientPicker";
import type { ClientSearchResult } from "@/app/api/staff/clients/search/route";
import type { CustomerMatchResult } from "@/lib/queries/customer-match";
import type { CustomerResolutionState } from "@/lib/imports/customer-resolution";
import { getNewCustomerFormValues } from "@/lib/imports/customer-resolution-form";
import { hasPersistedCustomerResolution } from "@/lib/imports/customer-workflow-routing";

interface Props {
  batchId: number;
  trackmanPlayerName: string | null;
  trackmanPlayerEmail: string | null;
  initialState: CustomerResolutionState;
  initialSelectedCustomer: ClientSearchResult | null;
}

interface SaveResponse {
  success: true;
  state: CustomerResolutionState;
}

function getInitialChoice(
  state: CustomerResolutionState,
  trackmanPlayerName: string | null,
  trackmanPlayerEmail: string | null,
): ClientPickerValue | null {
  if (state.customerResolution === "existing" && state.selectedGolfClientId) {
    return { mode: "existing", clientId: state.selectedGolfClientId };
  }
  if (state.customerResolution === "new") {
    return {
      mode: "new",
      ...getNewCustomerFormValues(state, trackmanPlayerName, trackmanPlayerEmail),
    };
  }
  return null;
}

function customerName(customer: ClientSearchResult): string {
  return (
    [customer.firstName, customer.lastName].filter(Boolean).join(" ") ||
    `Customer #${customer.id}`
  );
}

export function CustomerResolutionSection({
  batchId,
  trackmanPlayerName,
  trackmanPlayerEmail,
  initialState,
  initialSelectedCustomer,
}: Props) {
  const router = useRouter();
  const [match, setMatch] = useState<CustomerMatchResult | null>(null);
  const [matchError, setMatchError] = useState<string | null>(null);
  const [choice, setChoice] = useState<ClientPickerValue | null>(() =>
    getInitialChoice(initialState, trackmanPlayerName, trackmanPlayerEmail),
  );
  const [selectedCustomer, setSelectedCustomer] =
    useState<ClientSearchResult | null>(initialSelectedCustomer);
  const [showPicker, setShowPicker] = useState(
    initialState.customerResolution === "new",
  );
  const [persisted, setPersisted] = useState(
    hasPersistedCustomerResolution(initialState),
  );
  const initialResolutionValid = hasPersistedCustomerResolution(initialState);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const newCustomerDefaults = getNewCustomerFormValues(
    initialState,
    trackmanPlayerName,
    trackmanPlayerEmail,
  );

  useEffect(() => {
    if (initialResolutionValid) return;

    let cancelled = false;

    async function loadMatch() {
      try {
        const response = await fetch(
          `/api/staff/imports/${batchId}/customer-match`,
        );
        const data = (await response.json()) as
          | { success: true; result: CustomerMatchResult }
          | { error: string };
        if (cancelled) return;
        if (!response.ok || !("success" in data)) {
          setMatchError("error" in data ? data.error : "Could not load customer matches.");
          return;
        }
        setMatch(data.result);
      } catch {
        if (!cancelled) {
          setMatchError("Could not load customer matches. Please try again.");
        }
      }
    }

    loadMatch();
    return () => {
      cancelled = true;
    };
  }, [batchId, initialResolutionValid]);

  async function selectExisting(customer: ClientSearchResult) {
    if (saving) return;
    const next: ClientPickerValue = { mode: "existing", clientId: customer.id };
    setChoice(next);
    setSelectedCustomer(customer);
    setShowPicker(false);
    setPersisted(false);
    setSaveError(null);
    const ok = await saveChoice(next);
    if (!ok) {
      setChoice(null);
      setSelectedCustomer(null);
    }
  }

  function handlePickerChange(value: ClientPickerValue | null) {
    setChoice(value);
    if (value !== null) {
      setPersisted(false);
      setSaveError(null);
    } else {
      setSelectedCustomer(null);
    }
  }

  function isValidChoice(value: ClientPickerValue | null): boolean {
    if (value?.mode === "existing") {
      return Number.isSafeInteger(value.clientId) && value.clientId > 0;
    }
    if (value?.mode === "new") {
      return Boolean(
        value.firstName.trim() ||
          value.lastName.trim() ||
          value.email.trim() ||
          value.phone.trim(),
      );
    }
    return false;
  }

  function hasValidChoice(): boolean {
    return isValidChoice(choice);
  }

  async function saveChoice(target: ClientPickerValue | null = choice): Promise<boolean> {
    if (!target || !isValidChoice(target) || saving) return false;
    setSaving(true);
    setSaveError(null);

    const body =
      target.mode === "existing"
        ? { resolution: "existing", selectedGolfClientId: target.clientId }
        : {
            resolution: "new",
            proposedFirstName: target.firstName,
            proposedLastName: target.lastName,
            proposedEmail: target.email,
            proposedPhone: target.phone,
          };

    try {
      const response = await fetch(
        `/api/staff/imports/${batchId}/customer-resolution`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const data = (await response.json()) as SaveResponse | { error: string };
      if (!response.ok || !("success" in data)) {
        setSaveError("error" in data ? data.error : "Could not save customer selection.");
        return false;
      }

      const state = data.state;
      if (state.customerResolution === "existing" && state.selectedGolfClientId) {
        setChoice({
          mode: "existing",
          clientId: state.selectedGolfClientId,
        });
        setShowPicker(false);
      } else if (state.customerResolution === "new") {
        setChoice({
          mode: "new",
          firstName: state.proposedFirstName ?? "",
          lastName: state.proposedLastName ?? "",
          email: state.proposedEmail ?? "",
          phone: state.proposedPhone ?? "",
        });
      }
      setPersisted(true);
      router.refresh();
      return true;
    } catch {
      setSaveError("Network error while saving. Please try again.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  const showSuggestions = !choice && !showPicker;
  const showExistingSummary = choice?.mode === "existing" && !showPicker;

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border bg-card p-5 shadow-xs sm:p-6">
        {saveError && (
          <p className="mb-4 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-foreground font-body">
            {saveError}
          </p>
        )}

        {matchError && showSuggestions && (
          <p className="mb-4 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-foreground font-body">
            {matchError}
          </p>
        )}

        {showSuggestions && match === null && !matchError && (
          <p className="text-sm text-muted-foreground font-body">
            Looking for a matching customer…
          </p>
        )}

        {showSuggestions && match?.status === "matched" && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground font-subheading">
              Suggested customer
            </p>
            <p className="mt-3 text-lg font-semibold text-foreground font-heading">
              {customerName(match.customer)}
            </p>
            <p className="text-sm text-muted-foreground font-body">
              {[match.customer.email, match.customer.phone].filter(Boolean).join(" · ")}
            </p>
            <p className="mt-2 text-sm text-muted-foreground font-body">
              We found a customer with the same email address.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={() => selectExisting(match.customer)}
                disabled={saving}
                className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50 font-subheading"
              >
                Use {customerName(match.customer)}
              </button>
              <button
                type="button"
                onClick={() => setShowPicker(true)}
                disabled={saving}
                className="text-sm font-medium text-muted-foreground hover:text-foreground font-subheading"
              >
                Choose someone else
              </button>
            </div>
          </div>
        )}

        {showSuggestions && match?.status === "ambiguous" && (
          <div>
            <p className="text-sm font-semibold text-foreground font-subheading">
              Multiple customers share this email
            </p>
            <p className="mt-1 text-sm text-muted-foreground font-body">
              Select the correct customer.
            </p>
            <ul className="mt-3 divide-y divide-border border-y border-border">
              {match.customers.map((customer) => (
                <li key={customer.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground font-body">
                      {customerName(customer)}
                    </p>
                    <p className="truncate text-xs text-muted-foreground font-body">
                      {[customer.email, customer.phone].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => selectExisting(customer)}
                    disabled={saving}
                    className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50 font-subheading"
                  >
                    Select
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setShowPicker(true)}
              className="mt-3 text-sm font-medium text-muted-foreground hover:text-foreground font-subheading"
            >
              Choose someone else
            </button>
          </div>
        )}

        {showSuggestions &&
          (match?.status === "no-match" || match?.status === "no-email" || matchError) && (
            <div>
              <p className="text-sm font-semibold text-foreground font-subheading">
                {match?.status === "no-email"
                  ? "No email on this fitting"
                  : match?.status === "no-match"
                    ? "No customer found for this email"
                    : "Choose a customer"}
              </p>
              <div className="mt-3 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => setShowPicker(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted font-subheading"
                >
                  <IconUserSearch className="h-4 w-4" />
                  Search existing customer
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setChoice({ mode: "new", ...newCustomerDefaults });
                    setPersisted(false);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted font-subheading"
                >
                  <IconUserPlus className="h-4 w-4" />
                  Add new customer
                </button>
              </div>
            </div>
          )}

        {showExistingSummary && choice?.mode === "existing" && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground font-subheading">
              Selected customer
            </p>
            <p className="mt-3 flex items-center gap-2 text-lg font-semibold text-foreground font-heading">
              {persisted && <IconCheck className="h-5 w-5 text-primary" />}
              {selectedCustomer ? customerName(selectedCustomer) : `Customer #${choice.clientId}`}
            </p>
            {selectedCustomer && (
              <p className="text-sm text-muted-foreground font-body">
                {[selectedCustomer.email, selectedCustomer.phone].filter(Boolean).join(" · ")}
              </p>
            )}
            {saving && (
              <p className="mt-2 text-sm text-muted-foreground font-body">Saving…</p>
            )}
            <button
              type="button"
              onClick={() => {
                setShowPicker(true);
                setChoice(null);
                setSelectedCustomer(null);
                setPersisted(false);
                setSaveError(null);
              }}
              disabled={saving}
              className="mt-3 text-sm font-medium text-primary hover:text-primary-hover disabled:opacity-50 font-subheading"
            >
              Change customer
            </button>
          </div>
        )}

        {(showPicker || choice?.mode === "new") && (
          <div>
            <ClientPicker
              key={`${batchId}-${initialState.customerResolution ?? "unresolved"}-${showPicker ? "editing" : "saved"}-${choice?.mode === "new" ? "new" : "other"}`}
              onChange={handlePickerChange}
              onSelectExisting={setSelectedCustomer}
              initialMode={choice?.mode === "new" ? "new" : "search"}
              initialNewCustomer={newCustomerDefaults}
              disabled={saving}
            />
            {choice?.mode === "new" && persisted && (
              <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-primary font-body">
                <IconCheck className="h-3.5 w-3.5" />
                New customer details saved
              </p>
            )}
            {choice && !persisted && (
              <button
                type="button"
                onClick={() => saveChoice()}
                disabled={!hasValidChoice() || saving}
                className="mt-4 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50 font-subheading"
              >
                {saving ? "Saving…" : "Save customer"}
              </button>
            )}
          </div>
        )}
      </section>

      {choice && persisted && (
        <button
          type="button"
          onClick={() => router.push(`/staff/imports/${batchId}/map`)}
          className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover font-subheading"
        >
          Continue →
        </button>
      )}
    </div>
  );
}
