"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import {
  Sidebar,
  SidebarBody,
  SidebarLink,
  useSidebar,
  type Links,
} from "@/app/_components/navigation/SideBar";
import {
  IconLayoutDashboard,
  IconUpload,
  IconFileSpreadsheet,
  IconUsers,
  IconShoppingCart,
  IconUserShield,
  IconLogout,
} from "@tabler/icons-react";

interface StaffSidebarProps {
  children: React.ReactNode;
  isAdmin: boolean;
}

export default function StaffSidebar({ children, isAdmin }: StaffSidebarProps) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  async function handleLogout() {
    setIsLoggingOut(true);
    try {
      await fetch("/api/staff-auth/logout", { method: "POST" });
    } finally {
      router.push("/staff/login");
    }
  }

  const mainLinks: Links[] = [
    {
      label: "Dashboard",
      href: "/staff/dashboard",
      icon: <IconLayoutDashboard className="h-5 w-5" />,
    },
  ];

  const workflowLinks: Links[] = [
    {
      label: "Upload Demo",
      href: "/staff/demo-sessions/new",
      icon: <IconUpload className="h-5 w-5" />,
    },
    {
      label: "Demo Sessions",
      href: "/staff/imports",
      icon: <IconFileSpreadsheet className="h-5 w-5" />,
    },
  ];

  const salesLinks: Links[] = [
    {
      label: "Clients",
      href: "/staff/clients",
      icon: <IconUsers className="h-5 w-5" />,
    },
    {
      label: "Purchase Requests",
      href: "/staff/purchase-requests",
      icon: <IconShoppingCart className="h-5 w-5" />,
    },
  ];

  const adminLinks: Links[] = isAdmin
    ? [
        {
          label: "Staff Members",
          href: "/staff/admin",
          icon: <IconUserShield className="h-5 w-5" />,
        },
      ]
    : [];

  const signOutLink: Links = {
    label: isLoggingOut ? "Signing out…" : "Sign out",
    href: "#",
    icon: <IconLogout className="h-5 w-5" />,
    onClick: handleLogout,
  };

  return (
    <div className="flex flex-col md:flex-row bg-background w-full min-h-screen">
      <Sidebar open={open} setOpen={setOpen}>
        <SidebarBody className="justify-between gap-6">
          <div className="flex flex-col flex-1 overflow-y-auto overflow-x-hidden">
            {/* ── Brand Header ────────────────────────────────────────────── */}
            <Logo isAdmin={isAdmin} />

            <div className="mt-6 flex flex-col gap-1">
              {/* ── MAIN ──────────────────────────────────────────────────── */}
              <NavSection title="MAIN" />
              {mainLinks.map((link) => (
                <SidebarLink key={link.href} link={link} />
              ))}

              {/* ── WORKFLOW ──────────────────────────────────────────────── */}
              <NavSection title="WORKFLOW" className="mt-3" />
              {workflowLinks.map((link) => (
                <SidebarLink key={link.href} link={link} />
              ))}

              {/* ── SALES ─────────────────────────────────────────────────── */}
              <NavSection title="SALES" className="mt-3" />
              {salesLinks.map((link) => (
                <SidebarLink key={link.href} link={link} />
              ))}

              {/* ── ADMIN (if applicable) ─────────────────────────────────── */}
              {adminLinks.length > 0 && (
                <>
                  <NavSection title="ADMIN" className="mt-3" />
                  {adminLinks.map((link) => (
                    <SidebarLink key={link.href} link={link} />
                  ))}
                </>
              )}
            </div>
          </div>

          {/* ── Footer / Sign Out ─────────────────────────────────────────── */}
          <div className="border-t border-border pt-3">
            <SidebarLink link={signOutLink} />
          </div>
        </SidebarBody>

        {/* ── Main content scrollable area ────────────────────────────────── */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-8 min-h-screen">
          {children}
        </main>
      </Sidebar>
    </div>
  );
}

function Logo({ isAdmin }: { isAdmin: boolean }) {
  const { open, animate } = useSidebar();
  return (
    <Link
      href="/staff/dashboard"
      className="flex items-center gap-2.5 py-1 px-1 relative z-20 overflow-hidden"
    >
      <div className="h-8 w-8 rounded-lg bg-primary flex shrink-0 items-center justify-center text-primary-foreground font-bold text-xs shadow-xs">
        JL
      </div>
      <motion.div
        animate={{
          display: animate ? (open ? "flex" : "none") : "flex",
          opacity: animate ? (open ? 1 : 0) : 1,
        }}
        className="flex items-center gap-2 whitespace-nowrap overflow-hidden"
      >
        <span className="font-heading font-bold text-sidebar-foreground text-base">
          JL Golf Sales
        </span>
        {isAdmin ? (
          <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold text-accent font-body">
            ADMIN
          </span>
        ) : (
          <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground font-body">
            STAFF
          </span>
        )}
      </motion.div>
    </Link>
  );
}

function NavSection({
  title,
  className,
}: {
  title: string;
  className?: string;
}) {
  const { open, animate } = useSidebar();
  return (
    <div className={className}>
      <motion.div
        animate={{
          display: animate ? (open ? "block" : "none") : "block",
          opacity: animate ? (open ? 1 : 0) : 1,
        }}
        className="px-2 pb-1 text-[10px] font-bold tracking-wider text-muted-foreground uppercase font-body"
      >
        {title}
      </motion.div>
      <motion.div
        animate={{
          display: animate ? (open ? "none" : "block") : "none",
          opacity: animate ? (open ? 0 : 1) : 0,
        }}
        className="my-1 border-t border-border"
      />
    </div>
  );
}
