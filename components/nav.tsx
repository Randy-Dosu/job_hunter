"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Briefcase,
  FileText,
  ShieldCheck,
  KanbanSquare,
  Settings,
  Sparkles,
} from "lucide-react";

const links = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/jobs", label: "Job feed", icon: Briefcase },
  { href: "/resume", label: "Resume & facts", icon: FileText },
  { href: "/approvals", label: "Approval centre", icon: ShieldCheck },
  { href: "/applications", label: "Tracker", icon: KanbanSquare },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function SidebarNav({ pendingApprovals }: { pendingApprovals: number }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1" aria-label="Main">
      {links.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link key={href} href={href} className={`sidebar-link ${active ? "sidebar-link-active" : ""}`}>
            <Icon size={16} className={active ? "text-brand-600" : "text-slate-400"} />
            <span className="flex-1">{label}</span>
            {href === "/approvals" && pendingApprovals > 0 ? (
              <span className="rounded-full bg-brand-600 px-1.5 py-0.5 text-[10px] font-bold text-white">{pendingApprovals}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

export function MobileNav({ pendingApprovals }: { pendingApprovals: number }) {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-white/80 px-3 py-2 backdrop-blur lg:hidden" aria-label="Main">
      {links.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium ${
              active ? "bg-brand-50 text-brand-700" : "text-slate-500"
            }`}
          >
            <Icon size={14} />
            {label}
            {href === "/approvals" && pendingApprovals > 0 ? (
              <span className="rounded-full bg-brand-600 px-1 text-[9px] font-bold text-white">{pendingApprovals}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

export function Brand() {
  return (
    <Link href="/dashboard" className="flex items-center gap-2.5">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-sm">
        <Sparkles size={17} />
      </span>
      <span>
        <span className="block text-sm font-semibold tracking-tight text-slate-900">Job Hunter</span>
        <span className="block text-[11px] text-slate-500">careful by design</span>
      </span>
    </Link>
  );
}
