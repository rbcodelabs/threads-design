import { describe, expect, it, vi } from 'vitest';
import type { CommandRunner } from '../src/commandRunner';
import { NextjsToolchain, type ToolchainFs } from '../src/nextjsToolchain';

function fakeFs(initial: { files?: string[]; links?: Record<string, string>; dirs?: string[] } = {}) {
  const files = new Set(initial.files ?? []);
  const links = new Map(Object.entries(initial.links ?? {}));
  const dirs = new Set(initial.dirs ?? []);
  const fs: ToolchainFs = {
    mkdir: vi.fn(async (target: string) => { dirs.add(target); }),
    writeFile: vi.fn(async (target: string) => { files.add(target); }),
    lstat: vi.fn(async (target: string) => {
      if (links.has(target)) return { isSymbolicLink: () => true };
      if (dirs.has(target)) return { isSymbolicLink: () => false };
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    }),
    readlink: vi.fn(async (target: string) => links.get(target)!),
    symlink: vi.fn(async (target: string, link: string) => { links.set(link, target); }),
    rm: vi.fn(async (target: string) => {
      links.delete(target); dirs.delete(target);
      for (const f of [...files]) if (f.startsWith(target)) files.delete(f);
      for (const d of [...dirs]) if (d.startsWith(target)) dirs.delete(d);
    }),
    access: vi.fn(async (target: string) => { if (!files.has(target) && !dirs.has(target) && !links.has(target)) throw new Error('ENOENT'); }),
  };
  return { fs, files, links, dirs };
}

const ok: CommandRunner = async () => ({ code: 0, stdout: '', stderr: '', timedOut: false });

function setup(run: CommandRunner = ok, initial?: Parameters<typeof fakeFs>[0]) {
  const f = fakeFs(initial);
  const toolchain = new NextjsToolchain({ cacheDir: '/cache', run, fs: f.fs, platform: 'darwin', nodeCommand: '/node' });
  return { ...f, toolchain, run };
}

describe('NextjsToolchain', () => {
  it('installs the template once into a keyed cache dir and symlinks node_modules', async () => {
    const run = vi.fn(ok);
    const { toolchain, links, files } = setup(run);
    const dir = toolchain.templateDir();
    expect(dir).toMatch(/^\/cache\/[0-9a-f]{12}$/);

    await toolchain.ensureDependencies('/art/a');
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ command: 'npm', cwd: dir, args: expect.arrayContaining(['install']) }));
    expect(files.has(`${dir}/package.json`)).toBe(true);
    expect(links.get('/art/a/node_modules')).toBe(`${dir}/node_modules`);
  });

  it('reuses the shared install across artifacts without reinstalling', async () => {
    const run = vi.fn(ok);
    const { toolchain, links, files, dirs } = setup(run);
    // Simulate the real install side-effect that creates node_modules.
    run.mockImplementation(async () => { dirs.add(`${toolchain.templateDir()}/node_modules`); return { code: 0, stdout: '', stderr: '', timedOut: false }; });
    await toolchain.ensureDependencies('/art/a');
    await toolchain.ensureDependencies('/art/b');
    expect(run).toHaveBeenCalledTimes(1);
    expect(links.get('/art/b/node_modules')).toBe(`${toolchain.templateDir()}/node_modules`);
    expect(files.has(`${toolchain.templateDir()}/.design-template-ready`)).toBe(true);
  });

  it('shares one in-flight install between concurrent callers', async () => {
    let release!: () => void;
    const run = vi.fn(() => new Promise<any>(resolve => { release = () => resolve({ code: 0, stdout: '', stderr: '', timedOut: false }); }));
    const { toolchain } = setup(run);
    const first = toolchain.ensureDependencies('/art/a');
    const second = toolchain.ensureDependencies('/art/b');
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    release();
    await Promise.all([first, second]);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('leaves an artifact-owned real node_modules directory alone', async () => {
    const { toolchain, fs } = setup(ok, { dirs: ['/art/a/node_modules'] });
    await toolchain.ensureDependencies('/art/a');
    expect(fs.symlink).not.toHaveBeenCalled();
  });

  it('repoints a stale symlink', async () => {
    const { toolchain, links } = setup(ok, { links: { '/art/a/node_modules': '/old/cache/node_modules' } });
    await toolchain.ensureDependencies('/art/a');
    expect(links.get('/art/a/node_modules')).toBe(`${toolchain.templateDir()}/node_modules`);
  });

  it('removes a partial install and reports npm output on failure', async () => {
    const run: CommandRunner = vi.fn(async () => ({ code: 1, stdout: '', stderr: 'ERESOLVE boom', timedOut: false }));
    const { toolchain, fs } = setup(run);
    await expect(toolchain.ensureDependencies('/art/a')).rejects.toThrow(/exited with code 1[\s\S]*ERESOLVE boom/);
    expect(fs.rm).toHaveBeenLastCalledWith(toolchain.templateDir(), { recursive: true, force: true });
    expect(fs.symlink).not.toHaveBeenCalled();
  });

  it('explains a missing npm binary', async () => {
    const run: CommandRunner = vi.fn(async () => ({ code: null, stdout: '', stderr: '', timedOut: false, error: 'spawn npm ENOENT' }));
    const { toolchain } = setup(run);
    await expect(toolchain.ensureDependencies('/art/a')).rejects.toThrow('npm installed and on PATH');
  });

  it('retries a fresh install after a failure (no poisoned in-flight promise)', async () => {
    const run = vi.fn<CommandRunner>()
      .mockResolvedValueOnce({ code: 1, stdout: '', stderr: 'x', timedOut: false })
      .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '', timedOut: false });
    const { toolchain } = setup(run);
    await expect(toolchain.ensureDependencies('/art/a')).rejects.toThrow();
    await expect(toolchain.ensureDependencies('/art/a')).resolves.toBeUndefined();
  });

  it('builds the next binary path and node env for Electron', () => {
    const { toolchain } = setup();
    expect(toolchain.nextBin('/art/a')).toBe('/art/a/node_modules/next/dist/bin/next');
    expect(toolchain.nodeCommand).toBe('/node');
    expect(toolchain.nodeEnv).toMatchObject({ ELECTRON_RUN_AS_NODE: '1' });
  });
});
