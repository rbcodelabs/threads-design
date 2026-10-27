import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createDesignArtifactContribution,
  DESIGN_SOURCE_REVEALED_WARNING,
  previewDesignArtifact,
} from '../src/designArtifactProvider';

const artifact = { root: '/artifact', manifestPath: '/artifact/artifact.json' };

describe('design artifact provider', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reveals source in Obsidian without opening its missing-plugin placeholder', async () => {
    vi.stubGlobal('geode', undefined);
    const host: any = { openView: vi.fn(async () => 'tab'), revealInFolder: vi.fn(async () => true) };
    await expect(previewDesignArtifact(artifact, host)).resolves.toEqual({
      status: 'source-revealed', warning: DESIGN_SOURCE_REVEALED_WARNING,
    });
    expect(host.openView).not.toHaveBeenCalled();
    expect(host.revealInFolder).toHaveBeenCalledWith(artifact.manifestPath);
  });

  it('opens the host-brokered preview when available', async () => {
    vi.stubGlobal('geode', { captureArtifact: vi.fn() });
    const host: any = { openView: vi.fn(async () => 'tab'), revealInFolder: vi.fn() };
    await expect(previewDesignArtifact(artifact, host)).resolves.toEqual({ status: 'opened' });
    expect(host.openView).toHaveBeenCalledWith({ type: 'geode-artifact', state: { root: '/artifact' } });
  });

  it('reveals source when preview placement is unavailable', async () => {
    vi.stubGlobal('geode', { captureArtifact: vi.fn() });
    const host: any = { openView: vi.fn(async () => 'unavailable'), revealInFolder: vi.fn(async () => true) };
    await expect(previewDesignArtifact(artifact, host)).resolves.toEqual({
      status: 'source-revealed', warning: DESIGN_SOURCE_REVEALED_WARNING,
    });
  });

  it('exposes preview, capture, and reveal actions', () => {
    const contribution = createDesignArtifactContribution();
    const presentation = contribution.present({ id: 'a', title: 'A', kind: 'design-static', providerId: 'agent-threads.design', schemaVersion: 1, data: {} });
    expect(presentation.actions.map(action => action.id)).toEqual(['preview', 'capture', 'reveal']);
    expect(presentation.actions[0]).toMatchObject({
      id: 'preview',
      icon: 'eye',
    });
  });
});

const appArtifact = { id: 'design-t', kind: 'design-app', root: '/app', manifestPath: '/app/artifact.json', runtime: 'nextjs' };
const appRef: any = { id: 'design-t', title: 'App', kind: 'design-app', providerId: 'agent-threads.design', schemaVersion: 2, data: appArtifact };
const staticRef: any = { ...appRef, kind: 'design-static', data: { ...appArtifact, kind: 'design-static', runtime: 'static' } };

function nextjsDeps() {
  return {
    devServers: { ensure: vi.fn(async () => ({ artifactId: 'design-t', root: '/app', port: 4100, url: 'http://127.0.0.1:4100/' })) },
    exportStatic: vi.fn(async () => ({ ok: true as const, folder: '/app/exports/site', zip: '/app/exports/design-t-static.zip', warnings: [] as string[] })),
  };
}
const makeHost = (overrides: any = {}): any => ({ openView: vi.fn(async () => 'tab'), revealInFolder: vi.fn(async () => true), updateArtifact: vi.fn(async () => {}), ...overrides });

