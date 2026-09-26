import { describe, expect, it, vi } from 'vitest';
import { createDesignAgentTool } from '../src/designAgentTool';
import type { DesignService } from '../src/DesignService';
import { DESIGN_MODES, DESIGN_MODE_DESCRIPTIONS } from '../src/designModes';

function fixture() {
  const service = {
    state: vi.fn(async () => ({ hasArtifacts: true, existingTitle: 'Pricing' })),
    prepare: vi.fn(async () => ({ artifact: { title: 'T' }, created: true, instructions: 'kickoff' })) };
  const tool = createDesignAgentTool(service as unknown as DesignService);
  return { service, tool, host: {} as never };
}

describe('EnterDesignMode agent tool', () => {
  it('declares an optional mode enum alongside the required brief', () => {
    const { tool } = fixture();
    const schema = tool.inputSchema as { properties: Record<string, { enum?: string[]; description?: string }>; required: string[] };
    expect(schema.required).toEqual(['brief']);
    expect(schema.properties.mode.enum).toEqual(['wireframe', 'states', 'variations', 'pick', 'spec']);
    expect(schema.properties.mode.description).toMatch(/variations/);
    expect(schema.properties.mode.description).toMatch(/pick/);
    expect(schema.properties.mode.description).toMatch(/wireframe/);
    expect(schema.properties.mode.description).toMatch(/spec/);
  });

  it('builds the mode enum description from the shared per-mode descriptions, so they cannot drift', () => {
    const { tool } = fixture();
    const schema = tool.inputSchema as { properties: Record<string, { description?: string }> };
    const expected = `Optional prompt mode for this turn. ${DESIGN_MODES.map(mode => `"${mode}": ${DESIGN_MODE_DESCRIPTIONS[mode]}`).join(' ')} Omit for a full visual design.`;
    expect(schema.properties.mode.description).toBe(expected);
    for (const mode of DESIGN_MODES) {
      expect(schema.properties.mode.description).toContain(DESIGN_MODE_DESCRIPTIONS[mode]);
    }
  });

  it('passes no mode through when omitted', async () => {
    const { tool, service, host } = fixture();
    const result = await tool.invoke('thread-1', { brief: '  Pricing page ' }, host);
    expect(result.isError).toBeUndefined();
    expect(service.prepare).toHaveBeenCalledWith('thread-1', 'Pricing page', { mode: undefined });
  });

  it.each(['wireframe', 'states', 'variations'] as const)('passes mode %s through to prepare', async mode => {
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

  it.each(['B', 'b', 'B, but use A\'s navigation'])('passes a valid pick brief %j through', async brief => {
    const { tool, service, host } = fixture();
    const result = await tool.invoke('thread-1', { brief, mode: 'pick' }, host);
    expect(result.isError).toBeUndefined();
    expect(service.prepare).toHaveBeenCalledWith('thread-1', brief, { mode: 'pick' });
  });

  it.each(['Bold', 'E', 'the second one'])('rejects pick brief %j without a variation letter', async brief => {
    const { tool, service, host } = fixture();
    const result = await tool.invoke('thread-1', { brief, mode: 'pick' }, host);
    expect(result).toEqual({ content: [{ type: 'text', text: 'Start with the variation letter — e.g. /design pick: B' }], isError: true });
    expect(service.prepare).not.toHaveBeenCalled();
  });

  it('rejects pick when the thread has no design artifact', async () => {
    const { tool, service, host } = fixture();
    service.state.mockResolvedValue({ hasArtifacts: false } as never);
    const result = await tool.invoke('thread-1', { brief: 'B', mode: 'pick' }, host);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('/design variations:');
    expect(service.prepare).not.toHaveBeenCalled();
  });

  it('passes spec through when the thread has a design artifact', async () => {
    const { tool, service, host } = fixture();
    const result = await tool.invoke('thread-1', { brief: 'the pricing page', mode: 'spec' }, host);
    expect(result.isError).toBeUndefined();
    expect(service.prepare).toHaveBeenCalledWith('thread-1', 'the pricing page', { mode: 'spec' });
  });

  it('rejects spec when the thread has no design artifact', async () => {
    const { tool, service, host } = fixture();
    service.state.mockResolvedValue({ hasArtifacts: false } as never);
    const result = await tool.invoke('thread-1', { brief: 'the pricing page', mode: 'spec' }, host);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('This thread has no design to annotate. Build a design first, then run /design spec: on it.');
    expect(service.prepare).not.toHaveBeenCalled();
  });
});
