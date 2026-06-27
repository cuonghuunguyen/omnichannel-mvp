"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { useTenant } from "@/components/tenant/tenant-provider";
import { Button } from "@/components/ui/button";

const LINKS = [
  { href: "/", label: "Chat" },
  { href: "/agents", label: "Agents" },
  { href: "/knowledge", label: "Knowledge" },
  { href: "/inbox", label: "Inbox" },
] as const;

export function SiteNav({ current }: { current: string }) {
  const { tenant, switchTenant } = useTenant();

  return (
    <nav className="flex h-16 items-center justify-between border-b border-border bg-background px-6">
      <div className="flex items-center gap-10">
        <Link
          href="/"
          className="text-base font-medium tracking-tight text-ink"
        >
          Agent Routing
        </Link>
        <div className="flex items-center gap-7">
          {LINKS.map((link) => {
            const active = link.href === current;
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "text-sm font-medium transition-colors",
                  active ? "text-ink" : "text-muted-foreground hover:text-ink",
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground">
          Tenant <span className="font-medium text-ink">{tenant.name}</span>
        </span>
        <Button variant="outline" size="sm" onClick={switchTenant}>
          Switch tenant
        </Button>
      </div>
    </nav>
  );
}
