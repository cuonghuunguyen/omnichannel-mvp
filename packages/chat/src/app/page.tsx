import { ChatApp } from "@/components/chat/chat-app";
import { SiteNav } from "@/components/site-nav";

export default function Home() {
  return (
    <div className="flex h-screen w-full flex-col bg-background">
      <SiteNav current="/" />
      <div className="flex-1 overflow-hidden">
        <ChatApp />
      </div>
    </div>
  );
}
