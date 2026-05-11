import Link from "next/link";
import LogoutButton from "@/app/staff/_components/LogoutButton";

export default function StaffProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* ── Top nav ─────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white shadow-xs">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6 py-4">
          {/* Brand */}
          <Link
            href="/staff/dashboard"
            className="flex items-center gap-2.5 font-heading text-base font-bold text-slate-900 hover:text-emerald-700 transition-colors"
          >
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
            Jake Swing Lockers
            <span className="hidden sm:inline-block rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500 font-body">
              STAFF
            </span>
          </Link>

          {/* Nav + logout */}
          <div className="flex items-center gap-1 sm:gap-4">
            <nav className="hidden sm:flex items-center gap-1">
              <NavLink href="/staff/dashboard">Dashboard</NavLink>
              <NavLink href="/staff/imports">Demo Imports</NavLink>
            </nav>
            <LogoutButton />
          </div>
        </div>
      </header>

      {/* ── Page content ────────────────────────────────────────────────────── */}
      <main className="flex-1 mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
        {children}
      </main>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <footer className="border-t border-slate-200 bg-white py-4 text-center text-xs text-slate-400 font-body">
        Jake Swing Lockers — Internal Staff Portal
      </footer>
    </div>
  );
}

function NavLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors font-body"
    >
      {children}
    </Link>
  );
}
