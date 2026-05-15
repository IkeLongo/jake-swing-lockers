"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StaffRow {
  id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  role: "admin" | "sales_rep" | "support";
  isActive: boolean;
  createdAt: string; // ISO string
}

interface Props {
  initialStaff: StaffRow[];
  /** The current logged-in admin's ID — used to prevent self-deactivation UI */
  currentStaffUserId: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtRole(role: StaffRow["role"]): string {
  switch (role) {
    case "admin":     return "Admin";
    case "sales_rep": return "Sales Rep";
    case "support":   return "Support";
  }
}

function roleBadgeClass(role: StaffRow["role"]): string {
  switch (role) {
    case "admin":
      return "bg-amber-100 text-amber-800";
    case "sales_rep":
      return "bg-emerald-100 text-emerald-800";
    case "support":
      return "bg-sky-100 text-sky-800";
  }
}

function fmtPhone(phone: string | null): string {
  if (!phone) return "—";
  const digits = phone.replace(/\D/g, "");
  const ten =
    digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length === 10) {
    return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
  }
  return phone; // fallback for non-standard numbers
}

function displayName(s: Pick<StaffRow, "name" | "email" | "id">) {
  return s.name ?? s.email ?? `Staff #${s.id}`;
}

// ── Deactivate/Reactivate Confirmation Modal ──────────────────────────────────

interface ToggleActiveModalProps {
  staff: StaffRow;
  onClose: () => void;
  onToggled: (id: number, isActive: boolean) => void;
}

