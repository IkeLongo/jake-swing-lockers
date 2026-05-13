import type { Metadata } from "next";
import SwingLockerLoginForm from "./_components/SwingLockerLoginForm";

export const metadata: Metadata = {
  title: "Sign In — Swing Locker",
  robots: { index: false, follow: false },
};

export default function SwingLockerLoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <SwingLockerLoginForm />
    </main>
  );
}
