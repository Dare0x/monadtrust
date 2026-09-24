"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useNet } from "./useNet";

// Mainnet / Testnet toggle in the header. Keeps you on the same page.
export default function NetSwitch() {
  const path = usePathname();
  const { net } = useNet();
  return (
    <span className="net-switch" role="group" aria-label="Network">
      <Link href={path} aria-current={net === "mainnet" ? "true" : undefined}>
        Mainnet
      </Link>
      <Link href={`${path}?net=testnet`} aria-current={net === "testnet" ? "true" : undefined}>
        Testnet
      </Link>
    </span>
  );
}
