"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/jobs", label: "Jobs" },
  { href: "/dashboard", label: "Overview" },
  { href: "/resume", label: "Resume" },
  { href: "/applications", label: "Applications" },
  { href: "/approvals", label: "Approvals" },
];

export function Brand({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex shrink-0 items-center gap-2" aria-label="Job Hunter home">
      <span className="grid h-6 w-6 place-items-center rounded-[6px] bg-ink text-[10px] font-bold tracking-tight text-white">jh</span>
      <span className="text-[15px] font-semibold tracking-[-0.02em] text-ink">job hunter</span>
    </Link>
  );
}

export function TopNav({ pendingApprovals }: { pendingApprovals: number }) {
  const pathname = usePathname();
  return (
    <nav className="hidden items-center gap-6 md:flex" aria-label="Main">
      {links.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link key={link.href} href={link.href} className={`nav-link ${active ? "nav-link-active" : ""}`}>
            {link.label}
            {link.href === "/approvals" && pendingApprovals > 0 ? (
              <span className="ml-1.5 rounded bg-clay-600 px-1 py-[1px] text-[10px] font-semibold leading-4 text-white">{pendingApprovals}</span>
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
    <nav className="flex gap-4 overflow-x-auto border-t border-line px-4 md:hidden" aria-label="Main">
      {links.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`flex h-10 shrink-0 items-center gap-1 border-b-2 text-[12.5px] font-medium ${
              active ? "border-ink text-ink" : "border-transparent text-muted"
            }`}
          >
            {link.label}
            {link.href === "/approvals" && pendingApprovals > 0 ? (
              <span className="rounded bg-clay-600 px-1 text-[9px] font-semibold text-white">{pendingApprovals}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
