import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { artifactIdForThread, buildDesignManifest, designKickoffMessage, designTitle, scaffoldDesignArtifact, type DesignArtifactFs } from '../src/designArtifact';
import type { HostThemeSnapshot } from '../src/hostTheme';

describe('design artifact contract', () => {
  it('derives a portable stable artifact id', () => {
    expect(artifactIdForThread('ABC:thread/unsafe')).toBe('design-abc-thread-unsafe');
  });

  it('builds the exact static, networkless v1 manifest', () => {
    expect(buildDesignManifest('thread-1', 'Checkout concept')).toEqual({
      schemaVersion: 1, id: 'design-thread-1', title: 'Checkout concept', entry: 'index.html', runtime: 'static',
      createdByThreadId: 'thread-1', viewport: { preset: 'desktop', width: 1440, height: 900 },
      permissions: { network: 'none', clipboard: false },
    });
  });

  it('bounds titles', () => {
    expect(designTitle(`# ${'x'.repeat(140)}`).length).toBeLessThanOrEqual(120);
    expect(designTitle('')).toBe('Design artifact');
  });

  it('creates the zero-install scaffold inside host-allocated storage', async () => {
    const writes = new Map<string, string>();
    const fileFs: DesignArtifactFs = {
      mkdir: vi.fn(async () => undefined),
      writeFile: vi.fn(async (target, data) => { writes.set(target, data); }),
    };
    const root = '/vault/.geode/artifacts/design-thread-1';
    const artifact = await scaffoldDesignArtifact('thread-1', root, 'Checkout concept', 123, fileFs);
    expect(artifact.root).toBe(root);
    expect([...writes.keys()].map(target => path.basename(target)).sort()).toEqual(['app.js', 'artifact.json', 'index.html', 'styles.css']);
    expect(writes.get(path.join(root, 'index.html'))).toContain('Preparing your design');
    expect(writes.get(path.join(root, 'index.html'))).not.toContain('Checkout concept');
  });

  it('uses the captured host theme for the temporary scaffold', async () => {
    const writes = new Map<string, string>();
    const fileFs: DesignArtifactFs = {
      mkdir: vi.fn(async () => undefined),
      writeFile: vi.fn(async (target, data) => { writes.set(target, data); }),
    };
    const theme: HostThemeSnapshot = {
      mode: 'light',
      background: 'rgb(250, 249, 247)',
      text: 'rgb(34, 34, 34)',
      mutedText: 'rgb(105, 105, 105)',
      accent: 'rgb(74, 92, 160)',
      border: 'rgb(220, 218, 213)',
      interfaceFont: '"Avenir Next", sans-serif',
    };

    await scaffoldDesignArtifact('thread-1', '/artifact', 'Brief', 123, fileFs, theme);

    const css = writes.get('/artifact/styles.css');
    expect(css).toContain('color-scheme: light');
    expect(css).toContain('background: rgb(250, 249, 247)');
    expect(css).toContain('color: rgb(34, 34, 34)');
    expect(css).toContain('font-family: "Avenir Next", sans-serif');
    expect(css).not.toContain('#101217');
    expect(css).not.toContain('box-shadow');
  });

  it('builds harness-neutral instructions with artifact constraints', () => {
    const message = designKickoffMessage({
      id: 'design-t', kind: 'design-static', title: 'T', providerId: 'agent-threads.design', schemaVersion: 1,
      storageRoot: '/artifact', root: '/artifact', manifestPath: '/artifact/artifact.json', entryPath: '/artifact/index.html',
      createdAt: 1, updatedAt: 1,
    }, 'Make a dashboard');
    expect(message).toContain('/artifact');
    expect(message).toContain('Make a dashboard');
    expect(message).toContain('Do not install packages');
    expect(message).toContain('Inline JavaScript is blocked');
    expect(message).not.toContain('Claude Code');
  });
});
