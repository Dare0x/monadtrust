import type { Metadata } from "next";
import Link from "next/link";
import "@fontsource/familjen-grotesk/latin-400.css";
import "@fontsource/familjen-grotesk/latin-500.css";
import "@fontsource/familjen-grotesk/latin-600.css";
import "@fontsource/familjen-grotesk/latin-700.css";
import "@fontsource/jetbrains-mono/latin-400.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "MonadTrust — who wrote this agent's reviews?",
  description:
    "ERC-8004 lets any wallet review an AI agent. MonadTrust checks every reviewer on Monad and recomputes the rating from the ones that hold up, using only public chain data.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="frame">
          <header className="site-head">
            <Link href="/" className="wordmark">
              MonadTrust
            </Link>
            <nav className="site-nav" aria-label="Main">
              <Link href="/">Agents</Link>
              <Link href="/wallet">Check a wallet</Link>
              <a href="https://github.com/Dare0x/monadtrust" target="_blank" rel="noreferrer">
                Source
              </a>
            </nav>
          </header>
          {children}
          <footer className="site-foot">
            Reads the ERC-8004 registries on Monad testnet through its public RPC. Every number on this site comes
            from code you can read and re-run; no AI model produces or changes one. A counted review is not proof of
            honesty, and a struck one is not an accusation.
          </footer>
        </div>
      </body>
    </html>
  );
}
