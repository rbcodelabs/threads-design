import { describe, expect, it, vi } from 'vitest';
import { createDesignAgentTool } from '../src/designAgentTool';
import type { DesignService } from '../src/DesignService';

function fixture() {
  const service = { prepare: vi.fn(async () => ({ artifact: { title: 'T' }, created: true, instructions: 'kickoff' })) };
  const tool = createDesignAgentTool(service as unknown as DesignService);
  return { service, tool, host: {} as never };
}

describe('EnterDesignMode agent tool', () => {
  it('declares an optional mode enum alongside the required brief', () => {
    const { tool } = fixture();
    const schema = tool.inputSchema as { properties: Record<string, { enum?: string[]; description?: string }>; required: string[] };
    expect(schema.required).toEqual(['brief']);
    expect(schema.properties.mode.enum).toEqual(['wireframe', 'states']);
    expect(schema.properties.mode.description).toMatch(/wireframe/);
  });

  it('passes no mode through when omitted', async () => {
    const { tool, service, host } = fixture();
    const result = await tool.invoke('thread-1', { brief: '  Pricing page ' }, host);
    expect(result.isError).toBeUndefined();
    expect(service.prepare).toHaveBeenCalledWith('thread-1', 'Pricing page', { mode: undefined });
  });

  it.each(['wireframe', 'states'] as const)('passes mode %s through to prepare', async mode => {
    const { tool, service, host } = fixture();
    await tool.invoke('thread-1', { brief: 'Pricing page', mode }, host);
    expect(service.prepare).toHaveBeenCalledWith('thread-1', 'Pricing page', { mode });
  });

  it.each(['hifi', 'Wireframe', 3, null])('rejects unknown mode %j without preparing', async mode => {
    const { tool, service, host } = fixture();
    const result = await tool.invoke('thread-1', { brief: 'Pricing page', mode }, host);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unknown design mode');
    expect(service.prepare).not.toHaveBeenCalled();
  });

  it('still requires a non-empty brief', async () => {
    const { tool, service, host } = fixture();
    const result = await tool.invoke('thread-1', { brief: ' ', mode: 'states' }, host);
    expect(result).toMatchObject({ isError: true });
    expect(service.prepare).not.toHaveBeenCalled();
  });
});
