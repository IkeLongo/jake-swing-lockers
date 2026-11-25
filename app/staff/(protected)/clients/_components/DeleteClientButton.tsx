"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

interface Props {
  clientId: number;
  clientName: string;
  email: string | null;
  phone: string | null;
  /** Pre-formatted phone string for display */
  phoneFmt: string;
  demoSessionCount: number;
}

export default function DeleteClientButton({
  clientId,
  clientName,
  email,
  phoneFmt,
  demoSessionCount,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmInput, setConfirmInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const hasSessions = demoSessionCount > 0;
  const canConfirm = !hasSessions && confirmInput === "DELETE" && !loading;

  // ── Open / close ────────────────────────────────────────────────────────────

  const openModal = () => {
    setConfirmInput("");
    setError(null);
    setOpen(true);
  };

  const closeModal = useCallback(() => {
    if (loading) return;
    setOpen(false);
    setConfirmInput("");
    setError(null);
  }, [loading]);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handle = (e: KeyboardEvent) => { if (e.key === "Escape") closeModal(); };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [open, closeModal]);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  // ── Delete handler ───────────────────────────────────────────────────────────

  const handleDelete = async () => {
    if (!canConfirm) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/staff/clients/${clientId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Something went wrong. Please try again.");
        setLoading(false);
        return;
      }
      // Success: navigate back to clients list
      router.push("/staff/clients");
    } catch {
      setError("Network error. Please check your connection and try again.");
      setLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="rounded-lg border border-destructive bg-card px-4 py-2 text-sm font-semibold text-destructive shadow-xs hover:bg-destructive/10 transition-colors font-body"
      >
        Delete Client
      </button>

      {open && (
        <div
          ref={overlayRef}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          aria-modal="true"
          role="dialog"
          aria-labelledby="delete-client-modal-title"
          onClick={(e) => { if (e.target === overlayRef.current) closeModal(); }}
        >
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div className="relative z-10 w-full max-w-md rounded-2xl bg-card shadow-xl ring-1 ring-border">
            {/* Header */}
            <div className="flex items-start gap-3 border-b border-border px-6 py-5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-950">
                <svg className="h-5 w-5 text-red-600 dark:text-red-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                </svg>
              </div>
              <div>
                <h2 id="delete-client-modal-title" className="text-base font-semibold text-foreground font-heading">
                  Delete Client?
                </h2>
                <p className="mt-1 text-sm text-muted-foreground font-body">
                  You are about to permanently delete this client profile.
                </p>
              </div>
            </div>

            {/* Details */}
            <div className="px-6 py-5 space-y-4">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm font-body">
                <dt className="font-semibold text-muted-foreground">Name</dt>
                <dd className="text-foreground">{clientName}</dd>
                <dt className="font-semibold text-muted-foreground">Email</dt>
                <dd className="text-foreground">{email ?? <span className="text-muted-foreground/50">—</span>}</dd>
                <dt className="font-semibold text-muted-foreground">Phone</dt>
                <dd className="text-foreground">{phoneFmt}</dd>
                <dt className="font-semibold text-muted-foreground">Fittings</dt>
                <dd className="text-foreground">{demoSessionCount}</dd>
              </dl>

              {/* Blocked: client has sessions */}
              {hasSessions && (
                <div className="rounded-lg border border-amber-200/80 bg-amber-50/80 dark:border-amber-900/40 dark:bg-amber-950/20 px-4 py-3">
                  <p className="text-sm font-semibold text-amber-800 dark:text-amber-200 font-body">
                    This client cannot be deleted because they have {demoSessionCount} fitting{demoSessionCount === 1 ? "" : "s"} attached.
                  </p>
                  <p className="mt-1 text-xs text-amber-700 dark:text-amber-300 font-body">
                    Delete those fittings first, then you can delete this client.
                  </p>
                </div>
              )}

              {/* Confirm input */}
              {!hasSessions && (
                <>
                  <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3">
                    <p className="text-xs font-semibold text-destructive font-body">
                      This action cannot be undone.
                    </p>
                  </div>
                  <div className="space-y-1">
                    <label className="block text-xs font-semibold text-muted-foreground font-subheading">
                      Type <span className="font-mono font-bold">DELETE</span> to confirm
                    </label>
                    <input
                      ref={inputRef}
                      type="text"
                      value={confirmInput}
                      onChange={(e) => setConfirmInput(e.target.value)}
                      placeholder="DELETE"
                      disabled={loading}
                      className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-destructive focus:outline-none focus:ring-2 focus:ring-destructive/20 font-mono disabled:opacity-50 transition-colors"
                    />
                  </div>
                </>
              )}

              {error && (
                <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive font-body">
                  {error}
                </p>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={loading}
                  className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-muted-foreground hover:bg-muted transition-colors font-body disabled:opacity-50"
                >
                  Cancel
                </button>
                {!hasSessions && (
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={!canConfirm}
                    className="rounded-lg bg-destructive px-4 py-2 text-sm font-semibold text-white hover:bg-destructive/90 transition-colors font-body disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {loading ? "Deleting…" : "Delete Client"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
