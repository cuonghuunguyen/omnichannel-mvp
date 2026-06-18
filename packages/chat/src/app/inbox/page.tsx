import { Inbox } from "@/components/inbox/inbox";
import { SiteNav } from "@/components/site-nav";

export const metadata = { title: "Operator Inbox" };

export default function InboxPage() {
  return (
    <div className="flex h-screen w-full flex-col bg-background">
      <SiteNav current="/inbox" />
      <div className="flex-1 overflow-hidden">
        <Inbox />
      </div>
    </div>
  );
}