function ToggleActiveModal({ staff, onClose, onToggled }: ToggleActiveModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const isDeactivating = staff.isActive;

  const close = useCallback(() => {
    if (loading) return;
    onClose();
  }, [loading, onClose]);

  useEffect(() => {
    const handle = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [close]);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  const handleConfirm = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/staff/admin/staff/${staff.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !staff.isActive }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Something went wrong. Please try again.");
        setLoading(false);
        return;
      }
      onToggled(staff.id, !staff.isActive);
    } catch {
      setError("Network error. Please check your connection and try again.");
      setLoading(false);
    }
  };

  const name = displayName(staff);

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      aria-modal="true"
      role="dialog"
      aria-labelledby="toggle-active-modal-title"
      onClick={(e) => { if (e.target === overlayRef.current) close(); }}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="relative z-10 w-full max-w-md rounded-2xl bg-white shadow-xl ring-1 ring-slate-200">
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-slate-100 px-6 py-5">
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${isDeactivating ? "bg-red-100" : "bg-emerald-100"}`}>
            {isDeactivating ? (
              <svg className="h-5 w-5 text-red-600" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
              </svg>
            ) : (
              <svg className="h-5 w-5 text-emerald-600" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
              </svg>
            )}
          </div>
          <div>
            <h2 id="toggle-active-modal-title" className="text-base font-semibold text-slate-900 font-heading">
              {isDeactivating ? "Deactivate Staff Member?" : "Reactivate Staff Member?"}
            </h2>
            <p className="mt-1 text-sm text-slate-500 font-body">
              {isDeactivating
                ? "This staff member will lose access to the dashboard immediately."
                : "This staff member will regain access to the dashboard."}
            </p>
          </div>
        </div>

        {/* Details */}
        <div className="px-6 py-5 space-y-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm font-body">
            <dt className="font-semibold text-slate-500">Name</dt>
            <dd className="text-slate-900">{name}</dd>
            <dt className="font-semibold text-slate-500">Role</dt>
            <dd className="text-slate-700">{fmtRole(staff.role)}</dd>
            <dt className="font-semibold text-slate-500">Email</dt>
            <dd className="text-slate-700">{staff.email ?? <span className="text-slate-400">—</span>}</dd>
          </dl>

          {isDeactivating && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-xs font-semibold text-amber-800 font-body">
                The staff member will be blocked from logging in. Their records are preserved and this can be reversed.
              </p>
            </div>
          )}

          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 font-body">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={close}
              disabled={loading}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors font-body disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={loading}
              className={`rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors font-body disabled:opacity-50 ${
                isDeactivating
                  ? "bg-red-600 hover:bg-red-700"
                  : "bg-emerald-600 hover:bg-emerald-700"
              }`}
            >
              {loading
                ? isDeactivating ? "Deactivating…" : "Reactivating…"
                : isDeactivating ? "Deactivate" : "Reactivate"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function StaffMembersTable({ initialStaff, currentStaffUserId }: Props) {
  const router = useRouter();
  const [staff, setStaff] = useState<StaffRow[]>(initialStaff);
  const [search, setSearch] = useState("");
  const [togglingStaff, setTogglingStaff] = useState<StaffRow | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return staff;
    return staff.filter(
      (s) =>
        s.name?.toLowerCase().includes(q) ||
        s.email?.toLowerCase().includes(q) ||
        s.phone?.toLowerCase().includes(q) ||
        fmtRole(s.role).toLowerCase().includes(q),
    );
  }, [staff, search]);

  const handleToggled = (id: number, isActive: boolean) => {
    setStaff((prev) =>
      prev.map((s) => (s.id === id ? { ...s, isActive } : s)),
    );
    setTogglingStaff(null);
    router.refresh();
  };

  return (
    <>
      {/* ── Toolbar ───────────────────────────────────────────────────────── */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email, phone, or role…"
          className="w-full max-w-sm rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none font-body shadow-xs"
        />
        <Link
          href="/staff/admin/new-staff"
          className="shrink-0 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-xs hover:bg-emerald-700 transition-colors font-body text-center"
        >
          Add Staff
        </Link>
      </div>

      {/* ── Empty state ───────────────────────────────────────────────────── */}
      {filtered.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-8 py-16 text-center">
          <div className="mb-3 text-4xl">👤</div>
          {search ? (
            <>
              <h2 className="text-base font-semibold text-slate-700 font-subheading">
                No staff match &ldquo;{search}&rdquo;
              </h2>
              <p className="mt-1 text-sm text-slate-400 font-body">
                Try a different search or add a new staff member.
              </p>
            </>
          ) : (
            <>
              <h2 className="text-base font-semibold text-slate-700 font-subheading">
                No staff members yet
              </h2>
              <p className="mt-1 text-sm text-slate-400 font-body">
                Add your first staff member to get started.
              </p>
            </>
          )}
        </div>
      )}

      {/* ── Table ─────────────────────────────────────────────────────────── */}
      {filtered.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
          <table className="min-w-full text-sm font-body">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap">
                  Name
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap">
                  Role
                </th>
                <th className="hidden px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap sm:table-cell">
                  Email
                </th>
                <th className="hidden px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap md:table-cell">
                  Phone
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap">
                  Status
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((s) => {
                const isSelf = s.id === currentStaffUserId;
                return (
                  <tr key={s.id} className={`hover:bg-slate-50 ${!s.isActive ? "opacity-60" : ""}`}>
                    {/* Name */}
                    <td className="px-4 py-3">
                      <span className="font-medium text-slate-800">
                        {displayName(s)}
                        {isSelf && (
                          <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500 font-body">
                            You
                          </span>
                        )}
                      </span>
                    </td>
                    {/* Role */}
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${roleBadgeClass(s.role)}`}>
                        {fmtRole(s.role)}
                      </span>
                    </td>
                    {/* Email */}
                    <td className="hidden px-4 py-3 text-slate-500 sm:table-cell">
                      {s.email ?? <span className="text-slate-300">—</span>}
                    </td>
                    {/* Phone */}
                    <td className="hidden px-4 py-3 text-slate-500 md:table-cell">
                      {fmtPhone(s.phone)}
                    </td>
                    {/* Status */}
                    <td className="px-4 py-3">
                      {s.isActive ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-400">
                          <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
                          Inactive
                        </span>
                      )}
                    </td>
                    {/* Actions */}
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-3">
                        <Link
                          href={`/staff/admin/${s.id}`}
                          className="text-xs font-semibold text-slate-500 hover:text-slate-800 transition-colors"
                        >
                          View
                        </Link>
                        <Link
                          href={`/staff/admin/${s.id}/edit`}
                          className="text-xs font-semibold text-slate-500 hover:text-slate-800 transition-colors"
                        >
                          Edit
                        </Link>
                        {isSelf ? (
                          <span
                            title="You cannot deactivate your own account"
                            className="text-xs font-semibold text-slate-300 cursor-not-allowed"
                          >
                            Deactivate
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setTogglingStaff(s)}
                            className={`text-xs font-semibold transition-colors ${
                              s.isActive
                                ? "text-slate-400 hover:text-red-600"
                                : "text-slate-400 hover:text-emerald-600"
                            }`}
                          >
                            {s.isActive ? "Deactivate" : "Reactivate"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Modal ─────────────────────────────────────────────────────────── */}
      {togglingStaff && (
        <ToggleActiveModal
          staff={togglingStaff}
          onClose={() => setTogglingStaff(null)}
          onToggled={handleToggled}
        />
      )}
    </>
  );
}
