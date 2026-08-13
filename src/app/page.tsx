import GanttView from "@/components/GanttView";
import { getDemoBoard, type DemoBoard } from "@/lib/demo-board";

function SeedPrompt({ detail }: { detail?: string }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 bg-zinc-50 px-6 text-center font-sans dark:bg-black">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Project Copilot</h1>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        The demo project hasn&apos;t been seeded yet. Run <code>npm run seed</code> and reload.
      </p>
      {detail && <p className="max-w-md text-xs text-zinc-400 dark:text-zinc-600">{detail}</p>}
    </main>
  );
}

/** Resolves the demo board, turning a connection failure into `null` + a message rather than throwing into render. */
async function loadDemoBoard(): Promise<{ board: DemoBoard | null; error?: string }> {
  try {
    return { board: await getDemoBoard() };
  } catch (error) {
    return { board: null, error: error instanceof Error ? error.message : String(error) };
  }
}

export default async function Home() {
  const { board, error } = await loadDemoBoard();

  if (!board) {
    return <SeedPrompt detail={error} />;
  }

  return (
    <main className="flex min-h-screen flex-col gap-4 bg-zinc-50 p-6 font-sans dark:bg-black">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">{board.project.name}</h1>
      <GanttView project={board.project} tasks={board.tasks} />
    </main>
  );
}
