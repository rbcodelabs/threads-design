import type { SlashCommandContribution, SlashCommandResult } from './contracts';
import {
  DESIGN_MODE_LIST,
  PICK_DISPATCH_ERROR,
  PICK_EMPTY_ERROR,
  PICK_LETTER_ERROR,
  PICK_WITHOUT_DESIGN_ERROR,
  parseDesignModeArgs,
  pickLetter,
  type DesignMode,
} from './designModes';

export interface DesignSlashCommandDependencies {
  getState(threadId: string): Promise<{ hasArtifacts: boolean; existingTitle?: string } | null> | { hasArtifacts: boolean; existingTitle?: string } | null;
  isDesktopFilesystem(): boolean;
  prepare(threadId: string, brief: string, mode?: DesignMode): Promise<{ artifact: { title: string }; instructions: string }>;
  send(threadId: string, prompt: string): Promise<void>;
  dispatch(brief: string, harness?: 'claude' | 'codex', mode?: DesignMode): Promise<string>;
}

const failure = (message: string): SlashCommandResult => ({ status: 'error', message });
const cancelled = (): SlashCommandResult => failure('Design command was cancelled.');
const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);
const MODE_EXAMPLE = '/design wireframe: a billing settings page';
// Only forward a mode when one was requested so default calls keep their exact shape.
const modeArgs = (mode: DesignMode | undefined): [] | [DesignMode] => mode ? [mode] : [];
const MODE_USAGE = `/design <brief> or /design <mode>: <brief> (${DESIGN_MODE_LIST})`;

/** Design behavior with host adapters; command views know only the contribution contract. */
export function createDesignSlashCommand(deps: DesignSlashCommandDependencies): SlashCommandContribution {
  return {
    name: 'design',
    thread: {
      description: `Create or revise a live static UI artifact: ${MODE_USAGE}`,
      invoke: async (context, host) => {
        if (host.signal.aborted) return cancelled();
        const threadId = context.threadId;
        const state = threadId ? await deps.getState(threadId) : null;
        if (!threadId || !state) return { status: 'ok' };
        const { mode, brief } = parseDesignModeArgs(context.args);
        if (mode === 'pick') {
          // Unlike other modes, pick needs a letter and existing variations; fail before preparing.
          if (!brief) return failure(PICK_EMPTY_ERROR);
          if (!state.hasArtifacts) return failure(PICK_WITHOUT_DESIGN_ERROR);
          if (!pickLetter(brief)) return failure(PICK_LETTER_ERROR);
        }
        if (!brief && !state.hasArtifacts) {
          if (mode) return failure(`Include a brief after the mode — e.g. ${MODE_EXAMPLE}`);
          return failure('Include a brief — e.g. /design a responsive pricing page for a developer tool');
        }
        if (!deps.isDesktopFilesystem()) {
          return failure('Design artifacts require a desktop vault with local filesystem access.');
        }
        let prepared: Awaited<ReturnType<DesignSlashCommandDependencies['prepare']>>;
        try {
          prepared = await deps.prepare(threadId, brief || state.existingTitle || 'Design artifact', ...modeArgs(mode));
        } catch (error) {
          return failure(`Could not prepare the design artifact: ${errorMessage(error)}`);
        }
        if (host.signal.aborted) return cancelled();
        // A bare /design only reopens; a bare mode runs that mode against the existing design.
        if (!brief && !mode) {
          host.report(`Opened design artifact: ${prepared.artifact.title}`);
          return { status: 'ok' };
        }
        host.report(mode
          ? (state.existingTitle !== undefined ? `Revising design artifact in ${mode} mode…` : `Design artifact created. Starting ${mode} design turn…`)
          : (state.existingTitle !== undefined ? 'Revising design artifact…' : 'Design artifact created. Starting design turn…'));
        // Sending starts a long-lived turn. Preparation is the command's
        // transaction boundary; a later session failure keeps the artifact.
        void Promise.resolve().then(() => {
          if (!host.signal.aborted) return deps.send(threadId, prepared.instructions);
        }).catch(error => {
          if (!host.signal.aborted) host.report(`Failed to start design turn: ${errorMessage(error)}`, true);
        });
        return { status: 'ok' };
      },
    },
    dispatch: {
      description: `Dispatch a thread with a live static UI artifact: ${MODE_USAGE}`,
      invoke: async (context, host) => {
        if (host.signal.aborted) return cancelled();
        const { mode, brief } = parseDesignModeArgs(context.args);
        if (mode === 'pick') return failure(brief ? PICK_DISPATCH_ERROR : PICK_EMPTY_ERROR);
        if (mode && !brief) return failure(`Include a brief after the mode — e.g. "${MODE_EXAMPLE}"`);
        if (!brief) return failure('Include a brief — e.g. "/design a responsive pricing page for a developer tool"');
        if (context.hasImages || context.hasAttachment) {
          return failure('Design dispatch does not support attachments yet. Remove them and try again.');
        }
        try {
          await deps.dispatch(brief, context.agentHarness, ...modeArgs(mode));
          return host.signal.aborted ? cancelled() : { status: 'ok' };
        } catch (error) {
          return failure(`Could not create design artifact: ${errorMessage(error)}`);
        }
      },
    },
  };
}
