import type { Metadata } from "next";

import { BUILT_WITH } from "@/lib/built-with";

export const metadata: Metadata = {
  title: "Primitives used - PDD Demo",
  description: "What Vercel primitives this demo uses, and where to see each one.",
};

export default function PrimitivesPage() {
  return (
    <main className="mx-auto max-w-6xl space-y-6 px-6 py-10">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Primitives used</h1>
        <p className="text-sm text-muted-foreground">
          This demo uses four Vercel primitives. Each card below names the section on
          the home page where you can watch it working.
        </p>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        {BUILT_WITH.map(({ icon: Icon, name, withoutIt, blurb, section }) => (
          <div
            key={name}
            className="space-y-3 rounded-xl bg-card p-4 text-sm text-card-foreground ring-1 ring-foreground/10"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Icon className="h-5 w-5 text-brand" aria-hidden="true" />
                <span className="font-heading text-base leading-snug font-medium">
                  {name}
                </span>
              </div>
              <span className="text-xs text-muted-foreground">{section}</span>
            </div>
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Without it:</span> {withoutIt}
            </p>
            <p className="text-sm text-muted-foreground">{blurb}</p>
          </div>
        ))}
      </div>
    </main>
  );
}
