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

  it('strips a mode prefix from titles', () => {
    expect(designTitle('Wireframe:  a billing settings page')).toBe('a billing settings page');
    expect(designTitle('states: the plan-picker card')).toBe('the plan-picker card');
    expect(designTitle('states of the union dashboard')).toBe('states of the union dashboard');
    expect(designTitle('wireframe:')).toBe('Design artifact');
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

  describe('kickoff modes', () => {
    const artifact = {
      id: 'design-t', kind: 'design-static' as const, title: 'T', providerId: 'agent-threads.design' as const, schemaVersion: 1 as const,
      storageRoot: '/artifact', root: '/artifact', manifestPath: '/artifact/artifact.json', entryPath: '/artifact/index.html',
      createdAt: 1, updatedAt: 1,
    };

    it('adds no mode section by default', () => {
      const message = designKickoffMessage(artifact, 'Make a dashboard');
      expect(message).toBe(designKickoffMessage(artifact, 'Make a dashboard', undefined));
      expect(message).not.toContain('Mode:');
      expect(message.endsWith('Start now. Edit the artifact files directly, verify the static result, and report what you changed.')).toBe(true);
    });

    it.each([
      ['wireframe', ['Grayscale only', 'labeled gray placeholder boxes', 'never lorem ipsum', 'desktop and mobile', 'reduce it to its wireframe structure']],
      ['states', ['component state sheet', 'focus-visible', 'overflow (very long content)', 'light and dark themes side by side', '.is-hover', 'naming the component']],
    ] as const)('inserts only the %s section into the default message', (mode, phrases) => {
      const base = designKickoffMessage(artifact, 'Make a dashboard');
      const message = designKickoffMessage(artifact, 'Make a dashboard', mode);
      expect(message).toContain(`\n\nMode: ${mode}\nThese mode instructions override the design intent above`);
      for (const phrase of phrases) expect(message).toContain(phrase);
      const section = message.slice(message.indexOf(`Mode: ${mode}`), message.indexOf('Artifact rules:'));
      expect(message.replace(section, '')).toBe(base);
    });
  });
});
