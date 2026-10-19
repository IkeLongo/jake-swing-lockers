"use client";

import { useEffect, useState } from "react";
import { IconCheck, IconUserSearch } from "@tabler/icons-react";
import { ClientPicker } from "@/app/staff/_components/ClientPicker";
import type { ClientSearchResult } from "@/app/api/staff/clients/search/route";
import type { CustomerMatchResult } from "@/lib/queries/customer-match";

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  batchId: number;
}

// ── Component ─────────────────────────────────────────────────────────────────
//
// Suggests an existing GolfClient from the TrackMan player email, or lets
// staff manually pick one. Selection lives in component state only — it is
// never persisted to ImportBatch, and no GolfClient/DemoSession is created
// here. A page refresh intentionally resets the selection during this phase.

export function CustomerResolutionSection({ batchId }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [match, setMatch] = useState<CustomerMatchResult | null>(null);

  // Staff's confirmed choice — UI state only, never sent anywhere in this phase.
  const [selected, setSelected] = useState<ClientSearchResult | null>(null);
  const [choosing, setChoosing] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/staff/imports/${batchId}/customer-match`);
        const data = (await res.json()) as
          | { success: true; result: CustomerMatchResult }
          | { error: string };
        if (cancelled) return;
        if (!res.ok || !("success" in data)) {
          setError("error" in data ? data.error : "Unexpected error.");
          return;
        }
        setMatch(data.result);
      } catch {
        if (!cancelled) setError("Network error. Please try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [batchId]);

  const contactLine = (c: ClientSearchResult) => {
    const name = [c.firstName, c.lastName].filter(Boolean).join(" ") || `Client #${c.id}`;
    return { name, email: c.email, phone: c.phone };
  };

  return (
    <section className="mb-4 rounded-xl border border-border bg-card px-5 py-4 shadow-xs">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground font-subheading">
        Customer
      </p>

      {loading && (
        <p className="mt-2 text-sm text-muted-foreground font-body">
          Looking for a matching customer…
        </p>
      )}

      {error && (
        <p className="mt-2 text-sm text-red-600 dark:text-red-400 font-body">{error}</p>
      )}

      {/* ── State D — staff has confirmed a customer ─────────────────────────── */}
      {!loading && !error && selected && (
        <div className="mt-2 space-y-1 text-sm font-body">
          <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
            <IconCheck className="h-3.5 w-3.5" />
            Customer selected
          </p>
          <p className="text-base font-semibold text-foreground">
            {contactLine(selected).name}
          </p>
          {contactLine(selected).email && (
            <p className="text-muted-foreground">{contactLine(selected).email}</p>
          )}
          {contactLine(selected).phone && (
            <p className="text-muted-foreground">{contactLine(selected).phone}</p>
          )}
          <button
            type="button"
            onClick={() => {
              setSelected(null);
              setChoosing(false);
            }}
            className="mt-2 text-xs font-medium text-primary hover:text-primary-hover font-subheading"
          >
            Change customer
          </button>
        </div>
      )}

      {/* ── No confirmed selection yet ────────────────────────────────────────── */}
      {!loading && !error && !selected && match && (
        <div className="mt-2 space-y-3">
          {/* State A — exact single match, awaiting explicit confirmation */}
          {match.status === "matched" && !choosing && (
            <div className="space-y-2 text-sm font-body">
              <p className="text-xs font-medium text-accent">Existing customer found</p>
              <p className="text-base font-semibold text-foreground">
                {contactLine(match.customer).name}
              </p>
              {match.customer.email && (
                <p className="text-muted-foreground">{match.customer.email}</p>
              )}
              {match.customer.phone && (
                <p className="text-muted-foreground">{match.customer.phone}</p>
              )}
              <p className="text-xs text-muted-foreground/80">Matched by email</p>
              <div className="flex flex-wrap gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setSelected(match.customer)}
                  className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-primary-hover font-subheading"
                >
                  Use this customer
                </button>
                <button
                  type="button"
                  onClick={() => setChoosing(true)}
                  className="text-xs font-medium text-muted-foreground hover:text-foreground font-subheading"
                >
                  Choose a different customer
                </button>
              </div>
            </div>
          )}

          {/* State C — ambiguous match, staff must pick manually */}
          {match.status === "ambiguous" && !choosing && (
            <div className="space-y-2 text-sm font-body">
              <p className="text-xs font-medium text-accent">
                Multiple customers use this email
              </p>
              <p className="text-muted-foreground">
                Staff must select the correct customer.
              </p>
              <button
                type="button"
                onClick={() => setChoosing(true)}
                className="mt-1 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted font-subheading"
              >
                <IconUserSearch className="h-3.5 w-3.5" />
                Select customer
              </button>
            </div>
          )}

          {/* State B — no deterministic match */}
          {(match.status === "no-match" || match.status === "no-email") && !choosing && (
            <div className="space-y-2 text-sm font-body">
              <p className="text-xs font-medium text-accent">No existing customer found</p>
              <p className="text-muted-foreground">
                {match.status === "no-email"
                  ? "This TrackMan session did not report a player email to match against."
                  : "No customer matched the TrackMan email for this session."}
              </p>
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setChoosing(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted font-subheading"
                >
                  <IconUserSearch className="h-3.5 w-3.5" />
                  Choose existing customer
                </button>
                <button
                  type="button"
                  disabled
                  title="Coming soon — will let staff prepare a new customer record before finalizing."
                  className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground/60 cursor-not-allowed font-subheading"
                >
                  New customer
                </button>
              </div>
            </div>
          )}

          {/* Manual picker — reused for "choose different", ambiguous, and no-match */}
          {choosing && (
            <div className="space-y-2">
              <ClientPicker
                allowNew={false}
                onChange={() => {}}
                onSelectExisting={(c) => {
                  if (c) setSelected(c);
                }}
              />
              <button
                type="button"
                onClick={() => setChoosing(false)}
                className="text-xs font-medium text-muted-foreground hover:text-foreground font-subheading"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      <p className="mt-3 text-[11px] text-muted-foreground/70 font-body">
        This selection is not saved yet — it only sets the customer identity
        for the confirmation workflow to come.
      </p>
    </section>
  );
}
