"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type LogoutButtonProps = {
  variant?: "pill" | "menu";
  onAction?: () => void;
};

export default function LogoutButton({
  variant = "pill",
  onAction,
}: LogoutButtonProps) {
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
      onClick={() => {
        onAction?.();
        void handleLogout();
      }}
      disabled={isLoading}
      className={
        variant === "menu"
          ? "flex w-full items-center rounded-lg px-3 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 font-body"
          : "inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 font-body"
      }
    >
      {isLoading ? "Signing out..." : "Sign Out"}
    </button>
  );
}
