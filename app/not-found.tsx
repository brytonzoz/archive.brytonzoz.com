export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#0b0b0c] px-6 text-center text-white">
      <p className="text-[12px] font-medium uppercase tracking-[0.16em] text-white/40">404</p>
      <h1 className="mt-3 text-balance text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">This page doesn&rsquo;t exist.</h1>
      <a
        href="/"
        className="mt-8 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black transition-transform hover:-translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white/60"
      >
        Back to Bryton Zoz
      </a>
    </main>
  );
}
