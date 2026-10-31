"use client";

import { AlertCircle } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-24 text-center" role="alert">
      <AlertCircle className="mb-3 size-8 text-destructive" />
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="mt-1 text-sm text-muted-foreground">The page could not be loaded. Your data is safe. Try again, and if the problem persists check the server logs{error.digest ? ` (ref ${error.digest})` : ""}.</p>
      <Button className="mt-5" onClick={reset}>Try again</Button>
    </div>
  );
}
