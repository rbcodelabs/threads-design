import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandResult, CommandRunner, CommandSpec } from '../src/commandRunner';
import { exportStaticSite, formatIssues, scanNextjsApp, type StaticExportDeps } from '../src/designExport';

let root: string;
let tmpRoot: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'design-export-root-'));
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'design-export-tmp-'));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

async function put(rel: string, content = '') {
  const target = path.join(root, rel);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
}
const kinds = async () => (await scanNextjsApp(root)).map(issue => `${issue.kind}:${issue.file}`).sort();

describe('scanNextjsApp', () => {
  it('passes a clean app with static and statically-parameterised dynamic routes', async () => {
    await put('app/layout.tsx', 'export default function L(){}');
    await put('app/page.tsx', "'use client'; export default function P(){}");
    await put('app/items/page.tsx', 'export default function P(){}');
    await put('app/items/[id]/page.tsx', 'export function generateStaticParams(){return [{id:"1"}]} export default function P(){}');
    await put('app/(marketing)/about/page.tsx', 'export default function P(){}');
    expect(await kinds()).toEqual([]);
  });

  it('returns nothing when there is no app directory', async () => {
    expect(await kinds()).toEqual([]);
  });

  it('reports route handlers', async () => {
    await put('app/api/users/route.ts', 'export async function GET(){}');
    await put('app/page.tsx', 'export default function P(){}');
    expect(await kinds()).toEqual(['route-handler:app/api/users/route.ts']);
  });

  it('reports middleware at the root and under src', async () => {
    await put('middleware.ts', 'export function middleware(){}');
    await put('src/proxy.js', 'export function proxy(){}');
    expect(await kinds()).toEqual(['middleware:middleware.ts', 'middleware:src/proxy.js']);
  });

  it('reports file-level and function-level use server', async () => {
    await put('app/actions.ts', "'use server';\nexport async function save(){}");
    await put('app/form/page.tsx', 'export default function P(){ async function save(){ "use server"; } return null }');
    await put('app/prose.tsx', "// we avoid 'use server' here\nexport const x = 1");
    expect(await kinds()).toEqual(['server-action:app/actions.ts', 'server-action:app/form/page.tsx']);
  });

  it('reports dynamic segments lacking generateStaticParams, including catch-alls', async () => {
    await put('app/blog/[slug]/page.tsx', 'export default function P(){}');
    await put('app/docs/[...path]/page.tsx', 'export default function P(){}');
    await put('app/shop/[[...opt]]/page.tsx', 'export default function P(){}');
    expect(await kinds()).toEqual(['dynamic-segment:app/blog/[slug]', 'dynamic-segment:app/docs/[...path]', 'dynamic-segment:app/shop/[[...opt]]']);
  });

  it('accepts generateStaticParams in a layout or a nested page of the segment', async () => {
    await put('app/a/[id]/layout.tsx', 'export const generateStaticParams = () => []');
    await put('app/a/[id]/page.tsx', 'export default function P(){}');
    await put('app/b/[id]/edit/page.tsx', 'export function generateStaticParams(){return []} export default function P(){}');
    expect(await kinds()).toEqual([]);
  });

  it('ignores node_modules and non-source files', async () => {
    await put('app/node_modules/x/route.ts', '');
    await put('app/notes.md', "'use server'");
    expect(await kinds()).toEqual([]);
  });

  it('formats a bounded issue list', () => {
    const issues = Array.from({ length: 12 }, (_, i) => ({ kind: 'route-handler' as const, file: `app/${i}/route.ts`, message: 'no' }));
    const text = formatIssues(issues);
    expect(text.split('\n')).toHaveLength(11);
    expect(text).toContain('…and 2 more');
  });
});

function exportDeps(run: CommandRunner, overrides: Partial<StaticExportDeps> = {}): StaticExportDeps {
  return {
    run,
    nodeCommand: '/node',
    nextBin: r => path.join(r, 'node_modules/next/dist/bin/next'),
    nodeEnv: { ELECTRON_RUN_AS_NODE: '1' },
    ensureDependencies: vi.fn(async () => {}),
    tmpRoot,
    ...overrides,
  };
}
const okResult: CommandResult = { code: 0, stdout: '', stderr: '', timedOut: false };

