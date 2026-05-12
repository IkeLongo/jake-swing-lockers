"use client";

import { useState, useRef, useCallback } from "react";
import type { ClientSearchResult } from "@/app/api/staff/clients/search/route";

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  batchId: number;
  alreadyConfirmed: boolean;
}

// ── Types ─────────────────────────────────────────────────────────────────────

type ConfirmMode = "search" | "new";

interface ConfirmResult {
  demoSessionId: number;
  golfClientId: number;
  clientName: string | null;
  lockerToken: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ClientAssignmentSection({ batchId, alreadyConfirmed }: Props) {
  // ── Mode ───────────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<ConfirmMode>("search");

  // ── Client search state ────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ClientSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedClient, setSelectedClient] = useState<ClientSearchResult | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── New client fields ──────────────────────────────────────────────────────
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  // ── Demo fields ────────────────────────────────────────────────────────────
  const [demoDate, setDemoDate] = useState("");
  const [notes, setNotes] = useState("");

  // ── Submission state ───────────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<ConfirmResult | null>(null);

  // ── Client search with debounce ────────────────────────────────────────────
  const handleSearchChange = useCallback((val: string) => {
    setSearchQuery(val);
    setSelectedClient(null);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (val.trim().length < 2) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(
          `/api/staff/clients/search?q=${encodeURIComponent(val.trim())}`,
        );
        if (res.ok) {
          const data = (await res.json()) as { clients: ClientSearchResult[] };
          setSearchResults(data.clients);
          setShowDropdown(true);
        }
      } finally {
        setSearching(false);
      }
    }, 300);
  }, []);

  const handleSelectClient = (c: ClientSearchResult) => {
    setSelectedClient(c);
    setSearchQuery(
      [c.firstName, c.lastName].filter(Boolean).join(" ") ||
        c.email ||
        c.phone ||
        `Client #${c.id}`,
    );
    setShowDropdown(false);
    setSearchResults([]);
  };

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    const body: Record<string, unknown> = { demoDate, notes: notes || undefined };

    if (mode === "search") {
      if (!selectedClient) {
        setSubmitError("Please select an existing client or switch to create a new one.");
        return;
      }
      body.existingGolfClientId = selectedClient.id;
    } else {
      body.firstName = firstName;
      body.lastName = lastName;
      body.email = email;
      body.phone = phone;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/staff/imports/${batchId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = (await res.json()) as
        | ({ success: true } & ConfirmResult)
        | { error: string };

      if (!res.ok || !("success" in data)) {
        setSubmitError("error" in data ? data.error : "Unexpected error.");
        return;
      }

      setResult({
        demoSessionId: data.demoSessionId,
        golfClientId: data.golfClientId,
        clientName: data.clientName,
        lockerToken: data.lockerToken,
      });
    } catch {
      setSubmitError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Already confirmed ──────────────────────────────────────────────────────
  if (alreadyConfirmed && !result) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-800 font-body">
        <p className="font-semibold font-heading">Demo session already confirmed</p>
        <p className="mt-1 text-xs text-emerald-700">
          This import has been linked to a demo session. No further action needed.
        </p>
      </div>
    );
  }

  // ── Success state ──────────────────────────────────────────────────────────
  if (result) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-5 font-body">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 text-emerald-600 text-lg leading-none">✓</span>
          <div>
            <p className="font-semibold font-heading text-emerald-800">
              Demo session created
            </p>
            <ul className="mt-2 space-y-1 text-xs text-emerald-700">
              {result.clientName && (
                <li>
                  <span className="font-medium">Client:</span> {result.clientName}
                </li>
              )}
              <li>
                <span className="font-medium">Demo Session ID:</span>{" "}
                {result.demoSessionId}
              </li>
              <li>
                <span className="font-medium">Client ID:</span> {result.golfClientId}
              </li>
            </ul>
            <p className="mt-3 text-xs text-emerald-600">
              Club data import and Swing Locker generation coming next.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Form ───────────────────────────────────────────────────────────────────
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-xs">
      {/* Header */}
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="text-base font-semibold text-slate-800 font-heading">
          Finalize Demo Session
        </h2>
        <p className="mt-0.5 text-xs text-slate-500 font-body">
          Assign a client and demo date to confirm this import.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="px-5 py-5 space-y-5">
        {/* Mode toggle */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => { setMode("search"); setSelectedClient(null); }}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors font-subheading ${
              mode === "search"
                ? "bg-slate-900 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            Find existing client
          </button>
          <button
            type="button"
            onClick={() => setMode("new")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors font-subheading ${
              mode === "new"
                ? "bg-slate-900 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            New client
          </button>
        </div>

        {/* ── Existing client search ───────────────────────────────────────── */}
        {mode === "search" && (
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-600 font-subheading">
              Search client
            </label>
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
                onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
                placeholder="Name, email, or phone…"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none font-body"
              />
              {searching && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">
                  Searching…
                </span>
              )}
              {showDropdown && searchResults.length > 0 && (
                <ul className="absolute z-20 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-md">
                  {searchResults.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onMouseDown={() => handleSelectClient(c)}
                        className="w-full px-3 py-2.5 text-left hover:bg-slate-50 text-sm font-body"
                      >
                        <span className="font-medium text-slate-800">
                          {[c.firstName, c.lastName].filter(Boolean).join(" ") ||
                            "(no name)"}
                        </span>
                        {(c.email || c.phone) && (
                          <span className="ml-2 text-xs text-slate-400">
                            {c.email ?? c.phone}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {showDropdown && searchResults.length === 0 && !searching && searchQuery.trim().length >= 2 && (
                <div className="absolute z-20 mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-400 shadow-md font-body">
                  No clients found — switch to &ldquo;New client&rdquo; to create one.
                </div>
              )}
            </div>
            {selectedClient && (
              <p className="text-xs text-emerald-700 font-body">
                ✓ Selected: {[selectedClient.firstName, selectedClient.lastName].filter(Boolean).join(" ") || `Client #${selectedClient.id}`}
                {selectedClient.email && ` · ${selectedClient.email}`}
              </p>
            )}
          </div>
        )}

        {/* ── New client fields ────────────────────────────────────────────── */}
        {mode === "new" && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-600 font-subheading">
                  First name
                </label>
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="Jane"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none font-body"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-600 font-subheading">
                  Last name
                </label>
                <input
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Smith"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none font-body"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-600 font-subheading">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="jane@example.com"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none font-body"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-600 font-subheading">
                  Phone
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(555) 000-0000"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none font-body"
                />
              </div>
            </div>
          </div>
        )}

        {/* ── Demo date + notes ────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-slate-600 font-subheading">
              Demo date <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              required
              value={demoDate}
              onChange={(e) => setDemoDate(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-slate-400 focus:outline-none font-body"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-slate-600 font-subheading">
              Notes
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional session notes…"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none font-body"
            />
          </div>
        </div>

        {/* Error */}
        {submitError && (
          <p className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700 font-body">
            {submitError}
          </p>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50 font-subheading"
        >
          {submitting ? "Confirming…" : "Confirm Demo Session"}
        </button>
      </form>
    </div>
  );
}
