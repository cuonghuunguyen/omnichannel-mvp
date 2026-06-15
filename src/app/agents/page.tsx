import Link from "next/link";
import { AgentsAdmin } from "@/components/agents/agents-admin";

export const metadata = { title: "Agent Builder" };

export default function AgentsPage() {
  return (
    <div className="mx-auto flex h-screen w-full max-w-5xl flex-col">
      <nav className="flex items-center justify-between border-b px-4 py-2 text-sm">
        <span className="font-semibold">Agent Builder</span>
        <div className="flex gap-3 text-muted-foreground">
          <Link href="/" className="hover:text-foreground">
            Chat
          </Link>
          <Link href="/inbox" className="hover:text-foreground">
            Inbox
          </Link>
        </div>
      </nav>
      <div className="flex-1 overflow-hidden">
        <AgentsAdmin />
      </div>
    </div>
  );
}
