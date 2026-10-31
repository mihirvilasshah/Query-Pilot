import type { Metadata } from "next";
import { ExplorerPage } from "@/components/database/explorer-page";

export const metadata: Metadata = { title: "Tables" };

export default async function Page({ searchParams }: { searchParams: Promise<{ v?: string; q?: string }> }) {
  return <ExplorerPage kind="table" searchParams={await searchParams} />;
}
