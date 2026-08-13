/**
 * Test-only scripted {@link LLMProvider}. Constructed from an ordered list
 * of turns (each a list of {@link LLMStreamEvent}s); each call to
 * `streamCompletion` replays the next turn and records the request it
 * received, mirroring the recording pattern in
 * `src/repositories/test-support/fake-db.ts`.
 */

import type { LLMCompletionRequest, LLMProvider, LLMStreamEvent } from "@/domain/agent/llm-provider";

export type ScriptedTurn = LLMStreamEvent[];

export class FakeLLMProvider implements LLMProvider {
  readonly model: string;
  /** Every request this provider received, in call order — assert on `.messages`/`.tools` here. */
  readonly requests: LLMCompletionRequest[] = [];
  /** The `signal` argument received alongside each request, positionally aligned with {@link requests}. */
  readonly signals: (AbortSignal | undefined)[] = [];

  private readonly turns: ScriptedTurn[];
  private nextTurnIndex = 0;

  constructor(turns: ScriptedTurn[], options: { model?: string } = {}) {
    this.turns = turns;
    this.model = options.model ?? "fake-model";
  }

  async *streamCompletion(
    request: LLMCompletionRequest,
    signal?: AbortSignal,
  ): AsyncIterable<LLMStreamEvent> {
    this.requests.push(request);
    this.signals.push(signal);
    // Mirrors a real provider: an already-cancelled turn fails fast instead
    // of streaming a response nobody is listening for.
    if (signal?.aborted) {
      throw new Error("The operation was aborted.");
    }
    const turnIndex = this.nextTurnIndex++;
    const turn = this.turns[turnIndex];
    if (!turn) {
      throw new Error(
        `FakeLLMProvider: no scripted turn for call #${turnIndex + 1} (only ${this.turns.length} turn(s) configured).`,
      );
    }
    for (const event of turn) {
      yield event;
    }
  }
}
