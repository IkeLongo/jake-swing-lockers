import type { Metadata } from "next";
import LoginForm from "./_components/LoginForm";

export const metadata: Metadata = {
  title: "Staff Sign In — Jake Swing Lockers",
  robots: { index: false, follow: false },
};

export default function StaffLoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <LoginForm />
    </main>
  );
}
