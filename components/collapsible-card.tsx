"use client";

import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";

// a client component, not a plain server-rendered <details>, because
// open={defaultOpen} as a literal prop means React re-asserts that fixed
// value on every re-render of this component, not just the first one. any
// later re-render - a Suspense boundary elsewhere resolving, hydration
// reconciling, a parent re-rendering for an unrelated reason - would then
// silently snap an open (or user-toggled) section back to defaultOpen. the
// onToggle handler below keeps `open` synced to whatever the details
// element's real current state is, so a re-render has nothing to correct
export function CollapsibleCard({
  title,
  description,
  defaultOpen = true,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="group/collapsible overflow-hidden rounded-xl bg-card text-sm text-card-foreground ring-1 ring-foreground/10"
    >
      <summary className="flex cursor-pointer items-start justify-between gap-2 px-4 py-4 select-none marker:content-none [&::-webkit-details-marker]:hidden">
        <div className="space-y-1">
          <div className="font-heading text-base leading-snug font-medium">{title}</div>
          {description !== undefined && (
            <div className="text-sm text-muted-foreground">{description}</div>
          )}
        </div>
        <ChevronDown
          className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open/collapsible:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="px-4 pb-4">{children}</div>
    </details>
  );
}
