"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Michroma } from "next/font/google";
import { IconChevronDown, IconMenu2, IconUser, IconX } from "@tabler/icons-react";
import LogoutButton from "@/app/staff/_components/LogoutButton";

const michroma = Michroma({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
});

const NAV_ITEMS = [
  {
    href: "/staff/demo-sessions/new",
    label: "New Demo",
    matchPrefixes: ["/staff/demo-sessions"],
  },
  {
    href: "/staff/imports",
    label: "Demos",
    matchPrefixes: ["/staff/imports"],
  },
  {
    href: "/staff/purchase-requests",
    label: "Requests",
    matchPrefixes: ["/staff/purchase-requests"],
  },
  {
    href: "/staff/clients",
    label: "Clients",
    matchPrefixes: ["/staff/clients"],
  },
  {
    href: "/staff/admin",
    label: "Team",
    matchPrefixes: ["/staff/admin"],
  },
] as const;

type ProtectedNavbarProps = {
  isAdmin: boolean;
  staffName?: string | null;
};

type DayGreeting = "morning" | "afternoon" | "evening";

function getDayGreeting(hour: number): DayGreeting {
  if (hour >= 5 && hour < 12) {
    return "morning";
  }

  if (hour >= 12 && hour < 17) {
    return "afternoon";
  }

  return "evening";
}