/** A fake that behaves like the real tools: next build writes out/ in its cwd, zip writes the archive. */
function fakeTools(opts: { buildCode?: number; buildOutput?: string; writeOut?: boolean; zipOk?: boolean; tarOk?: boolean } = {}) {
  const calls: CommandSpec[] = [];
  const buildTree: string[] = [];
  const run: CommandRunner = async spec => {
    calls.push(spec);
    if (spec.command === '/node') {
      buildTree.push(...(await fs.readdir(spec.cwd, { recursive: true })).map(entry => entry.split(path.sep).join('/')));
      if (opts.buildCode) return { ...okResult, code: opts.buildCode, stderr: opts.buildOutput ?? '' };
      if (opts.writeOut !== false) {
        await fs.mkdir(path.join(spec.cwd, 'out/_next'), { recursive: true });
        await fs.writeFile(path.join(spec.cwd, 'out/index.html'), '<html></html>');
        await fs.writeFile(path.join(spec.cwd, 'out/_next/app.js'), '1');
      }
      return okResult;
    }
    const ok = spec.command === 'zip' ? opts.zipOk !== false : opts.tarOk !== false;
    if (!ok) return { ...okResult, code: 1 };
    await fs.writeFile(spec.args[spec.args.length - 2], 'zip');
    return okResult;
  };
  return { run, calls, buildTree };
}

