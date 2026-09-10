import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MonadTrust — verifiable on-chain reputation",
  description:
    "A transparent, reproducible trust score for any wallet or agent on Monad. Computed only from public on-chain data — no black box, no AI-invented numbers.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
