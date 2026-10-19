"use client";

import { useState, useRef, useCallback } from "react";
import { IconCheck, IconSearch } from "@tabler/icons-react";
import type { ClientSearchResult } from "@/app/api/staff/clients/search/route";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ClientPickerValue =
  | { mode: "existing"; clientId: number }
  | { mode: "new"; firstName: string; lastName: string; email: string; phone: string };

interface Props {
  onChange: (value: ClientPickerValue | null) => void;
  disabled?: boolean;
  /** Optional: also receive the full record when an existing customer is selected. */
  onSelectExisting?: (client: ClientSearchResult | null) => void;
  /** When false, hides the "New customer" toggle and forces search-only mode. Defaults to true. */
  allowNew?: boolean;
}

type Mode = "search" | "new";

// ── Component ─────────────────────────────────────────────────────────────────

export function ClientPicker({
  onChange,
  disabled = false,
  onSelectExisting,
  allowNew = true,
}: Props) {
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
      onSelectExisting?.(null);

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
    [onChange, onSelectExisting],
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
    onSelectExisting?.(c);
  };

  // ── Mode switch ────────────────────────────────────────────────────────────

  const switchMode = (newMode: Mode) => {
    setMode(newMode);
    setSelectedClient(null);
    setSearchQuery("");
    setSearchResults([]);
    setShowDropdown(false);
    onSelectExisting?.(null);
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
      {/* Mode toggle — segmented control */}
      {allowNew && (
        <div className="inline-flex w-full rounded-lg bg-muted p-1 sm:w-auto">
          <button
            type="button"
            onClick={() => switchMode("search")}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors font-subheading sm:flex-none ${
              mode === "search"
                ? "bg-card text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Find existing customer
          </button>
          <button
            type="button"
            onClick={() => switchMode("new")}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors font-subheading sm:flex-none ${
              mode === "new"
                ? "bg-card text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            New customer
          </button>
        </div>
      )}

      {/* Search existing client */}
      {mode === "search" && (
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold text-muted-foreground font-subheading">
            Search customer
          </label>
          <div className="relative">
            <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
              onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
              disabled={disabled}
              placeholder="Name, email, or phone…"
              className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none font-body"
            />
            {searching && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                Searching…
              </span>
            )}
            {showDropdown && searchResults.length > 0 && (
              <ul className="absolute z-20 mt-1 w-full rounded-lg border border-border bg-card shadow-md">
                {searchResults.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onMouseDown={() => handleSelectClient(c)}
                      className="w-full px-3 py-2.5 text-left hover:bg-muted text-sm font-body"
                    >
                      <span className="font-medium text-foreground">
                        {[c.firstName, c.lastName].filter(Boolean).join(" ") ||
                          "(no name)"}
                      </span>
                      {(c.email ?? c.phone) && (
                        <span className="ml-2 text-xs text-muted-foreground">
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
                <div className="absolute z-20 mt-1 w-full rounded-lg border border-border bg-card px-3 py-2.5 text-xs text-muted-foreground shadow-md font-body">
                  No customers found — switch to &ldquo;New customer&rdquo; to
                  create one.
                </div>
              )}
          </div>
          {selectedClient && (
            <p className="flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400 font-body">
              <IconCheck className="h-3.5 w-3.5" />
              Selected:{" "}
              {[selectedClient.firstName, selectedClient.lastName]
                .filter(Boolean)
                .join(" ") || `Client #${selectedClient.id}`}
              {selectedClient.email && ` · ${selectedClient.email}`}
            </p>
          )}
        </div>
      )}

      {/* New client fields */}
      {allowNew && mode === "new" && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-muted-foreground font-subheading">
                First name
              </label>
              <input
                type="text"
                value={newClient.firstName}
                onChange={(e) => updateNewClient("firstName", e.target.value)}
                disabled={disabled}
                placeholder="Jane"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none font-body"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-muted-foreground font-subheading">
                Last name
              </label>
              <input
                type="text"
                value={newClient.lastName}
                onChange={(e) => updateNewClient("lastName", e.target.value)}
                disabled={disabled}
                placeholder="Smith"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none font-body"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-muted-foreground font-subheading">
                Email
              </label>
              <input
                type="email"
                value={newClient.email}
                onChange={(e) => updateNewClient("email", e.target.value)}
                disabled={disabled}
                placeholder="jane@example.com"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none font-body"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-muted-foreground font-subheading">
                Phone
              </label>
              <input
                type="tel"
                value={newClient.phone}
                onChange={(e) => updateNewClient("phone", e.target.value)}
                disabled={disabled}
                placeholder="(555) 000-0000"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none font-body"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
