import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

// plain <details>/<summary> rather than a client component with useState -
// the "Raw model output" toggle in search-panel.tsx already uses the same
// native element, and this needs no JS at all to open/close, so a server
// component is enough
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
  return (
    <details
      open={defaultOpen}
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
