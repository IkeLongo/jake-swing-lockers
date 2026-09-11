"use client";
import { cn } from "@/lib/utils";
import React, { useState, createContext, useContext } from "react";
import { AnimatePresence, motion } from "motion/react";
import { IconMenu2, IconX } from "@tabler/icons-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export interface Links {
  label: string;
  href: string;
  icon: React.JSX.Element | React.ReactNode;
  onClick?: (e: React.MouseEvent) => void;
}

interface SidebarContextProps {
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
  animate: boolean;
}

const SidebarContext = createContext<SidebarContextProps | undefined>(
  undefined
);

export const useSidebar = () => {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider");
  }
  return context;
};

export const SidebarProvider = ({
  children,
  open: openProp,
  setOpen: setOpenProp,
  animate = true,
}: {
  children: React.ReactNode;
  open?: boolean;
  setOpen?: React.Dispatch<React.SetStateAction<boolean>>;
  animate?: boolean;
}) => {
  const [openState, setOpenState] = useState(false);

  const open = openProp !== undefined ? openProp : openState;
  const setOpen = setOpenProp !== undefined ? setOpenProp : setOpenState;

  return (
    <SidebarContext.Provider value={{ open, setOpen, animate: animate }}>
      {children}
    </SidebarContext.Provider>
  );
};

export const Sidebar = ({
  children,
  open,
  setOpen,
  animate,
}: {
  children: React.ReactNode;
  open?: boolean;
  setOpen?: React.Dispatch<React.SetStateAction<boolean>>;
  animate?: boolean;
}) => {
  return (
    <SidebarProvider open={open} setOpen={setOpen} animate={animate}>
      {children}
    </SidebarProvider>
  );
};

export const SidebarBody = (props: React.ComponentProps<typeof motion.div>) => {
  return (
    <>
      <DesktopSidebar {...props} />
      <MobileSidebar {...(props as React.ComponentProps<"div">)} />
    </>
  );
};

export const DesktopSidebar = ({
  className,
  children,
  ...props
}: React.ComponentProps<typeof motion.div>) => {
  const { open, setOpen, animate } = useSidebar();
  return (
    <>
      <motion.div
        className={cn(
          "h-full px-3 py-4 hidden md:flex md:flex-col bg-white dark:bg-neutral-900 border-r border-slate-200 dark:border-neutral-800 w-[260px] shrink-0",
          className
        )}
        animate={{
          width: animate ? (open ? "260px" : "68px") : "260px",
        }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        {...props}
      >
        {children}
      </motion.div>
    </>
  );
};

export const MobileSidebar = ({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) => {
  const { open, setOpen } = useSidebar();
  return (
    <>
      <div
        className={cn(
          "h-14 px-4 py-3 flex flex-row md:hidden items-center justify-between bg-white dark:bg-neutral-900 border-b border-slate-200 dark:border-neutral-800 w-full shrink-0"
        )}
        {...props}
      >
        <div className="flex items-center gap-2 font-heading font-bold text-slate-900 dark:text-white text-base">
          <div className="h-7 w-7 rounded-md bg-emerald-600 flex items-center justify-center text-white font-bold text-xs">
            JL
          </div>
          <span>JL Golf Sales</span>
        </div>
        <div className="flex justify-end z-20">
          <IconMenu2
            className="text-neutral-800 dark:text-neutral-200 cursor-pointer"
            onClick={() => setOpen(!open)}
          />
        </div>
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ x: "-100%", opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: "-100%", opacity: 0 }}
              transition={{
                duration: 0.3,
                ease: "easeInOut",
              }}
              className={cn(
                "fixed h-full w-full inset-0 bg-white dark:bg-neutral-900 p-6 z-[100] flex flex-col justify-between overflow-y-auto",
                className
              )}
            >
              <div
                className="absolute right-6 top-6 z-50 text-neutral-800 dark:text-neutral-200 cursor-pointer"
                onClick={() => setOpen(!open)}
              >
                <IconX />
              </div>
              {children}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
};

export const SidebarLink = ({
  link,
  className,
  ...props
}: {
  link: Links;
  className?: string;
}) => {
  const { open, setOpen, animate } = useSidebar();
  const pathname = usePathname();

  const isActive =
    pathname === link.href ||
    (link.href !== "/staff/dashboard" &&
      link.href !== "#" &&
      pathname?.startsWith(link.href));

  const handleClick = (e: React.MouseEvent) => {
    setOpen(false);
    if (link.onClick) {
      link.onClick(e);
    }
  };

  const content = (
    <>
      <div
        className={cn(
          "shrink-0 transition-colors",
          isActive
            ? "text-emerald-700 dark:text-emerald-400"
            : "text-slate-500 group-hover/sidebar:text-slate-900 dark:text-neutral-400 dark:group-hover/sidebar:text-white"
        )}
      >
        {link.icon}
      </div>

      <motion.span
        animate={{
          display: animate ? (open ? "inline-block" : "none") : "inline-block",
          opacity: animate ? (open ? 1 : 0) : 1,
        }}
        className="whitespace-pre inline-block !p-0 !m-0"
      >
        {link.label}
      </motion.span>
    </>
  );

  const baseClassName = cn(
    "flex items-center justify-start gap-3 group/sidebar py-2 px-2.5 rounded-lg transition-colors text-sm font-medium font-body w-full text-left",
    isActive
      ? "bg-slate-100 text-slate-900 font-semibold dark:bg-neutral-800 dark:text-white"
      : "text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-neutral-300 dark:hover:bg-neutral-800/60 dark:hover:text-white",
    className
  );

  if (link.onClick) {
    return (
      <button
        type="button"
        onClick={handleClick}
        className={baseClassName}
        {...props}
      >
        {content}
      </button>
    );
  }

  return (
    <Link
      href={link.href}
      onClick={handleClick}
      className={baseClassName}
      {...props}
    >
      {content}
    </Link>
  );
};
