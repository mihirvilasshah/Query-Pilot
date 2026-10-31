import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 text-center">
      <p className="text-sm font-medium text-primary">404</p>
      <h1 className="mt-1 text-2xl font-semibold">Page not found</h1>
      <p className="mt-2 text-sm text-muted-foreground">The page does not exist, or you do not have access to it.</p>
      <Button asChild className="mt-6"><Link href="/dashboard">Back to dashboard</Link></Button>
    </main>
  );
}
