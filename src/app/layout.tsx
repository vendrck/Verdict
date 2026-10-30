import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "ProofPay",
  description: "Escrow for freelance work: AI verifies the delivery, PayPal holds and releases the money.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="nav">
          <Link href="/" className="nav-brand">
            ProofPay
          </Link>
          <Link href="/jobs">Jobs</Link>
          <Link href="/admin">Admin</Link>
        </nav>
        {children}
      </body>
    </html>
  );
}
