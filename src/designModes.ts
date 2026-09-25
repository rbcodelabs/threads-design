/**
 * Prompt modes are per-turn instruction variants for the same design artifact.
 * They never change the artifact kind, manifest, or storage.
 */
export const DESIGN_MODES = ['wireframe', 'states'] as const;

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
