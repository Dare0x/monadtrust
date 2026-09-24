"use client";

import Link from "next/link";
import NetSwitch from "./NetSwitch";
import { useNet } from "./useNet";

export default function SiteNav() {
  const { withNet } = useNet();
  return (
    <nav className="site-nav" aria-label="Main">
      <Link href={withNet("/")}>Agents</Link>
      <Link href={withNet("/wallet")}>Check a wallet</Link>
      <Link href={withNet("/docs")}>Docs</Link>
      <a href="https://github.com/Dare0x/monadtrust" target="_blank" rel="noreferrer">
        Source
      </a>
      <NetSwitch />
    </nav>
  );
}
