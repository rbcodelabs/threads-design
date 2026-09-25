/**
 * Prompt modes are per-turn instruction variants for the same design artifact.
 * They never change the artifact kind, manifest, or storage.
 */
export const DESIGN_MODES = ['wireframe', 'states', 'variations', 'pick', 'spec'] as const;

export type DesignMode = typeof DESIGN_MODES[number];

export interface ParsedDesignModeArgs {
  mode?: DesignMode;
  brief: string;
}

// The colon is what distinguishes a mode from ordinary prose, so
// "states of the union dashboard" stays a normal brief.
const MODE_PREFIX = new RegExp(`^\\s*(${DESIGN_MODES.join('|')})\\s*:`, 'i');

export function isDesignMode(value: unknown): value is DesignMode {
  return typeof value === 'string' && (DESIGN_MODES as readonly string[]).includes(value);
}

export function parseDesignModeArgs(args: string): ParsedDesignModeArgs {
  const match = MODE_PREFIX.exec(args);
  if (!match) return { brief: args };
  return { mode: match[1].toLowerCase() as DesignMode, brief: args.slice(match[0].length).trim() };
}

export const PICK_EXAMPLE = '/design pick: B';
export const PICK_LETTER_ERROR = `Start with the variation letter — e.g. ${PICK_EXAMPLE}`;

// A single letter A–D, then end or a separator, so "Bold" is not read as "B".
const PICK_LETTER = /^([a-d])(?=$|[\s,:.\-–—])/i;

/** Returns the upper-case variation letter a pick brief starts with, if any. */
export function pickLetter(brief: string): string | undefined {
  return PICK_LETTER.exec(brief.trim())?.[1].toUpperCase();
}
export const PICK_EMPTY_ERROR = `Include the variation letter — e.g. ${PICK_EXAMPLE}`;
export const PICK_WITHOUT_DESIGN_ERROR = 'This thread has no design to pick from. Run /design variations: in a thread with a design first, then pick a letter.';
export const PICK_DISPATCH_ERROR = 'There is nothing to pick from in a new thread. Run /design variations: in an existing design thread first, then /design pick: <letter> there.';

export const SPEC_WITHOUT_DESIGN_ERROR = 'This thread has no design to annotate. Build a design first, then run /design spec: on it.';
export const SPEC_DISPATCH_ERROR = 'There is nothing to annotate in a new thread. Build a design first, then run /design spec: in that thread.';

/** Compact mode list for command descriptions, e.g. "wireframe, states, variations, pick, spec". */
export const DESIGN_MODE_LIST = DESIGN_MODES.join(', ');
