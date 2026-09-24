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
