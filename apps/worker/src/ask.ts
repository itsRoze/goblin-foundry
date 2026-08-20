/**
 * The shape of a grill round, and the parsing that turns the CLI's
 * `AskUserQuestion` input into it. Pure on purpose: the waiting half lives in
 * `questions.ts`, which touches the database.
 */

export type AskedQuestion = {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options?: { label: string; description?: string }[];
};

/** Parses the tool input the CLI sends for AskUserQuestion. */
export function parseAsk(input: Record<string, unknown>): AskedQuestion[] {
  const raw = Array.isArray(input.questions) ? input.questions : [];
  return raw.flatMap(q => {
    const o = (q ?? {}) as Record<string, unknown>;
    if (typeof o.question !== 'string' || !o.question.trim()) return [];
    const options = Array.isArray(o.options) ? o.options : [];
    return [{
      question: o.question,
      header: typeof o.header === 'string' ? o.header : '',
      multiSelect: o.multiSelect === true,
      options: options.flatMap(opt => {
        const p = (opt ?? {}) as Record<string, unknown>;
        return typeof p.label === 'string'
          ? [{ label: p.label, description: typeof p.description === 'string' ? p.description : '' }]
          : [];
      }),
    }];
  });
}
