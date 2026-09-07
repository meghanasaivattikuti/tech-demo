import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-6xl space-y-4 px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="max-w-2xl text-sm text-muted-foreground">
        There is no page at this address. The public record listing is on the home page.
      </p>
      <Link href="/" className="text-sm underline underline-offset-4">
        Back to the Public Disciplinary Database
      </Link>
    </main>
  );
}
