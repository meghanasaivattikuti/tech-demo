"use client";

import { Button } from "@/components/ui/button";

// the page used to surface a raw error if RDS was unreachable at request
// time. this scopes that failure to the page, keeps the header and footer,
// and - the part that matters on a safety registry - says explicitly that a
// failed load is not a statement about any individual
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto max-w-6xl space-y-4 px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">
        Records are temporarily unavailable
      </h1>
      <p className="max-w-2xl text-sm text-muted-foreground">
        The disciplinary records could not be loaded. This is an availability problem,
        not a statement about any individual. A failed or empty page here must not be
        read as evidence that a person is, or is not, sanctioned.
      </p>
      {error.digest !== undefined && (
        <p className="font-mono text-xs text-muted-foreground">
          Reference: {error.digest}
        </p>
      )}
      <Button type="button" onClick={reset}>
        Try again
      </Button>
    </main>
  );
}
