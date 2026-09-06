import { ShieldCheck } from "lucide-react";

export function SiteHeader() {
  return (
    <header>
      <div className="bg-brand text-brand-foreground">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-4">
          <ShieldCheck className="h-6 w-6" />
          <div>
            <p className="text-sm font-medium leading-tight">Public Disciplinary Database</p>
            <p className="text-xs leading-tight opacity-80">(PDD)</p>
          </div>
        </div>
      </div>
      <div className="border-b border-border bg-muted/40">
        <div className="mx-auto max-w-6xl px-6 py-2 text-xs text-muted-foreground">
          <span>Home</span>
          <span className="px-1.5">/</span>
          <span className="text-foreground">Public Disciplinary Database</span>
        </div>
      </div>
    </header>
  );
}
