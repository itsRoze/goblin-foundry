import { z } from 'zod';

/**
 * A Design is a markdown document stored on the thing it describes (ADR-0005):
 * a Project Design or a Ticket Design. Absent is `null`, never `''` — "no
 * design" is one state, so the approve guard, the GUI's empty tile and the
 * history all read it the same way.
 */
export const designField = z.string().nullable();

/** What a body may send. Whitespace-only is the same as absent, and is stored as absent. */
export const designBody = z
  .string()
  .max(200_000)
  .nullable()
  .transform((value) => (value === null || value.trim() === '' ? null : value));

/** The same rule the approve guard applies, for anything that has to ask "is there a design?" without a body in hand. */
export const hasDesign = (design: string | null | undefined): boolean => (design ?? '').trim() !== '';
