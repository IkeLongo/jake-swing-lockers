"use client";

import { useState, useRef, useCallback } from "react";
import type { ClientSearchResult } from "@/app/api/staff/clients/search/route";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ClientPickerValue =
  | { mode: "existing"; clientId: number }
  | { mode: "new"; firstName: string; lastName: string; email: string; phone: string };

interface Props {
  onChange: (value: ClientPickerValue | null) => void;
  disabled?: boolean;
}

type Mode = "search" | "new";

// ── Component ─────────────────────────────────────────────────────────────────

export function ClientPicker({ onChange, disabled = false }: Props) {
  const [mode, setMode] = useState<Mode>("search");

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ClientSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedClient, setSelectedClient] = useState<ClientSearchResult | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // New client state (single object to simplify onChange calls)
  const [newClient, setNewClient] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
  });

  // ── Search ─────────────────────────────────────────────────────────────────

  const handleSearchChange = useCallback(
    (val: string) => {
      setSearchQuery(val);
      setSelectedClient(null);
      onChange(null);

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
    },
    [onChange],
  );

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
    onChange({ mode: "existing", clientId: c.id });
  };

  // ── Mode switch ────────────────────────────────────────────────────────────

  const switchMode = (newMode: Mode) => {
    setMode(newMode);
    setSelectedClient(null);
    setSearchQuery("");
    setSearchResults([]);
    setShowDropdown(false);
    if (newMode === "new") {
      onChange({ mode: "new", ...newClient });
    } else {
      onChange(null);
    }
  };

  // ── New client fields ──────────────────────────────────────────────────────

  const updateNewClient = (field: keyof typeof newClient, val: string) => {
    setNewClient((prev) => {
      const next = { ...prev, [field]: val };
      onChange({ mode: "new", ...next });
      return next;
    });
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-3">
      {/* Mode toggle */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => switchMode("search")}
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
          onClick={() => switchMode("new")}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors font-subheading ${
            mode === "new"
              ? "bg-slate-900 text-white"
              : "bg-slate-100 text-slate-600 hover:bg-slate-200"
          }`}
        >
          New client
        </button>
      </div>

      {/* Search existing client */}
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
              disabled={disabled}
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
                      {(c.email ?? c.phone) && (
                        <span className="ml-2 text-xs text-slate-400">
                          {c.email ?? c.phone}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {showDropdown &&
              searchResults.length === 0 &&
              !searching &&
              searchQuery.trim().length >= 2 && (
                <div className="absolute z-20 mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-400 shadow-md font-body">
                  No clients found — switch to &ldquo;New client&rdquo; to
                  create one.
                </div>
              )}
          </div>
          {selectedClient && (
            <p className="text-xs text-emerald-700 font-body">
              ✓ Selected:{" "}
              {[selectedClient.firstName, selectedClient.lastName]
                .filter(Boolean)
                .join(" ") || `Client #${selectedClient.id}`}
              {selectedClient.email && ` · ${selectedClient.email}`}
            </p>
          )}
        </div>
      )}

      {/* New client fields */}
      {mode === "new" && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-slate-600 font-subheading">
                First name
              </label>
              <input
                type="text"
                value={newClient.firstName}
                onChange={(e) => updateNewClient("firstName", e.target.value)}
                disabled={disabled}
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
                value={newClient.lastName}
                onChange={(e) => updateNewClient("lastName", e.target.value)}
                disabled={disabled}
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
                value={newClient.email}
                onChange={(e) => updateNewClient("email", e.target.value)}
                disabled={disabled}
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
                value={newClient.phone}
                onChange={(e) => updateNewClient("phone", e.target.value)}
                disabled={disabled}
                placeholder="(555) 000-0000"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none font-body"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
