import { BUILT_WITH } from "@/lib/built-with";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border bg-secondary/40">
      <div className="mx-auto max-w-6xl px-6 py-8 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Public Disciplinary Database</p>
      </div>
      <div className="border-t border-border bg-background">
        <div className="mx-auto max-w-6xl px-6 py-8">
          <p className="mb-4 text-sm font-medium text-foreground">Built with</p>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {BUILT_WITH.map(({ icon: Icon, name, blurb }) => (
              <div key={name} className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-brand" aria-hidden="true" />
                  <span className="text-sm font-medium text-foreground">{name}</span>
                </div>
                <p className="text-xs text-muted-foreground">{blurb}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="border-t border-border px-6 py-4 text-center text-xs text-muted-foreground">
        This is a demo built to illustrate a modernized architecture, inspired by real-world sports-safety disciplinary databases. All records shown are fictional, and this project is not affiliated with or endorsed by any real organization.
      </div>
    </footer>
  );
}
