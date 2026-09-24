import type { Metadata } from "next";
import Link from "next/link";
import { IBM_Plex_Mono, IBM_Plex_Sans, Instrument_Serif } from "next/font/google";
import "./globals.css";

const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-serif" });
const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-sans" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "MonadTrust — who wrote this agent's reviews?",
  description:
    "ERC-8004 lets any wallet review an AI agent. MonadTrust checks every reviewer on Monad and recomputes the rating from the ones that hold up, using only public chain data.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${mono.variable}`}>
      <body>
        <header className="site-head">
          <div className="site-head-inner">
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
          </div>
        </header>
        <div className="frame">
          {children}
          <footer className="site-foot">
            <p>
              Reads the ERC-8004 registries on Monad testnet (chain 10143) through its public RPC. Every number here
              comes from code you can read and re-run; no AI model produces or changes one.
            </p>
            <p>A counted review is not proof of honesty, and a struck one is not an accusation.</p>
          </footer>
        </div>
      </body>
    </html>
  );
}