describe('exportStaticSite', () => {
  it('blocks on scan issues without installing or building', async () => {
    await put('app/api/route.ts', '');
    const { run, calls } = fakeTools();
    const deps = exportDeps(run);
    const outcome = await exportStaticSite({ id: 'a', root }, deps);
    expect(outcome).toMatchObject({ ok: false, message: expect.stringContaining('app/api/route.ts') });
    expect(calls).toEqual([]);
    expect(deps.ensureDependencies).not.toHaveBeenCalled();
  });

  it('builds with the export env, copies out/ to exports/site, and zips', async () => {
    const { run, calls } = fakeTools();
    const deps = exportDeps(run);
    const outcome = await exportStaticSite({ id: 'design-a', root }, deps);
    const buildDir = calls[0].cwd;
    expect(buildDir.startsWith(tmpRoot)).toBe(true);
    expect(deps.ensureDependencies).toHaveBeenCalledWith(buildDir);
    expect(calls[0]).toMatchObject({ command: '/node', args: [path.join(buildDir, 'node_modules/next/dist/bin/next'), 'build', '--webpack'], env: { ELECTRON_RUN_AS_NODE: '1' } });
    const folder = path.join(root, 'exports/site');
    const zip = path.join(root, 'exports/design-a-static.zip');
    expect(outcome).toEqual({ ok: true, folder, zip, warnings: [] });
    expect(await fs.readFile(path.join(folder, 'index.html'), 'utf8')).toBe('<html></html>');
    expect(await fs.readFile(path.join(folder, '_next/app.js'), 'utf8')).toBe('1');
    expect(calls[1]).toMatchObject({ command: 'zip', args: ['-qr', zip, '.'], cwd: folder });
    expect((await fs.stat(zip)).isFile()).toBe(true);
  });

  it('builds in a throwaway copy so the live artifact and its dev server cache are untouched', async () => {
    await put('app/page.tsx', 'export default function P(){}');
    await put('package.json', '{}');
    await put('public/logo.svg', '<svg/>');
    await put('node_modules/dep/index.js', 'x');
    await put('.next/BUILD_ID', 'dev-cache');
    await put('out/stale.html', 'old');
    await put('exports/old.zip', 'old');
    const { run, calls, buildTree } = fakeTools();
    await exportStaticSite({ id: 'a', root }, exportDeps(run));
    expect(buildTree).toEqual(expect.arrayContaining(['app/page.tsx', 'package.json', 'public/logo.svg']));
    expect(buildTree.filter(entry => /^(node_modules|\.next|out|exports)(\/|$)/.test(entry))).toEqual([]);
    expect(await fs.readFile(path.join(root, '.next/BUILD_ID'), 'utf8')).toBe('dev-cache');
    await expect(fs.access(path.join(root, 'out/index.html'))).rejects.toThrow();
    expect(await fs.readdir(tmpRoot)).toEqual([]); // build dir removed
    expect(calls[0].cwd).not.toBe(root);
  });

  it('replaces a previous export instead of merging into it', async () => {
    await put('exports/site/stale.html', 'old');
    const { run } = fakeTools();
    await exportStaticSite({ id: 'a', root }, exportDeps(run));
    await expect(fs.access(path.join(root, 'exports/site/stale.html'))).rejects.toThrow();
  });

  it('falls back to tar when zip is missing', async () => {
    const { run, calls } = fakeTools({ zipOk: false });
    const outcome = await exportStaticSite({ id: 'a', root }, exportDeps(run));
    expect(calls.map(c => c.command)).toEqual(['/node', 'zip', 'tar']);
    expect(outcome).toMatchObject({ ok: true, zip: path.join(root, 'exports/a-static.zip'), warnings: [] });
  });

  it('succeeds with a warning and no zip when no archiver works', async () => {
    const { run } = fakeTools({ zipOk: false, tarOk: false });
    const outcome = await exportStaticSite({ id: 'a', root }, exportDeps(run));
    expect(outcome).toMatchObject({ ok: true, folder: path.join(root, 'exports/site'), zip: undefined });
    expect(outcome.ok && outcome.warnings[0]).toContain('Could not create the zip');
    await fs.access(path.join(root, 'exports/site/index.html'));
  });

  it('reports build failure with the likely cause and the output tail', async () => {
    const { run } = fakeTools({ buildCode: 1, buildOutput: 'Error: Page "/blog/[slug]" is missing "generateStaticParams()" so it cannot be used with "output: export" config.' });
    const outcome = await exportStaticSite({ id: 'a', root }, exportDeps(run));
    expect(outcome.ok).toBe(false);
    const message = !outcome.ok ? outcome.message : '';
    expect(message).toContain('next build failed (exit 1)');
    expect(message).toContain('Likely cause: A dynamic route is missing generateStaticParams()');
    expect(message).toContain('server-only features');
    expect(message).toContain('is missing "generateStaticParams()"');
    await expect(fs.access(path.join(root, 'exports'))).rejects.toThrow();
    expect(await fs.readdir(tmpRoot)).toEqual([]);
  });

  it('reports timeouts and spawn errors distinctly', async () => {
    const timedOut = await exportStaticSite({ id: 'a', root }, exportDeps(async () => ({ ...okResult, code: null, timedOut: true })));
    expect(!timedOut.ok && timedOut.message).toContain('timed out');
    const missing = await exportStaticSite({ id: 'a', root }, exportDeps(async () => ({ ...okResult, code: null, error: 'spawn /node ENOENT' })));
    expect(!missing.ok && missing.message).toContain('could not run next build (spawn /node ENOENT)');
  });

  it('fails when the build succeeds but out/index.html is missing', async () => {
    const { run } = fakeTools({ writeOut: false });
    const outcome = await exportStaticSite({ id: 'a', root }, exportDeps(run));
    expect(!outcome.ok && outcome.message).toContain('out/index.html was not produced');
  });

  it('never mistakes a stale out/ in the artifact for fresh output', async () => {
    await put('out/index.html', 'stale');
    const { run } = fakeTools({ writeOut: false });
    expect((await exportStaticSite({ id: 'a', root }, exportDeps(run))).ok).toBe(false);
  });

  it('returns dependency setup errors', async () => {
    const { run, calls } = fakeTools();
    const outcome = await exportStaticSite({ id: 'a', root }, exportDeps(run, { ensureDependencies: async () => { throw new Error('npm install exited with code 1'); } }));
    expect(outcome).toEqual({ ok: false, message: 'npm install exited with code 1' });
    expect(calls).toEqual([]);
  });
});
