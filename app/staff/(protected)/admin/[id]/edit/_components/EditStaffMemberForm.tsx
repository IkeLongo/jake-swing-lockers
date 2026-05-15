"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";

type Role = "admin" | "sales_rep" | "support";

interface EditStaffMemberFormProps {
  staffId: number;
  initialName: string;
  initialEmail: string;
  initialPhone: string;
  initialRole: Role;
}

function formatPhoneDisplay(digits: string): string {
  if (digits.length <= 3) return digits.length ? `(${digits}` : "";
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
}

function toTenDigits(rawPhone: string): string {
  const digits = rawPhone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits.slice(0, 10);
}

export function EditStaffMemberForm({
  staffId,
  initialName,
  initialEmail,
  initialPhone,
  initialRole,
}: EditStaffMemberFormProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const initialPhoneDigits = toTenDigits(initialPhone);
  const [phoneDisplay, setPhoneDisplay] = useState(formatPhoneDisplay(initialPhoneDigits));

  const [formData, setFormData] = useState<{
    name: string;
    email: string;
    phone: string;
    role: Role;
  }>({
    name: initialName,
    email: initialEmail,
    phone: initialPhoneDigits,
    role: initialRole,
  });

  const clearFieldError = (name: string) => {
    if (!fieldErrors[name]) return;
    setFieldErrors((prev) => {
      const updated = { ...prev };
      delete updated[name];
      return updated;
    });
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    clearFieldError(name);
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/\D/g, "").slice(0, 10);
    setPhoneDisplay(formatPhoneDisplay(digits));
    setFormData((prev) => ({ ...prev, phone: digits }));
    clearFieldError("phone");
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setFieldErrors({});

    try {
      const response = await fetch(`/api/staff/admin/staff/${staffId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const result = (await response.json()) as
        | { success: true; staffUser: { id: number } }
        | { error?: string; fieldErrors?: Record<string, string[]> };

      if (!response.ok) {
        const err = result as {
          error?: string;
          fieldErrors?: Record<string, string[]>;
        };

        if (err.fieldErrors) {
          setFieldErrors(err.fieldErrors);
          setError("Please fix the validation errors below.");
        } else {
          setError(err.error ?? "Failed to update staff member.");
        }
        setIsLoading(false);
        return;
      }

      router.push(`/staff/admin/${staffId}`);
    } catch (err) {
      console.error("Edit staff form submission error:", err);
      setError("An unexpected error occurred. Please try again.");
      setIsLoading(false);
    }
  };

  return (
    <div className="mb-8 rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900 font-heading">
        Edit Staff Member
      </h1>
      <p className="mt-1 text-sm text-slate-500 font-body">
        Update account profile fields.
      </p>

      {error && (
        <div className="mt-5 rounded-md bg-red-50 p-4 border border-red-200">
          <p className="text-sm font-medium text-red-900 font-body">{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-6 space-y-5">
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
            className={`mt-1 block w-full rounded-md border px-3 py-2 text-sm font-body text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-offset-2 ${
              fieldErrors.name
                ? "border-red-300 focus:border-red-500 focus:ring-red-500"
                : "border-slate-300 focus:border-emerald-500 focus:ring-emerald-500"
            }`}
            required
          />
          {fieldErrors.name && (
            <p className="mt-1 text-sm text-red-600 font-body">{fieldErrors.name[0]}</p>
          )}
        </div>

        <div>
          <label
            htmlFor="email"
            className="block text-sm font-medium text-slate-700 font-body"
          >
            Email
          </label>
          <input
            type="email"
            id="email"
            name="email"
            value={formData.email}
            onChange={handleChange}
            className={`mt-1 block w-full rounded-md border px-3 py-2 text-sm font-body text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-offset-2 ${
              fieldErrors.email
                ? "border-red-300 focus:border-red-500 focus:ring-red-500"
                : "border-slate-300 focus:border-emerald-500 focus:ring-emerald-500"
            }`}
          />
          {fieldErrors.email && (
            <p className="mt-1 text-sm text-red-600 font-body">{fieldErrors.email[0]}</p>
          )}
        </div>

        <div>
          <label
            htmlFor="phone"
            className="block text-sm font-medium text-slate-700 font-body"
          >
            Phone
          </label>
          <input
            type="tel"
            id="phone"
            name="phone"
            value={phoneDisplay}
            onChange={handlePhoneChange}
            inputMode="numeric"
            placeholder="(555) 123-4567"
            className={`mt-1 block w-full rounded-md border px-3 py-2 text-sm font-body text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-offset-2 ${
              fieldErrors.phone
                ? "border-red-300 focus:border-red-500 focus:ring-red-500"
                : "border-slate-300 focus:border-emerald-500 focus:ring-emerald-500"
            }`}
          />
          {fieldErrors.phone && (
            <p className="mt-1 text-sm text-red-600 font-body">{fieldErrors.phone[0]}</p>
          )}
          <p className="mt-1 text-xs text-slate-500 font-body">
            Must provide either email or phone.
          </p>
        </div>

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
            <p className="mt-1 text-sm text-red-600 font-body">{fieldErrors.role[0]}</p>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Link
            href={`/staff/admin/${staffId}`}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors font-body"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={isLoading}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors font-body disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </form>
    </div>
  );
}
