import type { AgentToolContribution } from './contracts';
import type { DesignService } from './DesignService';
import { DESIGN_MODES, DESIGN_MODE_DESCRIPTIONS, PICK_LETTER_ERROR, PICK_WITHOUT_DESIGN_ERROR, SPEC_WITHOUT_DESIGN_ERROR, isDesignMode, pickLetter } from './designModes';

const failure = (text: string) => ({ content: [{ type: 'text' as const, text }], isError: true });

// Built from the shared per-mode descriptions so the tool schema and the
// slash command's autocomplete can never say different things about a mode.
const MODE_ENUM_DESCRIPTION = `Optional prompt mode for this turn. ${DESIGN_MODES.map(mode => `"${mode}": ${DESIGN_MODE_DESCRIPTIONS[mode]}`).join(' ')} Omit for a full visual design.`;

export function createDesignAgentTool(service: DesignService): AgentToolContribution {
  return {
    name: 'EnterDesignMode',
    description: 'Create or reopen a static design artifact for this thread and open its preview.',
    inputSchema: {
      type: 'object',
      properties: {
        brief: { type: 'string', minLength: 1, description: 'The visual design brief or requested revision.' },
        mode: {
          type: 'string',
          enum: [...DESIGN_MODES],
          description: MODE_ENUM_DESCRIPTION,
        },
      },
      required: ['brief'],
      additionalProperties: false,
    },
    alwaysLoad: true,
    requiresApproval: true,
    async invoke(threadId, args) {
      const brief = typeof args.brief === 'string' ? args.brief.trim() : '';
      if (!brief) return failure('A non-empty design brief is required.');
      const mode = args.mode;
      if (mode !== undefined && !isDesignMode(mode)) {
        return failure(`Unknown design mode: ${String(mode)}. Use one of: ${DESIGN_MODES.join(', ')}.`);
      }
      if (mode === 'pick' && !pickLetter(brief)) return failure(PICK_LETTER_ERROR);
      try {
        if (mode === 'pick' && !(await service.state(threadId))?.hasArtifacts) return failure(PICK_WITHOUT_DESIGN_ERROR);
        if (mode === 'spec' && !(await service.state(threadId))?.hasArtifacts) return failure(SPEC_WITHOUT_DESIGN_ERROR);
        const result = await service.prepare(threadId, brief, { mode });
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (error) {
        return failure(error instanceof Error ? error.message : String(error));
      }
    },
  };
}
