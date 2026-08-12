import type { Metadata } from "next";
import { Instrument_Serif, Figtree } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import "./globals.css";

const display = Instrument_Serif({
  variable: "--font-display",
  subsets: ["latin"],
  weight: "400",
});

const body = Figtree({
  variable: "--font-body",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Dog Vet Near You",
    template: "%s · Dog Vet Near You",
  },
  description:
    "Find dog vets, 24/7 emergency care, and urgent clinics by city — starting with California.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} h-full`}>
      <body className="min-h-full flex flex-col antialiased">
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <SiteFooter />
        <Analytics />
      </body>
    </html>
  );
}
