import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { CommandRunner } from './commandRunner';

export type ExportIssueKind = 'route-handler' | 'middleware' | 'server-action' | 'dynamic-segment';

export interface ExportIssue {
  kind: ExportIssueKind;
  /** Path relative to the artifact root. */
  file: string;
  message: string;
}

const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/;
const ROUTE_HANDLER = /^route\.[cm]?[jt]sx?$/;
const PAGE_OR_LAYOUT = /^(?:page|layout)\.[cm]?[jt]sx?$/;
const MIDDLEWARE = /^(?:middleware|proxy)\.[cm]?[jt]s$/;
const DYNAMIC_SEGMENT = /^\[{1,2}(?:\.\.\.)?[^\][]+\]{1,2}$/;
// File-level or function-level directive, not a mention in prose.
const USE_SERVER = /(?:^|[{;])[ \t]*['"]use server['"]/m;
const STATIC_PARAMS = /\bgenerateStaticParams\b/;

async function entries(dir: string): Promise<{ name: string; isDirectory: boolean }[]> {
  try {
    return (await fs.readdir(dir, { withFileTypes: true })).map(entry => ({ name: entry.name, isDirectory: entry.isDirectory() }));
  } catch {
    return [];
  }
}

interface SegmentWalk { hasPage: boolean; hasStaticParams: boolean }

/**
 * Pre-export check: finds features that cannot survive `output: 'export'`.
 * Reports every finding rather than stopping at the first one.
 */
export async function scanNextjsApp(root: string): Promise<ExportIssue[]> {
  const issues: ExportIssue[] = [];
  const rel = (target: string): string => path.relative(root, target).split(path.sep).join('/');

  for (const base of [root, path.join(root, 'src')]) {
    for (const entry of await entries(base)) {
      if (!entry.isDirectory && MIDDLEWARE.test(entry.name)) {
        issues.push({ kind: 'middleware', file: rel(path.join(base, entry.name)), message: 'Middleware does not run in a static export.' });
      }
    }
  }

  const walk = async (dir: string): Promise<SegmentWalk> => {
    const result: SegmentWalk = { hasPage: false, hasStaticParams: false };
    for (const entry of await entries(dir)) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory) {
        if (entry.name === 'node_modules') continue;
        const child = await walk(full);
        result.hasPage ||= child.hasPage;
        result.hasStaticParams ||= child.hasStaticParams;
        if (DYNAMIC_SEGMENT.test(entry.name) && child.hasPage && !child.hasStaticParams) {
          issues.push({ kind: 'dynamic-segment', file: rel(full), message: `Dynamic segment "${entry.name}" needs generateStaticParams() in a page or layout.` });
        }
        continue;
      }
      if (!SOURCE_FILE.test(entry.name)) continue;
      if (ROUTE_HANDLER.test(entry.name)) {
        issues.push({ kind: 'route-handler', file: rel(full), message: 'Route handlers (API routes) are not supported by static export.' });
      }
      let content = '';
      try { content = await fs.readFile(full, 'utf8'); } catch { /* unreadable file: skip content checks */ }
      if (USE_SERVER.test(content)) {
        issues.push({ kind: 'server-action', file: rel(full), message: "'use server' (Server Actions) is not supported by static export." });
      }
      if (PAGE_OR_LAYOUT.test(entry.name)) {
        if (/^page\./.test(entry.name)) result.hasPage = true;
        if (STATIC_PARAMS.test(content)) result.hasStaticParams = true;
      }
    }
    return result;
  };

  for (const appDir of [path.join(root, 'app'), path.join(root, 'src', 'app')]) await walk(appDir);
  return issues;
}

export function formatIssues(issues: readonly ExportIssue[]): string {
  return issues.slice(0, 10).map(issue => `- ${issue.file}: ${issue.message}`).join('\n')
    + (issues.length > 10 ? `\n- …and ${issues.length - 10} more` : '');
}

export interface ExportFs {
  rm(target: string, options: { recursive: true; force: true }): Promise<unknown>;
  mkdir(target: string, options: { recursive: true }): Promise<unknown>;
  mkdtemp(prefix: string): Promise<string>;
  cp(source: string, destination: string, options: { recursive: true; filter?: (source: string) => boolean }): Promise<unknown>;
  access(target: string): Promise<unknown>;
}

/** Top-level entries never copied into the throwaway build directory. */
const BUILD_COPY_EXCLUDES = new Set(['node_modules', '.next', 'out', 'exports']);

export interface StaticExportDeps {
  run: CommandRunner;
  nodeCommand: string;
  nextBin(root: string): string;
  nodeEnv: Readonly<Record<string, string>>;
  ensureDependencies(root: string): Promise<void>;
  scan?(root: string): Promise<ExportIssue[]>;
  fs?: ExportFs;
  /** Parent of the throwaway build directory; defaults to the OS temp dir. */
  tmpRoot?: string;
  buildTimeoutMs?: number;
}

