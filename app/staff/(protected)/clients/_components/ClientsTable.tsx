"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ClientRow {
  id: number;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  createdAt: string; // ISO string (serialized from server)
  demoSessionCount: number;
  lastDemoDate: string | null; // ISO string or null
}

interface Props {
  initialClients: ClientRow[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function displayName(c: Pick<ClientRow, "firstName" | "lastName" | "email" | "id">) {
  return (
    [c.firstName, c.lastName].filter(Boolean).join(" ") ||
    c.email ||
    `Client #${c.id}`
  );
}

function fmtPhone(phone: string | null): string {
  if (!phone) return "—";
  const digits = phone.replace(/\D/g, "");
  const ten =
    digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length === 10) {
    return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
  }
  return phone; // fallback: return as-is for non-US numbers
}

function fmtDate(iso: string | null, timeZone = "UTC") {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone,
  });
}

// ── Modal: Add Client ─────────────────────────────────────────────────────────

interface AddModalProps {
  onClose: () => void;
  onCreated: (client: ClientRow) => void;
}

function AddClientModal({ onClose, onCreated }: AddModalProps) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!firstName.trim()) { setError("First name is required."); return; }
    if (!lastName.trim()) { setError("Last name is required."); return; }
    if (!email.trim() && !phone.trim()) {
      setError("At least one of email or phone is required.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/staff/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName: firstName.trim(), lastName: lastName.trim(), email: email.trim(), phone: phone.trim() }),
      });
      const data = (await res.json()) as
        | { success: true; client: ClientRow }
        | { error: string };

      if (!res.ok || !("success" in data)) {
        setError("error" in data ? data.error : "Unexpected error.");
        return;
      }
      onCreated({
        ...data.client,
        demoSessionCount: 0,
        lastDemoDate: null,
        createdAt: typeof data.client.createdAt === "string"
          ? data.client.createdAt
          : new Date((data.client.createdAt as unknown as Date)).toISOString(),
      });
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalBackdrop onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <h2 className="text-base font-semibold text-slate-800 font-heading">Add Client</h2>
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name *" value={firstName} onChange={setFirstName} placeholder="Jane" />
          <Field label="Last name *" value={lastName} onChange={setLastName} placeholder="Smith" />
        </div>
        <Field label="Email" value={email} onChange={setEmail} placeholder="jane@example.com" type="email" />
        <Field label="Phone" value={phone} onChange={setPhone} placeholder="+1 555 000 0000" type="tel" />
        {error && <ErrorBox>{error}</ErrorBox>}
        <div className="flex justify-end gap-2 pt-1">
          <CancelBtn onClick={onClose} disabled={submitting} />
          <SubmitBtn disabled={submitting}>{submitting ? "Adding…" : "Add Client"}</SubmitBtn>
        </div>
      </form>
    </ModalBackdrop>
  );
}

// ── Modal: Edit Client ────────────────────────────────────────────────────────

interface EditModalProps {
  client: ClientRow;
  onClose: () => void;
  onUpdated: (client: ClientRow) => void;
}

function EditClientModal({ client, onClose, onUpdated }: EditModalProps) {
  const [firstName, setFirstName] = useState(client.firstName ?? "");
  const [lastName, setLastName] = useState(client.lastName ?? "");
  const [email, setEmail] = useState(client.email ?? "");
  const [phone, setPhone] = useState(client.phone ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!firstName.trim()) { setError("First name is required."); return; }
    if (!lastName.trim()) { setError("Last name is required."); return; }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/staff/clients/${client.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName: firstName.trim(), lastName: lastName.trim(), email: email.trim(), phone: phone.trim() }),
      });
      const data = (await res.json()) as
        | { success: true; client: Pick<ClientRow, "id" | "firstName" | "lastName" | "email" | "phone"> }
        | { error: string };

      if (!res.ok || !("success" in data)) {
        setError("error" in data ? data.error : "Unexpected error.");
        return;
      }
      onUpdated({ ...client, ...data.client });
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalBackdrop onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <h2 className="text-base font-semibold text-slate-800 font-heading">
          Edit Client
        </h2>
        <p className="text-xs text-slate-500 font-body -mt-2">
          Update the golfer&apos;s profile. To reassign sessions to a different client, use the session editor.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name *" value={firstName} onChange={setFirstName} placeholder="Jane" />
          <Field label="Last name *" value={lastName} onChange={setLastName} placeholder="Smith" />
        </div>
        <Field label="Email" value={email} onChange={setEmail} placeholder="jane@example.com" type="email" />
        <Field label="Phone" value={phone} onChange={setPhone} placeholder="+1 555 000 0000" type="tel" />
        {error && <ErrorBox>{error}</ErrorBox>}
        <div className="flex justify-end gap-2 pt-1">
          <CancelBtn onClick={onClose} disabled={submitting} />
          <SubmitBtn disabled={submitting}>{submitting ? "Saving…" : "Save Changes"}</SubmitBtn>
        </div>
      </form>
    </ModalBackdrop>
  );
}

