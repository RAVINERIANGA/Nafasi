import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-lg px-6 py-20">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal">NAFASI</p>
      <h1 className="mt-3 font-display text-4xl text-teal-dark">That page is not in the simulation.</h1>
      <p className="mt-3 text-sm text-ink/70">Sign in, then use the role desk. Referrals, routing, capacity, the on-device queue, and the directory are the screens in this simulation.</p>
      <Link href="/" className="mt-6 inline-flex rounded-full bg-teal px-4 py-2 text-sm font-semibold text-white">
        Back to sign in
      </Link>
    </main>
  );
}
