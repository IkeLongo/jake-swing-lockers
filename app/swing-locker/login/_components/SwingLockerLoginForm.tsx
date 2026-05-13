"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Step = "identifier" | "code";

export default function SwingLockerLoginForm() {
  const router = useRouter();

  const [step, setStep] = useState<Step>("identifier");
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // ── Step 1: request OTP ────────────────────────────────────────────────────
  async function handleRequestCode(e: React.FormEvent) {
    e.preventDefault();
    setFieldError(null);
    setFormError(null);

    if (identifier.trim() === "") {
      setFieldError("Please enter your email or phone number.");
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch("/api/swing-locker-auth/request-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: identifier.trim() }),
      });

      if (!res.ok && res.status !== 200) {
        const data = (await res.json().catch(() => ({}))) as {
          message?: string;
        };
        setFormError(data.message ?? "Something went wrong. Please try again.");
        return;
      }

      setCode("");
      setStep("code");
    } catch {
      setFormError("Network error. Please check your connection and try again.");
    } finally {
      setIsLoading(false);
    }
  }

  // ── Re-request OTP from step 2 ─────────────────────────────────────────────
  async function handleRequestNewCode() {
    setFieldError(null);
    setFormError(null);
    setCode("");
    setIsLoading(true);
    try {
      await fetch("/api/swing-locker-auth/request-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: identifier.trim() }),
      });
    } catch {
      setFormError("Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  // ── Step 2: verify OTP ─────────────────────────────────────────────────────
  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    setFieldError(null);
    setFormError(null);

    if (!/^\d{6}$/.test(code)) {
      setFieldError("Please enter the 6-digit code.");
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch("/api/swing-locker-auth/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: identifier.trim(), code }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        message?: string;
      };

      if (res.ok && data.success) {
        router.push("/swing-locker/dashboard");
        return;
      }

      setFormError("Invalid or expired code.");
    } catch {
      setFormError("Network error. Please check your connection and try again.");
    } finally {
      setIsLoading(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="w-full max-w-lg">
      {/* Card */}
      <div className="rounded-2xl border border-slate-200 bg-white m-0 md:m-8 px-8 py-10 shadow-sm">
        {/* Logo / portal name */}
        <div className="mb-8 text-center">
          <span className="inline-block rounded-xl bg-emerald-50 px-4 py-2 text-sm font-semibold tracking-wide text-emerald-700 font-body">
            SWING LOCKER
          </span>
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-900 font-heading">
            Sign in to continue
          </h1>
          <p className="mt-1 text-sm text-slate-500 font-body">
            {step === "identifier"
              ? "Enter your email or phone to receive a sign-in code."
              : "Enter the 6-digit code sent to your device."}
          </p>
        </div>

        {/* ── Step 1: identifier ───────────────────────────────────────────── */}
        {step === "identifier" && (
          <form onSubmit={handleRequestCode} noValidate>
            <div className="mb-5">
              <label
                htmlFor="identifier"
                className="mb-1.5 block text-sm font-semibold text-slate-700 font-body"
              >
                Email or phone
              </label>
              <input
                id="identifier"
                type="text"
                autoComplete="email tel"
                autoFocus
                disabled={isLoading}
                value={identifier}
                onChange={(e) => {
                  setIdentifier(e.target.value);
                  setFieldError(null);
                }}
                placeholder="you@example.com or (555) 000-0000"
                className="block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 shadow-xs focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 font-body"
              />
              {fieldError && (
                <p className="mt-1.5 text-sm text-red-600 font-body">
                  {fieldError}
                </p>
              )}
            </div>

            {formError && (
              <div className="mb-4 rounded-lg bg-red-50 px-3.5 py-3 text-sm text-red-700 font-body">
                {formError}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-xs hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-emerald-400 transition-colors font-body"
            >
              {isLoading ? "Sending code…" : "Send code"}
            </button>
          </form>
        )}

        {/* ── Step 2: OTP verification ─────────────────────────────────────── */}
        {step === "code" && (
          <form onSubmit={handleVerifyCode} noValidate>
            {/* Neutral confirmation that a code was sent */}
            <div className="mb-5 rounded-lg bg-emerald-50 px-3.5 py-3 text-sm text-emerald-800 font-body">
              If this account exists, a code has been sent.
            </div>

            <div className="mb-5">
              <label
                htmlFor="code"
                className="mb-1.5 block text-sm font-semibold text-slate-700 font-body"
              >
                6-digit code
              </label>
              <input
                id="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                disabled={isLoading}
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                  setFieldError(null);
                }}
                placeholder="000000"
                maxLength={6}
                className="block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 shadow-xs focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 font-body tracking-widest"
              />
              {fieldError && (
                <p className="mt-1.5 text-sm text-red-600 font-body">
                  {fieldError}
                </p>
              )}
            </div>

            {formError && (
              <div className="mb-4 rounded-lg bg-red-50 px-3.5 py-3 text-sm text-red-700 font-body">
                {formError}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-xs hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-emerald-400 transition-colors font-body"
            >
              {isLoading ? "Verifying…" : "Verify code"}
            </button>

            <div className="mt-4 text-center">
              <button
                type="button"
                disabled={isLoading}
                onClick={handleRequestNewCode}
                className="text-sm text-emerald-600 hover:text-emerald-800 underline underline-offset-2 disabled:cursor-not-allowed disabled:text-slate-400 font-body"
              >
                Request a new code
              </button>
              <span className="mx-2 text-slate-300">·</span>
              <button
                type="button"
                disabled={isLoading}
                onClick={() => {
                  setStep("identifier");
                  setCode("");
                  setFieldError(null);
                  setFormError(null);
                }}
                className="text-sm text-slate-500 hover:text-slate-700 underline underline-offset-2 disabled:cursor-not-allowed font-body"
              >
                Change email/phone
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
