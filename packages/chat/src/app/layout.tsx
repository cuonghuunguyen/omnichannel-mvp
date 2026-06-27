import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import "./globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { TenantProvider } from "@/components/tenant/tenant-provider";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Agent Routing Chat",
  description: "Multi-agent chat with AI and human agent routing",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <TooltipProvider>
          <TenantProvider>{children}</TenantProvider>
        </TooltipProvider>
        <Toaster />
      </body>
    </html>
  );
}
