export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-2 bg-zinc-50 font-sans dark:bg-black">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        Project Copilot — F0 scaffolding
      </h1>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        See PLAN.md for the full roadmap and SETUP.md to run this locally.
      </p>
    </div>
  );
}
