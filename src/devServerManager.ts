import { spawn } from 'node:child_process';
import * as http from 'node:http';
import * as net from 'node:net';

export interface ServerProcess {
  onOutput(listener: (chunk: string) => void): void;
  onExit(listener: (code: number | null) => void): void;
  /** Stops the process and anything it forked. Must be safe to call twice. */
  kill(): void;
}

export interface ServerSpawnSpec { command: string; args: readonly string[]; cwd: string; env: Readonly<Record<string, string>> }

export interface DevServerDeps {
  /** Builds the spawn spec for a dev server on `port`; keeps Next-specific argv out of the manager. */
  commandFor(root: string, port: number): ServerSpawnSpec;
  spawn(spec: ServerSpawnSpec): ServerProcess;
  findFreePort(): Promise<number>;
  /** True once the server answers HTTP at `url` (any status). */
  isReady(url: string): Promise<boolean>;
  sleep(ms: number): Promise<void>;
  /** Runs before the process is spawned, e.g. to link node_modules. Failures abort the start. */
  beforeStart?(root: string): Promise<void>;
  /** Schedules `callback`; returns a cancel function. */
  schedule(callback: () => void, ms: number): () => void;
  readyTimeoutMs?: number;
  pollIntervalMs?: number;
  /** Stops a server nobody has previewed or captured for this long. The host contract has no artifact-close event. */
  idleMs?: number;
}

export interface RunningDevServer { artifactId: string; root: string; port: number; url: string }

export class DevServerError extends Error {
  constructor(message: string, readonly output: string) {
    super(output ? `${message}\n${output}` : message);
    this.name = 'DevServerError';
  }
}

interface Entry extends RunningDevServer {
  process: ServerProcess;
  output: string;
  exited: boolean;
  stopped: boolean;
  cancelIdle?: () => void;
}

const OUTPUT_TAIL = 4000;
const DEFAULT_READY_TIMEOUT_MS = 90_000;
const DEFAULT_POLL_MS = 300;
const DEFAULT_IDLE_MS = 20 * 60_000;

/** Owns one Next.js dev server per artifact id, bound to 127.0.0.1 only. */
export class DevServerManager {
  private readonly servers = new Map<string, Entry>();
  private readonly starting = new Map<string, Promise<RunningDevServer>>();

  constructor(private readonly deps: DevServerDeps) {}

  get(artifactId: string): RunningDevServer | undefined {
    const entry = this.servers.get(artifactId);
    return entry && !entry.exited && !this.starting.has(artifactId) ? this.describe(entry) : undefined;
  }

  /** Returns the running server for the artifact, starting (and waiting for) one if needed. */
  ensure(artifactId: string, root: string): Promise<RunningDevServer> {
    // A server still being started is in `servers` but not ready, so check in-flight starts first.
    const inFlight = this.starting.get(artifactId);
    if (inFlight) return inFlight;
    const running = this.servers.get(artifactId);
    if (running && !running.exited) {
      this.armIdle(running);
      return Promise.resolve(this.describe(running));
    }
    const start = this.start(artifactId, root).finally(() => { this.starting.delete(artifactId); });
    this.starting.set(artifactId, start);
    return start;
  }

  stop(artifactId: string): void {
    const entry = this.servers.get(artifactId);
    if (!entry) return;
    this.servers.delete(artifactId);
    this.terminate(entry);
  }

  stopAll(): void {
    for (const id of [...this.servers.keys()]) this.stop(id);
  }

