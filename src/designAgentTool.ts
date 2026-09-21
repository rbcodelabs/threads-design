import type { AgentToolContribution } from './contracts';
import type { DesignService } from './DesignService';

export function createDesignAgentTool(service: DesignService): AgentToolContribution {
  return {
    name: 'EnterDesignMode',
    description: 'Create or reopen a static design artifact for this thread and open its preview.',
    inputSchema: {
      type: 'object',
      properties: { brief: { type: 'string', minLength: 1, description: 'The visual design brief or requested revision.' } },
      required: ['brief'],
      additionalProperties: false,
    },
    alwaysLoad: true,
    requiresApproval: true,
    async invoke(threadId, args) {
      const brief = typeof args.brief === 'string' ? args.brief.trim() : '';
      if (!brief) return { content: [{ type: 'text', text: 'A non-empty design brief is required.' }], isError: true };
      try {
        const result = await service.prepare(threadId, brief);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true };
      }
    },
  };
}
