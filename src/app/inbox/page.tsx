import Link from "next/link";
import { Inbox } from "@/components/inbox/inbox";

export const metadata = { title: "Operator Inbox" };

export default function InboxPage() {
  return (
    <div className="mx-auto flex h-screen w-full max-w-6xl flex-col">
      <nav className="flex items-center justify-between border-b px-4 py-2 text-sm">
        <span className="font-semibold">Operator Inbox</span>
        <div className="flex gap-3 text-muted-foreground">
          <Link href="/" className="hover:text-foreground">
            Chat
          </Link>
          <Link href="/agents" className="hover:text-foreground">
            Agents
          </Link>
        </div>
      </nav>
      <div className="flex-1 overflow-hidden">
        <Inbox />
      </div>
    </div>
  );
}
