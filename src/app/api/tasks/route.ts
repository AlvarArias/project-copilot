/**
 * Read-only tasks endpoint. This is the refetch path F4 will use to pull
 * live updates after the agent edits a task; F2 itself renders server-side
 * via `getDemoBoard()` directly in `src/app/page.tsx`.
 */

import { NextResponse } from "next/server";

import { getDemoBoard } from "@/lib/demo-board";

export const runtime = "nodejs";

/** `GET /api/tasks?projectId=<id>` — `projectId` defaults to the shared demo project. */
export async function GET(request: Request): Promise<NextResponse> {
  const projectId = new URL(request.url).searchParams.get("projectId");
  const board = await getDemoBoard(projectId ?? undefined);

  if (!board) {
    return NextResponse.json(
      {
        error: projectId
          ? `Project ${projectId} was not found.`
          : "The demo project hasn't been seeded yet — run `npm run seed`.",
      },
      { status: 404 },
    );
  }

  return NextResponse.json(board);
}