export function ProtectedNavbar({
  isAdmin: _isAdmin,
  staffName,
}: ProtectedNavbarProps) {
  const pathname = usePathname();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [dayGreeting, setDayGreeting] = useState<DayGreeting>("morning");
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const isDashboard =
    pathname === "/staff/dashboard" || pathname.startsWith("/staff/dashboard/");
  const currentNavItem = NAV_ITEMS.find((item) =>
    item.matchPrefixes.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
    )
  );
  const firstName =
    staffName
      ?.split(" ")
      .map((part) => part.trim())
      .find(Boolean) ?? null;
  const greetingText = firstName
    ? `Good ${dayGreeting}, ${firstName}!`
    : `Good ${dayGreeting}!`;
  const bottomTitle = isDashboard
    ? greetingText
    : currentNavItem?.label ?? "Staff Portal";

  useEffect(() => {
    setIsMobileMenuOpen(false);
    setIsProfileMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    setDayGreeting(getDayGreeting(new Date().getHours()));
  }, []);

  useEffect(() => {
    if (!isProfileMenuOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!profileMenuRef.current) {
        return;
      }

      if (!profileMenuRef.current.contains(event.target as Node)) {
        setIsProfileMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [isProfileMenuOpen]);

  return (
    <header className="sticky top-0 z-20 bg-slate-50/80 backdrop-blur supports-[backdrop-filter]:bg-slate-50/70">
      <div className="mx-auto max-w-6xl px-4 pt-3 sm:px-6 lg:px-8">
        <div className="overflow-hidden rounded-3xl border border-slate-700/80 bg-[#070b12] shadow-[0_8px_24px_rgba(2,6,23,0.18)] ring-1 ring-white/10">
          <div className="grid h-16 grid-cols-[1fr_auto_1fr] items-center px-3 sm:px-4">
            <Link
              href="/staff/dashboard"
              className="group inline-flex items-center gap-3 rounded-full py-1 transition-transform duration-200 hover:-translate-y-0.5 justify-self-start"
            >
              <Image
                src="/logos/jl-golf-sales-light-icon-variant.svg"
                alt="JL Golf Sales logo"
                width={34}
                height={34}
                priority
                className="h-8 w-8 object-contain sm:h-9 sm:w-9"
              />
              <span
                className={`${michroma.className} flex flex-col uppercase leading-none text-slate-100 transition-colors group-hover:text-emerald-300`}
              >
                <span className="text-[0.62rem] tracking-[0.22em] sm:text-[0.68rem]">
                  JL GOLF
                </span>
                <span className="mt-0.5 text-[0.75rem] tracking-[0.24em] text-slate-300 sm:text-[0.82rem]">
                  SALES
                </span>
              </span>
            </Link>

            <div className="hidden items-center justify-self-center md:flex">
              <nav aria-label="Staff navigation" className="flex items-center gap-1.5">
                {NAV_ITEMS.map((item) => (
                  <DesktopNavLink
                    key={item.href}
                    href={item.href}
                    label={item.label}
                    pathname={pathname}
                    matchPrefixes={item.matchPrefixes}
                  />
                ))}
              </nav>
            </div>

            <div className="hidden justify-self-end md:flex">
              <div ref={profileMenuRef} className="relative">
                <button
                  type="button"
                  onClick={() => setIsProfileMenuOpen((current) => !current)}
                  aria-expanded={isProfileMenuOpen}
                  aria-label={isProfileMenuOpen ? "Close profile menu" : "Open profile menu"}
                  className="inline-flex h-10 items-center gap-2 rounded-full border border-slate-700/80 bg-slate-900/60 px-2.5 text-slate-200 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-500 hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-0"
                >
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-500/30">
                    <IconUser size={15} stroke={1.8} />
                  </span>
                  <IconChevronDown
                    size={16}
                    stroke={1.8}
                    className={`transition-transform duration-200 ${
                      isProfileMenuOpen ? "rotate-180" : "rotate-0"
                    }`}
                  />
                </button>

                <div
                  className={`absolute right-0 top-[calc(100%+0.5rem)] z-30 w-52 origin-top-right rounded-xl border border-slate-200/90 bg-white/95 p-1.5 shadow-[0_14px_32px_rgba(15,23,42,0.12)] ring-1 ring-slate-900/5 transition-all duration-200 ${
                    isProfileMenuOpen
                      ? "pointer-events-auto translate-y-0 scale-100 opacity-100"
                      : "pointer-events-none -translate-y-1 scale-95 opacity-0"
                  }`}
                >
                  <Link
                    href="/staff/profile"
                    onClick={() => setIsProfileMenuOpen(false)}
                    className="flex items-center rounded-lg px-3 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900"
                  >
                    View Profile
                  </Link>
                  <LogoutButton
                    variant="menu"
                    onAction={() => setIsProfileMenuOpen(false)}
                  />
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setIsMobileMenuOpen((current) => !current)}
              aria-expanded={isMobileMenuOpen}
              aria-label={isMobileMenuOpen ? "Close menu" : "Open menu"}
              className="col-start-3 justify-self-end inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-700/80 bg-slate-900/60 text-slate-200 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-slate-800 hover:text-white focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-0 md:hidden"
            >
              {isMobileMenuOpen ? <IconX size={18} stroke={1.8} /> : <IconMenu2 size={18} stroke={1.8} />}
            </button>
          </div>

          <div className="border-t border-white/10 px-4 py-4 sm:px-5 sm:py-5">
            <p className="text-sm font-medium text-slate-400 font-body">
              Staff Control Center
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-50 font-heading sm:text-3xl">
              {bottomTitle}
            </h1>
          </div>
        </div>

        <div
          className={`md:hidden overflow-hidden transition-[max-height,opacity,transform,margin-top] duration-300 ease-out ${
            isMobileMenuOpen
              ? "mt-3 max-h-96 translate-y-0 opacity-100"
              : "pointer-events-none max-h-0 -translate-y-2 opacity-0"
          }`}
        >
          <div className="rounded-2xl border border-slate-700/80 bg-[#0b111d] p-3 shadow-[0_6px_18px_rgba(2,6,23,0.22)] ring-1 ring-white/10 backdrop-blur">
            <nav aria-label="Mobile staff navigation" className="space-y-1.5">
              {NAV_ITEMS.map((item) => (
                <MobileNavLink
                  key={item.href}
                  href={item.href}
                  label={item.label}
                  pathname={pathname}
                  matchPrefixes={item.matchPrefixes}
                  onNavigate={() => setIsMobileMenuOpen(false)}
                />
              ))}
            </nav>

            <div className="mt-3 border-t border-slate-700/80 pt-3 space-y-1.5">
              <Link
                href="/staff/profile"
                onClick={() => setIsMobileMenuOpen(false)}
                className="flex items-center gap-2 rounded-xl border border-transparent bg-slate-900/60 px-3.5 py-3 text-sm font-medium text-slate-200 transition-all duration-200 hover:border-slate-600 hover:bg-slate-800 hover:text-white"
              >
                <IconUser size={16} stroke={1.8} />
                View Profile
              </Link>
              <LogoutButton
                variant="menu-dark"
                onAction={() => setIsMobileMenuOpen(false)}
              />
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

function DesktopNavLink({
  href,
  label,
  pathname,
  matchPrefixes,
}: {
  href: string;
  label: string;
  pathname: string;
  matchPrefixes: readonly string[];
}) {
  const isActive = matchPrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );

  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={`inline-flex items-center rounded-full px-3.5 py-2 text-sm font-medium transition-all duration-200 hover:-translate-y-0.5 hover:bg-slate-800/80 hover:text-white ${
        isActive
          ? "bg-slate-800 text-slate-100 ring-1 ring-inset ring-white/15 shadow-sm"
          : "text-slate-400"
      }`}
    >
      {label}
    </Link>
  );
}

function MobileNavLink({
  href,
  label,
  pathname,
  matchPrefixes,
  onNavigate,
}: {
  href: string;
  label: string;
  pathname: string;
  matchPrefixes: readonly string[];
  onNavigate: () => void;
}) {
  const isActive = matchPrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );

  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={isActive ? "page" : undefined}
      className={`flex items-center justify-between rounded-xl border px-3.5 py-3 text-sm font-medium transition-all duration-200 ${
        isActive
          ? "border-slate-600 bg-slate-800 text-slate-100 shadow-sm"
          : "border-transparent bg-slate-900/60 text-slate-300 hover:border-slate-600 hover:bg-slate-800 hover:text-white"
      }`}
    >
      <span>{label}</span>
      <span
        className={`h-2 w-2 rounded-full transition-colors ${
          isActive ? "bg-emerald-400" : "bg-slate-600"
        }`}
      />
    </Link>
  );
}