describe('nextjs artifacts in the provider', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('registers both kinds and adds Export only to design-app cards', () => {
    const contribution = createDesignArtifactContribution(nextjsDeps());
    expect(contribution.kinds).toEqual(['design-static', 'design-app']);
    expect(contribution.present(appRef).actions.map(action => action.id)).toEqual(['preview', 'capture', 'export', 'reveal']);
    expect(contribution.present(appRef).actions.find(action => action.id === 'export')?.label).toBe('Export static HTML');
    expect(contribution.present(staticRef).actions.map(action => action.id)).toEqual(['preview', 'capture', 'reveal']);
  });

  it('previews through the dev server url instead of the folder', async () => {
    vi.stubGlobal('geode', { captureArtifact: vi.fn() });
    const deps = nextjsDeps();
    const host = makeHost();
    const result = await createDesignArtifactContribution(deps).invoke('preview', appRef, host);
    expect(result).toEqual({ status: 'ok' });
    expect(deps.devServers.ensure).toHaveBeenCalledWith('design-t', '/app');
    expect(host.openView).toHaveBeenCalledWith({ type: 'geode-artifact', state: { root: '/app', url: 'http://127.0.0.1:4100/', runtime: 'nextjs' } });
  });

  it('does not start a dev server for static previews', async () => {
    vi.stubGlobal('geode', { captureArtifact: vi.fn() });
    const deps = nextjsDeps();
    const host = makeHost();
    await createDesignArtifactContribution(deps).invoke('preview', staticRef, host);
    expect(deps.devServers.ensure).not.toHaveBeenCalled();
    expect(host.openView).toHaveBeenCalledWith({ type: 'geode-artifact', state: { root: '/app' } });
  });

  it('falls back to revealing source when the host cannot show the url', async () => {
    vi.stubGlobal('geode', { captureArtifact: vi.fn() });
    const host = makeHost({ openView: vi.fn(async () => 'unavailable') });
    const result = await createDesignArtifactContribution(nextjsDeps()).invoke('preview', appRef, host);
    expect(result).toEqual({ status: 'warning', message: DESIGN_SOURCE_REVEALED_WARNING });
    expect(host.revealInFolder).toHaveBeenCalledWith('/app/artifact.json');
  });

  it('surfaces dev server failures as a warning, not an error', async () => {
    const deps = nextjsDeps();
    deps.devServers.ensure.mockRejectedValue(new Error('exited before it became ready\nEADDRINUSE'));
    const host = makeHost();
    const result = await createDesignArtifactContribution(deps).invoke('preview', appRef, host);
    expect(result).toEqual({ status: 'warning', message: 'Could not start the Next.js preview: exited before it became ready\nEADDRINUSE' });
    expect(host.openView).not.toHaveBeenCalled();
  });

  it('warns when the nextjs runtime is unavailable', async () => {
    const result = await createDesignArtifactContribution().invoke('preview', appRef, makeHost());
    expect(result).toMatchObject({ status: 'warning', message: expect.stringContaining('not available') });
  });

  describe('capture', () => {
    afterEach(() => { delete (globalThis as any).geode; });

    it('captures a nextjs artifact from its dev server url and stores the path', async () => {
      const capture = vi.fn(async () => ({ path: '/shots/a.png', width: 1440, height: 900 }));
      (globalThis as any).geode = { captureArtifact: capture };
      const host = makeHost();
      const result = await createDesignArtifactContribution(nextjsDeps()).invoke('capture', appRef, host);
      expect(capture).toHaveBeenCalledWith('/app', { url: 'http://127.0.0.1:4100/' });
      expect(result.status).toBe('ok');
      expect(host.updateArtifact).toHaveBeenCalledWith({ data: expect.objectContaining({ lastCapturePath: '/shots/a.png' }) });
    });

    it('captures static artifacts from the folder only', async () => {
      const capture = vi.fn(async () => ({ path: '/shots/a.png', width: 1, height: 1 }));
      (globalThis as any).geode = { captureArtifact: capture };
      await createDesignArtifactContribution(nextjsDeps()).invoke('capture', staticRef, makeHost());
      expect(capture).toHaveBeenCalledWith('/app');
    });

    it('reports a dev server failure during capture as an error', async () => {
      (globalThis as any).geode = { captureArtifact: vi.fn() };
      const deps = nextjsDeps();
      deps.devServers.ensure.mockRejectedValue(new Error('no port'));
      const result = await createDesignArtifactContribution(deps).invoke('capture', appRef, makeHost());
      expect(result).toEqual({ status: 'error', message: 'Artifact capture failed: no port' });
    });
  });

  describe('export', () => {
    it('exports, records the path, and reveals the folder', async () => {
      const deps = nextjsDeps();
      const host = makeHost();
      const result = await createDesignArtifactContribution(deps).invoke('export', appRef, host);
      expect(result).toEqual({ status: 'ok', message: 'Exported static HTML to /app/exports/site and /app/exports/design-t-static.zip.' });
      expect(deps.exportStatic).toHaveBeenCalledWith(appArtifact);
      expect(host.updateArtifact).toHaveBeenCalledWith({ data: expect.objectContaining({ lastExportPath: '/app/exports/site' }) });
      expect(host.revealInFolder).toHaveBeenCalledWith('/app/exports/site');
    });

    it('surfaces build failures as errors without revealing anything', async () => {
      const deps = nextjsDeps();
      deps.exportStatic.mockResolvedValue({ ok: false, message: 'Static export failed: next build failed (exit 1).' } as any);
      const host = makeHost();
      expect(await createDesignArtifactContribution(deps).invoke('export', appRef, host)).toEqual({ status: 'error', message: 'Static export failed: next build failed (exit 1).' });
      expect(host.revealInFolder).not.toHaveBeenCalled();
      expect(host.updateArtifact).not.toHaveBeenCalled();
    });

    it('downgrades to a warning when zip creation or reveal fails', async () => {
      const deps = nextjsDeps();
      deps.exportStatic.mockResolvedValue({ ok: true, folder: '/app/exports/site', warnings: ['Could not create the zip.'] } as any);
      const host = makeHost({ revealInFolder: vi.fn(async () => false) });
      const result = await createDesignArtifactContribution(deps).invoke('export', appRef, host);
      expect(result).toMatchObject({ status: 'warning', message: expect.stringContaining('Could not create the zip. Could not reveal the export folder.') });
    });

    it('rejects export for static artifacts', async () => {
      const deps = nextjsDeps();
      const result = await createDesignArtifactContribution(deps).invoke('export', staticRef, makeHost());
      expect(result).toMatchObject({ status: 'error', message: expect.stringContaining('only available for Next.js') });
      expect(deps.exportStatic).not.toHaveBeenCalled();
    });

    it('refuses a second concurrent export of the same artifact', async () => {
      const deps = nextjsDeps();
      let release!: () => void;
      deps.exportStatic.mockImplementation(() => new Promise<any>(resolve => { release = () => resolve({ ok: true, folder: '/f', warnings: [] }); }));
      const contribution = createDesignArtifactContribution(deps);
      const first = contribution.invoke('export', appRef, makeHost());
      const second = await contribution.invoke('export', appRef, makeHost());
      expect(second).toMatchObject({ status: 'warning', message: expect.stringContaining('already running') });
      release();
      expect((await first).status).toBe('ok');
    });

    it('converts unexpected exceptions to an error result', async () => {
      const deps = nextjsDeps();
      deps.exportStatic.mockRejectedValue(new Error('EACCES'));
      expect(await createDesignArtifactContribution(deps).invoke('export', appRef, makeHost())).toEqual({ status: 'error', message: 'Static export failed: EACCES' });
    });
  });
});
