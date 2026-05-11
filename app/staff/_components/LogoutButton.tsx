"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LogoutButton() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  async function handleLogout() {
    setIsLoading(true);
    try {
      await fetch("/api/staff-auth/logout", { method: "POST" });
    } finally {
      // Navigate to login regardless of fetch outcome — the server
      // already cleared the cookie on success; on network error the
      // user lands on the login page where the proxy will re-check.
      router.push("/staff/login");
    }
  }

  return (
    <button
      onClick={handleLogout}
      disabled={isLoading}
      className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 shadow-xs hover:bg-slate-50 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 transition-colors font-body"
    >
      {isLoading ? "Signing out…" : "Sign out"}
    </button>
  );
}
