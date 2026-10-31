import { defineLabels } from '@goblin/labels';
import { z } from 'zod';

/**
 * Goblin Foundry's Labels (ADR-0013): an open vocabulary, so a name is created
 * by first use, and no limit. The Piece owns the rules and the refusal
 * sentences; this Assembly owns where they are stored.
 */
export const ticketLabels = defineLabels({ vocabulary: 'open' });

/**
 * What a body may send: names as typed. Normalising and refusing are the
 * Piece's `judge`, run by the API, so a refusal is the Piece's own sentence.
 */
export const labelsBody = z.array(z.string());

/** The whole set a Ticket should carry after the write (ADR-0004: one intent, never a field edit). */
export const SetLabelsBodySchema = z.strictObject({ labels: labelsBody });
export type SetLabelsBody = z.infer<typeof SetLabelsBodySchema>;
