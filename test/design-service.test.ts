import { describe, expect, it, vi } from 'vitest';
import { DesignService } from '../src/DesignService';

function apiHarness() {
  const artifacts: any[] = [];
  const handle = { threadId: 'new-thread', commit: vi.fn(async () => {}), rollback: vi.fn(async () => {}) };
  const api: any = {
    threads: {
      beginProvisional: vi.fn(async () => handle), open: vi.fn(async () => {}),
      send: vi.fn(async () => ({ runId: 'run' })), permissions: vi.fn(async () => ({ effectivePermissionMode: 'default', planApprovalPending: false })),
    },
    artifacts: {
      list: vi.fn(async () => artifacts),
      allocateStorage: vi.fn(async (_threadId: string, artifactId: string) => ({ success: true, status: 'allocated', artifactId, path: `/vault/${artifactId}` })),
      attach: vi.fn(async (_owner: unknown, _threadId: string, ref: unknown) => { artifacts.push(ref); return { success: true }; }),
      update: vi.fn(async () => ({ success: true })),
      invokeAction: vi.fn(async () => ({ status: 'ok' })),
    },
  };
  return { api, handle, artifacts };
}

const fileFs: any = { mkdir: vi.fn(async () => {}), writeFile: vi.fn(async () => {}), rm: vi.fn(async () => {}) };

describe('DesignService', () => {
  it('owns create → scaffold → attach → preview → commit → send', async () => {
    const { api, handle } = apiHarness();
    const service = new DesignService(api, fileFs);

    await expect(service.dispatch('Settings page', 'codex')).resolves.toBe('new-thread');

    expect(api.threads.beginProvisional).toHaveBeenCalled();
    expect(api.artifacts.attach).toHaveBeenCalled();
    expect(api.threads.open).toHaveBeenCalledWith('new-thread');
    expect(api.artifacts.invokeAction).toHaveBeenCalledWith('new-thread', 'design-new-thread', 'preview');
    expect(handle.commit).toHaveBeenCalledOnce();
    expect(api.threads.send).toHaveBeenCalledAfter(handle.commit);
    expect(handle.rollback).not.toHaveBeenCalled();
  });

  it('rolls back the provisional thread and allocated storage before commit', async () => {
    const { api, handle } = apiHarness();
    api.artifacts.invokeAction.mockResolvedValueOnce({ status: 'error', message: 'preview failed' });
    const service = new DesignService(api, fileFs);

    await expect(service.dispatch('Settings page', 'claude')).rejects.toThrow('preview failed');
    expect(handle.rollback).toHaveBeenCalledOnce();
    expect(handle.commit).not.toHaveBeenCalled();
    expect(api.threads.send).not.toHaveBeenCalled();
  });

  it('keeps committed work when kickoff send fails', async () => {
    const { api, handle } = apiHarness();
    api.threads.send.mockRejectedValueOnce(new Error('session unavailable'));
    const report = vi.fn();
    const service = new DesignService(api, fileFs, report);

    await expect(service.dispatch('Settings page', 'claude')).resolves.toBe('new-thread');
    expect(handle.commit).toHaveBeenCalledOnce();
    expect(handle.rollback).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledWith('Failed to start design turn: session unavailable', true);
  });

  it.each([
    [{ effectivePermissionMode: 'plan', planApprovalPending: false }, 'Plan mode'],
    [{ effectivePermissionMode: 'default', planApprovalPending: true }, 'plan approval'],
  ])('rejects restricted in-thread writes before allocation', async (permissions, expected) => {
    const { api } = apiHarness();
    api.threads.permissions.mockResolvedValueOnce(permissions);
    const service = new DesignService(api, fileFs);
    await expect(service.prepare('thread-1', 'Settings')).rejects.toThrow(expected);
    expect(api.artifacts.allocateStorage).not.toHaveBeenCalled();
  });
});