// ── Shared small components ───────────────────────────────────────────────────

function ModalBackdrop({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
        {children}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-semibold text-slate-600 font-subheading">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none font-body"
      />
    </div>
  );
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 font-body">
      {children}
    </p>
  );
}

function CancelBtn({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors font-body disabled:opacity-50"
    >
      Cancel
    </button>
  );
}

function SubmitBtn({ children, disabled }: { children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors font-body disabled:opacity-50"
    >
      {children}
    </button>
  );
}

// ── Modal: Delete Client ─────────────────────────────────────────────────────

interface DeleteModalProps {
  client: ClientRow;
  onClose: () => void;
  onDeleted: (id: number) => void;
}

function DeleteClientModal({ client, onClose, onDeleted }: DeleteModalProps) {
  const [confirmInput, setConfirmInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const hasSessions = client.demoSessionCount > 0;
  const canConfirm = !hasSessions && confirmInput === "DELETE" && !loading;

  const close = useCallback(() => {
    if (loading) return;
    onClose();
  }, [loading, onClose]);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const handle = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [close]);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  const handleDelete = async () => {
    if (!canConfirm) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/staff/clients/${client.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Something went wrong. Please try again.");
        setLoading(false);
        return;
      }
      onDeleted(client.id);
    } catch {
      setError("Network error. Please check your connection and try again.");
      setLoading(false);
    }
  };

  const name = displayName(client);

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      aria-modal="true"
      role="dialog"
      aria-labelledby="delete-client-modal-title"
      onClick={(e) => { if (e.target === overlayRef.current) close(); }}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="relative z-10 w-full max-w-md rounded-2xl bg-white shadow-xl ring-1 ring-slate-200">
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-slate-100 px-6 py-5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-100">
            <svg className="h-5 w-5 text-red-600" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
            </svg>
          </div>
          <div>
            <h2 id="delete-client-modal-title" className="text-base font-semibold text-slate-900 font-heading">
              Delete Client?
            </h2>
            <p className="mt-1 text-sm text-slate-500 font-body">
              You are about to permanently delete this client profile.
            </p>
          </div>
        </div>

        {/* Details */}
        <div className="px-6 py-5 space-y-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm font-body">
            <dt className="font-semibold text-slate-500">Name</dt>
            <dd className="text-slate-900">{name}</dd>
            <dt className="font-semibold text-slate-500">Email</dt>
            <dd className="text-slate-700">{client.email ?? <span className="text-slate-400">—</span>}</dd>
            <dt className="font-semibold text-slate-500">Phone</dt>
            <dd className="text-slate-700">{fmtPhone(client.phone)}</dd>
            <dt className="font-semibold text-slate-500">Demo Sessions</dt>
            <dd className="text-slate-700">{client.demoSessionCount}</dd>
          </dl>

          {/* Blocked: client has sessions */}
          {hasSessions && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-sm font-semibold text-amber-800 font-body">
                This client cannot be deleted because they have {client.demoSessionCount} demo session{client.demoSessionCount === 1 ? "" : "s"} attached.
              </p>
              <p className="mt-1 text-xs text-amber-700 font-body">
                Delete those sessions first, then you can delete this client.
              </p>
            </div>
          )}

          {/* Confirm input */}
          {!hasSessions && (
            <>
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
                <p className="text-xs font-semibold text-red-700 font-body">
                  This action cannot be undone.
                </p>
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-600 font-subheading">
                  Type <span className="font-mono font-bold">DELETE</span> to confirm
                </label>
                <input
                  ref={inputRef}
                  type="text"
                  value={confirmInput}
                  onChange={(e) => setConfirmInput(e.target.value)}
                  placeholder="DELETE"
                  disabled={loading}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-red-400 focus:outline-none font-mono disabled:opacity-50"
                />
              </div>
            </>
          )}

          {error && <ErrorBox>{error}</ErrorBox>}

          <div className="flex justify-end gap-2 pt-1">
            <CancelBtn onClick={close} disabled={loading} />
            {!hasSessions && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={!canConfirm}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 transition-colors font-body disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {loading ? "Deleting…" : "Delete Client"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ClientsTable({ initialClients }: Props) {
  const router = useRouter();
  const [clients, setClients] = useState<ClientRow[]>(initialClients);
  const [search, setSearch] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingClient, setEditingClient] = useState<ClientRow | null>(null);
  const [deletingClient, setDeletingClient] = useState<ClientRow | null>(null);

  // Client-side filtering
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(
      (c) =>
        c.firstName?.toLowerCase().includes(q) ||
        c.lastName?.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q) ||
        c.phone?.toLowerCase().includes(q),
    );
  }, [clients, search]);

  const handleCreated = (client: ClientRow) => {
    setClients((prev) => [client, ...prev]);
    setShowAddModal(false);
    router.refresh();
  };

  const handleUpdated = (updated: ClientRow) => {
    setClients((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    setEditingClient(null);
  };

  const handleDeleted = (id: number) => {
    setClients((prev) => prev.filter((c) => c.id !== id));
    setDeletingClient(null);
  };

  return (
    <>
      {/* ── Toolbar ───────────────────────────────────────────────────────── */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email, or phone…"
          className="w-full max-w-sm rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none font-body shadow-xs"
        />
        <button
          type="button"
          onClick={() => setShowAddModal(true)}
          className="shrink-0 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-xs hover:bg-emerald-700 transition-colors font-body"
        >
          Add Client
        </button>
      </div>

      {/* ── Empty state ───────────────────────────────────────────────────── */}
      {filtered.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-8 py-16 text-center">
          <div className="mb-3 text-4xl">👤</div>
          {search ? (
            <>
              <h2 className="text-base font-semibold text-slate-700 font-subheading">
                No clients match &ldquo;{search}&rdquo;
              </h2>
              <p className="mt-1 text-sm text-slate-400 font-body">
                Try a different search or add a new client.
              </p>
            </>
          ) : (
            <>
              <h2 className="text-base font-semibold text-slate-700 font-subheading">
                No clients yet
              </h2>
              <p className="mt-1 text-sm text-slate-400 font-body">
                Add your first golfer to get started.
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
                <th className="hidden px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap sm:table-cell">
                  Email
                </th>
                <th className="hidden px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap md:table-cell">
                  Phone
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap">
                  Sessions
                </th>
                <th className="hidden px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap lg:table-cell">
                  Last Demo
                </th>
                <th className="hidden px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap lg:table-cell">
                  Created
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <span className="font-medium text-slate-800">
                      {displayName(c)}
                    </span>
                  </td>
                  <td className="hidden px-4 py-3 text-slate-500 sm:table-cell">
                    {c.email ?? <span className="text-slate-300">—</span>}
                  </td>
                  <td className="hidden px-4 py-3 text-slate-500 md:table-cell">
                    {fmtPhone(c.phone)}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-600 tabular-nums">
                    {c.demoSessionCount > 0 ? (
                      c.demoSessionCount
                    ) : (
                      <span className="text-slate-300">0</span>
                    )}
                  </td>
                  <td className="hidden px-4 py-3 text-slate-500 whitespace-nowrap lg:table-cell">
                    {fmtDate(c.lastDemoDate)}
                  </td>
                  <td className="hidden px-4 py-3 text-slate-500 whitespace-nowrap lg:table-cell">
                    {fmtDate(c.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-3">
                      <Link
                        href={`/staff/clients/${c.id}`}
                        className="text-xs font-semibold text-slate-500 hover:text-slate-800 transition-colors"
                      >
                        View
                      </Link>
                      <button
                        type="button"
                        onClick={() => setEditingClient(c)}
                        className="text-xs font-semibold text-slate-500 hover:text-slate-800 transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeletingClient(c)}
                        className="text-xs font-semibold text-slate-400 hover:text-red-600 transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Modals ────────────────────────────────────────────────────────── */}
      {showAddModal && (
        <AddClientModal
          onClose={() => setShowAddModal(false)}
          onCreated={handleCreated}
        />
      )}
      {editingClient && (
        <EditClientModal
          client={editingClient}
          onClose={() => setEditingClient(null)}
          onUpdated={handleUpdated}
        />
      )}
      {deletingClient && (
        <DeleteClientModal
          client={deletingClient}
          onClose={() => setDeletingClient(null)}
          onDeleted={handleDeleted}
        />
      )}
    </>
  );
}
