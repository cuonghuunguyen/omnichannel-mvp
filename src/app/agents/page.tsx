import { AgentsAdmin } from "@/components/agents/agents-admin";
import { SiteNav } from "@/components/site-nav";

export const metadata = { title: "Agent Builder" };

export default function AgentsPage() {
  return (
    <div className="flex h-screen w-full flex-col bg-background">
      <SiteNav current="/agents" />
      <div className="flex-1 overflow-hidden">
        <AgentsAdmin />
      </div>
    </div>
  );
}