  private async start(artifactId: string, root: string): Promise<RunningDevServer> {
    if (this.deps.beforeStart) {
      try { await this.deps.beforeStart(root); } catch (error) {
        throw new DevServerError(`Could not prepare the Next.js preview: ${error instanceof Error ? error.message : String(error)}`, '');
      }
    }
    const port = await this.deps.findFreePort();
    const url = `http://127.0.0.1:${port}/`;
    let child: ServerProcess;
    try {
      child = this.deps.spawn(this.deps.commandFor(root, port));
    } catch (error) {
      throw new DevServerError(`Could not start the Next.js dev server: ${error instanceof Error ? error.message : String(error)}`, '');
    }
    const entry: Entry = { artifactId, root, port, url, process: child, output: '', exited: false, stopped: false };
    child.onOutput(chunk => { entry.output = (entry.output + chunk).slice(-OUTPUT_TAIL); });
    child.onExit(() => {
      entry.exited = true;
      entry.cancelIdle?.();
      if (this.servers.get(artifactId) === entry) this.servers.delete(artifactId);
    });
    this.servers.set(artifactId, entry);

    const timeoutMs = this.deps.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
    const pollMs = this.deps.pollIntervalMs ?? DEFAULT_POLL_MS;
    let waited = 0;
    for (;;) {
      if (entry.stopped) throw new DevServerError('The Next.js dev server was stopped before it became ready.', '');
      if (entry.exited) throw new DevServerError('The Next.js dev server exited before it became ready.', entry.output.trim());
      if (await this.deps.isReady(url)) break;
      if (waited >= timeoutMs) {
        this.servers.delete(artifactId);
        this.terminate(entry);
        throw new DevServerError(`The Next.js dev server did not become ready within ${Math.round(timeoutMs / 1000)}s.`, entry.output.trim());
      }
      await this.deps.sleep(pollMs);
      waited += pollMs;
    }
    // The process can die between the last poll and readiness being confirmed.
    if (entry.exited || entry.stopped) throw new DevServerError('The Next.js dev server exited right after starting.', entry.output.trim());
    this.armIdle(entry);
    return this.describe(entry);
  }

  private armIdle(entry: Entry): void {
    entry.cancelIdle?.();
    entry.cancelIdle = this.deps.schedule(() => this.stop(entry.artifactId), this.deps.idleMs ?? DEFAULT_IDLE_MS);
  }

  private terminate(entry: Entry): void {
    entry.stopped = true;
    entry.cancelIdle?.();
    try { entry.process.kill(); } catch { /* already gone */ }
  }

  private describe(entry: Entry): RunningDevServer {
    return { artifactId: entry.artifactId, root: entry.root, port: entry.port, url: entry.url };
  }
}

// ---- Node adapters (not unit tested; exercised by the real smoke run) ----

export function nodeFindFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => (address && typeof address === 'object' ? resolve(address.port) : reject(new Error('No port allocated'))));
    });
  });
}

export function nodeIsReady(url: string): Promise<boolean> {
  return new Promise(resolve => {
    const request = http.get(url, { timeout: 2000 }, response => { response.resume(); resolve(true); });
    request.on('timeout', () => { request.destroy(); resolve(false); });
    request.on('error', () => resolve(false));
  });
}

export function nodeSpawnServer(spec: ServerSpawnSpec): ServerProcess {
  const posix = process.platform !== 'win32';
  // Own process group so the whole `next dev` tree can be signalled at once.
  const child = spawn(spec.command, [...spec.args], { cwd: spec.cwd, env: { ...process.env, ...spec.env }, stdio: ['ignore', 'pipe', 'pipe'], detached: posix, windowsHide: true });
  let exited = false;
  const exitListeners: ((code: number | null) => void)[] = [];
  child.on('exit', code => { exited = true; exitListeners.forEach(listener => listener(code)); });
  child.on('error', () => { if (!exited) { exited = true; exitListeners.forEach(listener => listener(null)); } });
  const signal = (name: NodeJS.Signals): void => {
    try {
      if (posix && child.pid) process.kill(-child.pid, name); else child.kill(name);
    } catch { /* process group already gone */ }
  };
  return {
    onOutput: listener => { child.stdout?.on('data', c => listener(String(c))); child.stderr?.on('data', c => listener(String(c))); },
    onExit: listener => { exitListeners.push(listener); },
    kill: () => {
      if (exited) return;
      signal('SIGTERM');
      const force = setTimeout(() => { if (!exited) signal('SIGKILL'); }, 3000);
      force.unref();
    },
  };
}

export const nodeSchedule = (callback: () => void, ms: number): (() => void) => {
  const timer = setTimeout(callback, ms);
  timer.unref();
  return () => clearTimeout(timer);
};
export const nodeSleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
