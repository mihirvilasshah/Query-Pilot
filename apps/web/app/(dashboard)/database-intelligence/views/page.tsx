import type { Metadata } from "next";
import { ExplorerPage } from "@/components/database/explorer-page";

export const metadata: Metadata = { title: "Views" };

export default async function Page({ searchParams }: { searchParams: Promise<{ v?: string; q?: string }> }) {
  return <ExplorerPage kind="view" searchParams={await searchParams} />;
}
