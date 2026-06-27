"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  readStoredTenant,
  writeStoredTenant,
  type Tenant,
} from "@/lib/tenant-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type TenantContextValue = {
  tenant: Tenant;
  /** Sign out of the current tenant and return to the tenant gate. */
  switchTenant: () => void;
};

const TenantContext = createContext<TenantContextValue | null>(null);

/** Access the signed-in tenant. Throws if used outside a chosen tenant. */
export function useTenant(): TenantContextValue {
  const ctx = useContext(TenantContext);
  if (!ctx) throw new Error("useTenant must be used within TenantProvider");
  return ctx;
}

/**
 * Gates the whole app behind a tenant choice. A visitor signs in / signs up a
 * tenant by name (POST /api/tenants → cookie + localStorage); only then are the
 * children (chat + admin surfaces) rendered. This is the shared tenant guard for
 * every page — there is no separate admin gate.
 */
export function TenantProvider({ children }: { children: ReactNode }) {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [ready, setReady] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sign in to (or sign up) a tenant by name. Shared by the gate and the
  // background cookie self-heal; returns the resolved tenant or an error string.
  async function requestSignIn(
    name: string,
  ): Promise<{ tenant?: Tenant; error?: string }> {
    const res = await fetch("/api/tenants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      return { error: body?.error ?? "Could not sign in to that tenant." };
    }
    const { tenant } = (await res.json()) as { tenant: Tenant };
    return { tenant };
  }

  // Restore + reconcile the signed-in tenant after mount (avoids an SSR
  // hydration mismatch — the server can't read localStorage). The httpOnly
  // sign-in cookie is authoritative; localStorage is an optimistic mirror:
  //  - show the stored tenant immediately so returning users skip the gate;
  //  - then check the cookie (GET /api/tenants) and reconcile any desync:
  //    cookie present → adopt it; cookie missing but a name is remembered →
  //    re-sign-in to re-mint the cookie; nothing either side → fall to the gate.
  useEffect(() => {
    const stored = readStoredTenant();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored) setTenant(stored);
    setReady(true);

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/tenants");
        if (!res.ok || cancelled) return;
        const { tenant: cookieTenant } = (await res.json()) as {
          tenant: Tenant | null;
        };
        if (cancelled) return;

        if (cookieTenant) {
          // Cookie wins. Sync localStorage if it drifted (e.g. cleared/renamed).
          if (
            !stored ||
            stored.id !== cookieTenant.id ||
            stored.name !== cookieTenant.name
          ) {
            writeStoredTenant(cookieTenant);
            setTenant(cookieTenant);
          }
        } else if (stored) {
          // Cookie lost but we remember the name — re-mint it (same name →
          // same tenant). If it no longer resolves, drop to the gate.
          const { tenant } = await requestSignIn(stored.name);
          if (cancelled) return;
          writeStoredTenant(tenant ?? null);
          setTenant(tenant ?? null);
        }
      } catch {
        // Offline / server error — keep the optimistic stored value.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function signIn() {
    const name = nameInput.trim();
    if (!name) return;
    setLoading(true);
    setError(null);
    try {
      const { tenant, error: err } = await requestSignIn(name);
      if (err || !tenant) {
        setError(err ?? "Could not sign in to that tenant.");
        return;
      }
      writeStoredTenant(tenant);
      setTenant(tenant);
      setNameInput("");
    } finally {
      setLoading(false);
    }
  }

  function switchTenant() {
    fetch("/api/tenants", { method: "DELETE" }).catch(() => {});
    writeStoredTenant(null);
    setTenant(null);
  }

  // Pre-mount: render nothing to keep SSR and first client paint in sync.
  if (!ready) return null;

  if (!tenant) {
    return (
      <div className="relative flex h-screen w-full items-center justify-center overflow-hidden p-6">
        <div className="orb top-[-6rem] left-[-4rem] h-72 w-72 bg-gradient-lavender" />
        <div className="orb right-[-5rem] bottom-[-7rem] h-80 w-80 bg-gradient-mint" />
        <div className="relative z-10 w-full max-w-sm space-y-8 rounded-2xl border border-border bg-surface-card/90 p-8 shadow-[0_4px_16px_rgba(0,0,0,0.04)] backdrop-blur-sm">
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.096em] text-muted-foreground">
              Agent Routing
            </p>
            <h1 className="text-4xl font-light leading-tight tracking-[-0.96px] text-ink">
              Choose your workspace
            </h1>
            <p className="text-sm leading-relaxed text-body">
              Enter a tenant name to sign in. New name? We&apos;ll create it.
            </p>
          </div>
          <div className="space-y-2.5">
            <Label htmlFor="tenant">Tenant name</Label>
            <Input
              id="tenant"
              value={nameInput}
              onChange={(e) => {
                setNameInput(e.target.value);
                if (error) setError(null);
              }}
              onKeyDown={(e) => e.key === "Enter" && signIn()}
              placeholder="e.g. Acme Corp"
              autoFocus
            />
            {error && <p className="text-xs text-red-600">{error}</p>}
          </div>
          <Button
            onClick={signIn}
            disabled={loading || !nameInput.trim()}
            className="w-full"
          >
            {loading ? "One moment…" : "Continue"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <TenantContext.Provider value={{ tenant, switchTenant }}>
      {children}
    </TenantContext.Provider>
  );
}
