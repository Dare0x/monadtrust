"use client";

// The network a page shows, from ?net= (mainnet unless it says testnet), plus
// a helper that keeps it on links and API calls.

import { useSearchParams } from "next/navigation";
import { NETS, parseNet, type Net } from "@/lib/chain";

export function useNet() {
  const net: Net = parseNet(useSearchParams().get("net"));
  const withNet = (href: string) =>
    net === "mainnet" ? href : `${href}${href.includes("?") ? "&" : "?"}net=${net}`;
  return { net, cfg: NETS[net], withNet };
}
