"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";

// ── Phone display formatter ──────────────────────────────────────────────────
// Frontend-only: formats 10 digits as (XXX) XXX-XXXX while typing.
// formData.phone always holds raw digits; backend normalizePhone() handles E.164.
function formatPhoneDisplay(digits: string): string {
  if (digits.length <= 3) return digits.length ? `(${digits}` : "";
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
}

export default function CreateStaffPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [phoneDisplay, setPhoneDisplay] = useState("");
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    role: "sales_rep" as const,
  });

  const handleChange = (
    e: React.ChangeEvent<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
    // Clear field error when user starts typing
    if (fieldErrors[name]) {
      setFieldErrors((prev) => {
        const updated = { ...prev };
        delete updated[name];
        return updated;
      });
    }
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Strip to digits only, cap at 10
    const digits = e.target.value.replace(/\D/g, "").slice(0, 10);
    setPhoneDisplay(formatPhoneDisplay(digits));
    setFormData((prev) => ({ ...prev, phone: digits }));
    if (fieldErrors.phone) {
      setFieldErrors((prev) => {
        const updated = { ...prev };
        delete updated.phone;
        return updated;
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setFieldErrors({});

    try {
      const response = await fetch("/api/staff/admin/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const result = (await response.json()) as
        | {
            success: true;
            staffUserId: number;
          }
        | {
            error: string;
            fieldErrors?: Record<string, string[]>;
          };

      if (!response.ok) {
        const errorResult = result as { error?: string; fieldErrors?: Record<string, string[]> };
        if (errorResult.fieldErrors) {
          setFieldErrors(errorResult.fieldErrors);
          setError("Please fix the validation errors below.");
        } else {
          setError(errorResult.error || "Failed to create staff user.");
        }
        setIsLoading(false);
        return;
      }

      // Success — redirect to dashboard
      router.push("/staff/dashboard?created=true");
    } catch (err) {
      console.error("Form submission error:", err);
      setError("An unexpected error occurred. Please try again.");
      setIsLoading(false);
    }
  };

  return (
    <>
      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <Link
            href="/staff/dashboard"
            className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-700 font-body"
          >
            ← Back to Dashboard
          </Link>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 font-heading">
            Create Staff User
          </h1>
          <p className="mt-1 text-sm text-slate-500 font-body">
            Add a new staff member to the dashboard with a role and contact
            details.
          </p>
        </div>
      </div>

      {/* ── Form container ──────────────────────────────────────────────────── */}
      <div className="max-w-2xl rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        {/* ── Error alert ──────────────────────────────────────────────────── */}
        {error && (
          <div className="mb-6 rounded-md bg-red-50 p-4 border border-red-200">
            <p className="text-sm font-medium text-red-900 font-body">{error}</p>
          </div>
        )}

        {/* ── Form ─────────────────────────────────────────────────────────── */}
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Name field */}
          <div>
            <label
              htmlFor="name"
              className="block text-sm font-medium text-slate-700 font-body"
            >
              Name
              <span className="text-red-500 ml-1">*</span>
            </label>
            <input
              type="text"
              id="name"
              name="name"
              value={formData.name}
              onChange={handleChange}
              placeholder="John Doe"
              className={`mt-1 block w-full rounded-md border px-3 py-2 text-sm font-body text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                fieldErrors.name
                  ? "border-red-300 focus:border-red-500 focus:ring-red-500"
                  : "border-slate-300 focus:border-emerald-500 focus:ring-emerald-500"
              }`}
              required
            />
            {fieldErrors.name && (
              <p className="mt-1 text-sm text-red-600 font-body">
                {fieldErrors.name[0]}
              </p>
            )}
          </div>

          {/* Email field */}
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-slate-700 font-body"
            >
              Email Address
            </label>
            <input
              type="email"
              id="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              placeholder="john@example.com"
              className={`mt-1 block w-full rounded-md border px-3 py-2 text-sm font-body text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                fieldErrors.email
                  ? "border-red-300 focus:border-red-500 focus:ring-red-500"
                  : "border-slate-300 focus:border-emerald-500 focus:ring-emerald-500"
              }`}
            />
            {fieldErrors.email && (
              <p className="mt-1 text-sm text-red-600 font-body">
                {fieldErrors.email[0]}
              </p>
            )}
            <p className="mt-1 text-xs text-slate-500 font-body">
              Optional — used for dashboard login.
            </p>
          </div>

          {/* Phone field */}
          <div>
            <label
              htmlFor="phone"
              className="block text-sm font-medium text-slate-700 font-body"
            >
              Phone Number
            </label>
            <input
              type="tel"
              id="phone"
              name="phone"
              value={phoneDisplay}
              onChange={handlePhoneChange}
              placeholder="(555) 123-4567"
              inputMode="numeric"
              className={`mt-1 block w-full rounded-md border px-3 py-2 text-sm font-body text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                fieldErrors.phone
                  ? "border-red-300 focus:border-red-500 focus:ring-red-500"
                  : "border-slate-300 focus:border-emerald-500 focus:ring-emerald-500"
              }`}
            />
            {fieldErrors.phone && (
              <p className="mt-1 text-sm text-red-600 font-body">
                {fieldErrors.phone[0]}
              </p>
            )}
            <p className="mt-1 text-xs text-slate-500 font-body">
              Optional — must provide email or phone.
            </p>
          </div>

          {/* Role field */}
          <div>
            <label
              htmlFor="role"
              className="block text-sm font-medium text-slate-700 font-body"
            >
              Role
              <span className="text-red-500 ml-1">*</span>
            </label>
            <select
              id="role"
              name="role"
              value={formData.role}
              onChange={handleChange}
              className={`mt-1 block w-full rounded-md border px-3 py-2 text-sm font-body text-slate-800 focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                fieldErrors.role
                  ? "border-red-300 focus:border-red-500 focus:ring-red-500"
                  : "border-slate-300 focus:border-emerald-500 focus:ring-emerald-500"
              }`}
              required
            >
              <option value="sales_rep">Sales Rep</option>
              <option value="admin">Admin</option>
              <option value="support">Support</option>
            </select>
            {fieldErrors.role && (
              <p className="mt-1 text-sm text-red-600 font-body">
                {fieldErrors.role[0]}
              </p>
            )}
            <p className="mt-1 text-xs text-slate-500 font-body">
              Controls dashboard permissions and available features.
            </p>
          </div>

          {/* Buttons */}
          <div className="flex gap-3 pt-4">
            <button
              type="submit"
              disabled={isLoading}
              className="rounded-md bg-emerald-600 px-4 py-2 font-medium text-white font-body hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isLoading ? "Creating..." : "Create Staff User"}
            </button>
            <Link
              href="/staff/dashboard"
              className="rounded-md border border-slate-300 px-4 py-2 font-medium text-slate-700 font-body hover:bg-slate-50 transition-colors"
            >
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </>
  );
}
