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
    expect(api.threads.send).toHaveBeenCalledWith('new-thread', expect.objectContaining({ ownerPluginId: expect.any(String), idempotencyKey: expect.stringMatching(/.+/) }));
    expect(handle.rollback).not.toHaveBeenCalled();
  });

  it('passes the mode into dispatched kickoff instructions and titles from the brief', async () => {
    const { api } = apiHarness();
    const service = new DesignService(api, fileFs);

    await service.dispatch('Billing settings', 'claude', 'wireframe');

    expect(api.threads.beginProvisional).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ title: 'Billing settings' }));
    expect(api.threads.send).toHaveBeenCalledWith('new-thread', expect.objectContaining({ prompt: expect.stringContaining('Mode: wireframe') }));
  });

  it('passes the mode into prepared instructions and defaults to none', async () => {
    const { api } = apiHarness();
    const service = new DesignService(api, fileFs);

    expect((await service.prepare('thread-1', 'Plan picker', { mode: 'states' })).instructions).toContain('Mode: states');
    expect((await service.prepare('thread-1', 'Plan picker')).instructions).not.toContain('Mode:');
  });

  it('keeps the existing artifact title when picking a variation', async () => {
    const { api, artifacts } = apiHarness();
    const service = new DesignService(api, fileFs);
    await service.prepare('thread-1', 'Billing settings');

    const picked = await service.prepare('thread-1', 'B, but use A\'s navigation', { mode: 'pick' });

    expect(picked.created).toBe(false);
    expect(picked.artifact.title).toBe('Billing settings');
    expect(api.artifacts.update).toHaveBeenCalledWith(expect.anything(), 'thread-1', 'design-thread-1', { data: expect.objectContaining({ title: 'Billing settings' }) });
    expect(api.artifacts.update.mock.calls[0][3]).not.toHaveProperty('title');
    expect(picked.instructions).toContain('Mode: pick');
    expect(picked.instructions).toContain('B, but use A\'s navigation');
  });

  it('keeps the existing artifact title when annotating with spec', async () => {
    const { api, artifacts } = apiHarness();
    const service = new DesignService(api, fileFs);
    await service.prepare('thread-1', 'Billing settings');

    const specced = await service.prepare('thread-1', 'the pricing page', { mode: 'spec' });

    expect(specced.created).toBe(false);
    expect(specced.artifact.title).toBe('Billing settings');
    expect(api.artifacts.update).toHaveBeenCalledWith(expect.anything(), 'thread-1', 'design-thread-1', { data: expect.objectContaining({ title: 'Billing settings' }) });
    expect(specced.instructions).toContain('Mode: spec');
  });

  it('captures the host theme only when creating a new artifact', async () => {
    const { api, artifacts } = apiHarness();
    const theme = {
      mode: 'light' as const, background: '#fff', text: '#111', mutedText: '#666',
      accent: '#6750a4', border: '#ddd', interfaceFont: 'system-ui',
    };
    const provideTheme = vi.fn(() => theme);
    const service = new DesignService(api, fileFs, () => {}, provideTheme);

    await service.prepare('thread-1', 'First brief');
    expect(provideTheme).toHaveBeenCalledOnce();

    await service.prepare('thread-1', 'Revision');
    expect(artifacts).toHaveLength(1);
    expect(provideTheme).toHaveBeenCalledOnce();
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

  describe('visible storage', () => {
    it('requests visible allocation named by the slugged title', async () => {
      const { api } = apiHarness();
      const service = new DesignService(api, fileFs);

      await service.prepare('thread-1', 'wireframe: Billing Settings Page!');

      expect(api.artifacts.allocateStorage).toHaveBeenCalledWith('thread-1', 'design-thread-1', { location: 'visible', folderName: 'billing-settings-page' });
    });

    it('falls back to the artifact id when the title yields no slug', async () => {
      const { api } = apiHarness();
      const service = new DesignService(api, fileFs);

      await service.prepare('thread-1', '日本語');

      expect(api.artifacts.allocateStorage).toHaveBeenCalledWith('thread-1', 'design-thread-1', { location: 'visible', folderName: 'design-thread-1' });
    });

    it('uses the path the host returns for scaffold, attach and kickoff', async () => {
      const { api } = apiHarness();
      api.artifacts.allocateStorage.mockResolvedValueOnce({ success: true, status: 'allocated', artifactId: 'design-thread-1', path: '/vault/Artifacts/design/billing-2' });
      const writes: string[] = [];
      const recordingFs: any = { mkdir: vi.fn(async () => {}), writeFile: vi.fn(async (target: string) => { writes.push(target); }), rm: vi.fn(async () => {}) };
      const service = new DesignService(api, recordingFs);

      const prepared = await service.prepare('thread-1', 'Billing');

      expect(prepared.artifact.root).toBe('/vault/Artifacts/design/billing-2');
      expect(prepared.artifact.storageRoot).toBe('/vault/Artifacts/design/billing-2');
      expect(writes.every(target => target.startsWith('/vault/Artifacts/design/billing-2/'))).toBe(true);
      expect(api.artifacts.attach).toHaveBeenCalledWith(expect.anything(), 'thread-1', expect.objectContaining({ storageRoot: '/vault/Artifacts/design/billing-2' }));
      expect(prepared.instructions).toContain('/vault/Artifacts/design/billing-2');
    });

    it.each(['/vault/Studio/pm/billing', '/vault/Artifacts/design/billing'])('does not assume a visible root name (%s)', async hostPath => {
      const { api } = apiHarness();
      api.artifacts.allocateStorage.mockResolvedValueOnce({ success: true, status: 'allocated', artifactId: 'design-thread-1', path: hostPath });
      const service = new DesignService(api, fileFs);

      const prepared = await service.prepare('thread-1', 'Billing');

      expect(api.artifacts.allocateStorage).toHaveBeenCalledWith('thread-1', 'design-thread-1', { location: 'visible', folderName: 'billing' });
      expect(prepared.artifact.root).toBe(hostPath);
    });

    it('still works when an older host ignores the options and returns the hidden path', async () => {
      const { api } = apiHarness();
      api.artifacts.allocateStorage.mockResolvedValueOnce({ success: true, status: 'allocated', artifactId: 'design-thread-1', path: '/vault/.geode/artifacts/design-thread-1' });
      const service = new DesignService(api, fileFs);

      const prepared = await service.prepare('thread-1', 'Billing');

      expect(prepared.created).toBe(true);
      expect(prepared.artifact.root).toBe('/vault/.geode/artifacts/design-thread-1');
    });

    it('removes the host-returned storage when preparation fails', async () => {
      const { api } = apiHarness();
      api.artifacts.allocateStorage.mockResolvedValueOnce({ success: true, status: 'allocated', artifactId: 'design-thread-1', path: '/vault/Artifacts/design/billing' });
      api.artifacts.invokeAction.mockResolvedValueOnce({ status: 'error', message: 'preview failed' });
      const rm = vi.fn(async () => {});
      const service = new DesignService(api, { ...fileFs, rm } as any);

      await expect(service.prepare('thread-1', 'Billing')).rejects.toThrow('preview failed');

      expect(rm).toHaveBeenCalledWith('/vault/Artifacts/design/billing', { recursive: true, force: true });
    });
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