export type StaticExportOutcome =
  | { ok: true; folder: string; zip?: string; warnings: string[] }
  | { ok: false; message: string };

const SERVER_FEATURE_HINT = 'Static export fails when the app uses server-only features: route handlers (route.ts), middleware, Server Actions, cookies()/headers(), or dynamic segments without generateStaticParams().';

function buildFailureHint(output: string): string {
  const hints: string[] = [];
  if (/generateStaticParams/i.test(output)) hints.push('A dynamic route is missing generateStaticParams().');
  if (/server actions?|use server/i.test(output)) hints.push('Server Actions are not supported with output: "export".');
  if (/route handler|api route|route\.(?:ts|js)/i.test(output)) hints.push('A route handler (route.ts) is not compatible with static export.');
  if (/cookies|headers\(|dynamic.*(?:force-dynamic|server)|Dynamic server usage/i.test(output)) hints.push('A page reads request-time data (cookies/headers) or forces dynamic rendering.');
  return [...hints, SERVER_FEATURE_HINT].join(' ');
}

const tail = (value: string, length = 1500): string => value.trim().slice(-length);

/**
 * Builds in a throwaway copy of the artifact. `next build` always compiles into
 * `.next`, which would clobber the live preview dev server's cache and leave it
 * serving 500s, so the real folder is never built in place.
 */
export async function exportStaticSite(artifact: { id: string; root: string }, deps: StaticExportDeps): Promise<StaticExportOutcome> {
  const fileFs = deps.fs ?? (fs as unknown as ExportFs);
  const { root } = artifact;

  const issues = await (deps.scan ?? scanNextjsApp)(root);
  if (issues.length > 0) {
    return { ok: false, message: `Export blocked: this app uses features that static export does not support.\n${formatIssues(issues)}\nRemove or replace them with mock data/client state, then export again.` };
  }

  let buildDir: string | undefined;
  try {
    buildDir = await fileFs.mkdtemp(path.join(deps.tmpRoot ?? os.tmpdir(), `design-export-${artifact.id.slice(0, 24)}-`));
    await fileFs.cp(root, buildDir, {
      recursive: true,
      filter: source => !BUILD_COPY_EXCLUDES.has(path.relative(root, source).split(path.sep)[0]),
    });
    return await buildAndPublish(artifact, buildDir, deps, fileFs);
  } catch (error) {
    return { ok: false, message: `Static export failed: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    if (buildDir) await fileFs.rm(buildDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function buildAndPublish(artifact: { id: string; root: string }, buildDir: string, deps: StaticExportDeps, fileFs: ExportFs): Promise<StaticExportOutcome> {
  try {
    await deps.ensureDependencies(buildDir);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }

  const outDir = path.join(buildDir, 'out');
  const build = await deps.run({
    command: deps.nodeCommand,
    args: [deps.nextBin(buildDir), 'build', '--webpack'],
    cwd: buildDir,
    env: deps.nodeEnv,
    timeoutMs: deps.buildTimeoutMs ?? 5 * 60_000,
  });
  if (build.error || build.timedOut || build.code !== 0) {
    const output = tail(`${build.stdout}\n${build.stderr}`);
    const reason = build.error ? `could not run next build (${build.error})` : build.timedOut ? 'next build timed out' : `next build failed (exit ${build.code})`;
    return { ok: false, message: `Static export failed: ${reason}.\n${build.error ? '' : `Likely cause: ${buildFailureHint(output)}\n`}${output}`.trimEnd() };
  }
  try {
    await fileFs.access(path.join(outDir, 'index.html'));
  } catch {
    return { ok: false, message: 'Static export failed: the build finished but out/index.html was not produced. Check that next.config.mjs still sets output: "export".' };
  }

  const exportsDir = path.join(artifact.root, 'exports');
  const folder = path.join(exportsDir, 'site');
  const zip = path.join(exportsDir, `${artifact.id}-static.zip`);
  await fileFs.mkdir(exportsDir, { recursive: true });
  await fileFs.rm(folder, { recursive: true, force: true });
  await fileFs.rm(zip, { recursive: true, force: true });
  await fileFs.cp(outDir, folder, { recursive: true });

  const warnings: string[] = [];
  let zipped = false;
  for (const [command, args] of [['zip', ['-qr', zip, '.']], ['tar', ['-a', '-c', '-f', zip, '.']]] as const) {
    const result = await deps.run({ command, args, cwd: folder, timeoutMs: 120_000 });
    if (!result.error && !result.timedOut && result.code === 0) { zipped = true; break; }
    await fileFs.rm(zip, { recursive: true, force: true });
  }
  if (!zipped) warnings.push('Could not create the zip (no working zip or tar found); the exported folder is complete.');
  return { ok: true, folder, zip: zipped ? zip : undefined, warnings };
}
