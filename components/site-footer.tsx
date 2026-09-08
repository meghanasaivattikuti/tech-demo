export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border bg-secondary/40">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-8 text-sm text-muted-foreground sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <p className="font-medium text-foreground">Public Disciplinary Database</p>
        </div>
        <nav className="flex gap-6" aria-label="Footer">
          <a href="#" className="hover:text-foreground hover:underline">
            About the Database
          </a>
          <a href="#" className="hover:text-foreground hover:underline">
            Privacy Policy
          </a>
          <a href="#" className="hover:text-foreground hover:underline">
            Contact
          </a>
        </nav>
      </div>
      <div className="border-t border-border px-6 py-4 text-center text-xs text-muted-foreground">
        This is a demo built to illustrate a modernized architecture, inspired by real-world sports-safety disciplinary databases. All records shown are fictional, and this project is not affiliated with or endorsed by any real organization.
      </div>
    </footer>
  );
}
