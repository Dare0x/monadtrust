import type { Metadata } from "next";
import Link from "next/link";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "MonadTrust — who wrote this agent's reviews?",
  description:
    "ERC-8004 lets any wallet review an AI agent. MonadTrust checks every reviewer on Monad and recomputes the rating from the ones that hold up, using only public chain data.",
};

function Mark() {
  return (
    <svg className="mark" viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="mt-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#B7A8FF" />
          <stop offset="1" stopColor="#6E54F5" />
        </linearGradient>
      </defs>
      <path d="M16 2 28 9v14L16 30 4 23V9z" fill="url(#mt-g)" />
      <path d="m10.5 16.4 3.8 3.8 7.4-8" fill="none" stroke="#0B0A14" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <div className="glow" aria-hidden="true" />
        <header className="site-head">
          <div className="site-head-inner">
            <Link href="/" className="wordmark">
              <Mark />
              MonadTrust
            </Link>
            <nav className="site-nav" aria-label="Main">
              <Link href="/">Agents</Link>
              <Link href="/wallet">Check a wallet</Link>
              <a href="https://github.com/Dare0x/monadtrust" target="_blank" rel="noreferrer">
                Source
              </a>
              <span className="net-badge">
                <span className="net-dot" aria-hidden="true" />
                Monad testnet
              </span>
            </nav>
          </div>
        </header>
        <div className="frame">
          {children}
          <footer className="site-foot">
            <p>
              Reads the ERC-8004 registries on Monad testnet through its public RPC. Every number on this site comes
              from code you can read and re-run; no AI model produces or changes one.
            </p>
            <p>A counted review is not proof of honesty, and a struck one is not an accusation.</p>
          </footer>
        </div>
      </body>
    </html>
  );
}
