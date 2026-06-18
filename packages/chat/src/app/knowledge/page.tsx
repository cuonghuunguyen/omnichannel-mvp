import { KnowledgeAdmin } from "@/components/knowledge/knowledge-admin";
import { SiteNav } from "@/components/site-nav";

export const metadata = { title: "Knowledge" };

export default function KnowledgePage() {
  return (
    <div className="flex h-screen w-full flex-col bg-background">
      <SiteNav current="/knowledge" />
      <div className="flex-1 overflow-hidden">
        <KnowledgeAdmin />
      </div>
    </div>
  );
}
