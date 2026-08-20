import { newId } from '@goblin/schema';
import type { AskedQuestion } from './ask.ts';
import * as db from './db.ts';

/**
 * A phase that needs you.
 *
 * The Agent SDK routes `AskUserQuestion` through `canUseTool`, and that
 * callback may stay pending for as long as it likes: this is where a run
 * genuinely waits. The questions land as rows the board can render, the run and
 * phase go `awaiting_input`, and the answers are handed back as the tool's own
 * `answers` input so the agent reads them as a normal tool result.
 */

export type AskContext = { runId: string; phaseId: string };

const POLL_MS = Number(process.env.WORKER_ANSWER_POLL_MS ?? 2000);

/**
 * Writes the round, waits for every answer, and returns them keyed by question
 * text — the shape `AskUserQuestion` expects in its `answers` input.
 */
export async function askHuman(
  ctx: AskContext, questions: AskedQuestion[], signal?: AbortSignal,
): Promise<Record<string, string>> {
  const ids: string[] = [];
  for (const [seq, q] of questions.entries()) {
    const id = newId('qst');
    await db.insertQuestion({
      id, runId: ctx.runId, phaseId: ctx.phaseId, seq,
      header: q.header ?? '', prompt: q.question,
      options: q.options ?? [], multiSelect: q.multiSelect === true,
    });
    ids.push(id);
    await db.event({
      runId: ctx.runId, phaseId: ctx.phaseId, type: 'question', name: q.header || q.question.slice(0, 60),
      payload: { question_id: id, seq, prompt: q.question, options: q.options ?? [], multi_select: q.multiSelect === true },
    });
  }

  await db.setAwaitingInput(ctx.runId, ctx.phaseId, true);
  try {
    const answered = await waitForAnswers(ids, signal);
    const answers: Record<string, string> = {};
    for (const [i, q] of questions.entries()) {
      const row = answered.find(a => a.id === ids[i]);
      answers[q.question] = row?.answer ?? '';
      await db.event({
        runId: ctx.runId, phaseId: ctx.phaseId, type: 'answer', name: q.header || q.question.slice(0, 60),
        payload: { question_id: ids[i], answer: row?.answer ?? '', answered_by: row?.answered_by ?? null },
      });
    }
    return answers;
  } finally {
    await db.setAwaitingInput(ctx.runId, ctx.phaseId, false);
  }
}

/**
 * Polls rather than listens: the answer arrives through the API from a browser
 * or a phone, and one cheap query every couple of seconds is simpler than a
 * second NOTIFY channel that has to survive a dropped connection.
 */
async function waitForAnswers(ids: string[], signal?: AbortSignal): Promise<db.QuestionRow[]> {
  for (;;) {
    if (signal?.aborted) throw new Error('phase aborted while waiting for answers');
    const rows = await db.questionsById(ids);
    if (rows.length === ids.length && rows.every(r => r.answered_at !== null)) return rows;
    await new Promise(r => setTimeout(r, POLL_MS));
  }
}
