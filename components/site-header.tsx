import { ShieldCheck } from "lucide-react";
import Link from "next/link";

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
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-2 text-xs text-muted-foreground">
          <Link href="/" className="hover:text-foreground hover:underline">
            Public Disciplinary Database
          </Link>
          <Link href="/primitives" className="hover:text-foreground hover:underline">
            Primitives used
          </Link>
        </div>
      </div>
    </header>
  );
}
