import { describe, expect, it, vi } from 'vitest';
import { DevServerManager, type DevServerDeps, type ServerProcess } from '../src/devServerManager';

class FakeProcess implements ServerProcess {
  output: ((chunk: string) => void)[] = [];
  exit: ((code: number | null) => void)[] = [];
  kill = vi.fn(() => { this.emitExit(null); });
  onOutput(listener: (chunk: string) => void) { this.output.push(listener); }
  onExit(listener: (code: number | null) => void) { this.exit.push(listener); }
  emitOutput(chunk: string) { this.output.forEach(listener => listener(chunk)); }
  emitExit(code: number | null) { this.exit.forEach(listener => listener(code)); }
}

function setup(overrides: Partial<DevServerDeps> = {}) {
  const processes: FakeProcess[] = [];
  let nextPort = 4100;
  const timers: { callback: () => void; ms: number; cancelled: boolean }[] = [];
  const ready = { value: true };
  const deps: DevServerDeps = {
    commandFor: (root, port) => ({ command: 'node', args: ['next', 'dev', '-p', String(port)], cwd: root, env: {} }),
    spawn: vi.fn(() => { const p = new FakeProcess(); processes.push(p); return p; }),
    findFreePort: vi.fn(async () => nextPort++),
    isReady: vi.fn(async () => ready.value),
    sleep: vi.fn(async () => {}),
    schedule: vi.fn((callback: () => void, ms: number) => { const t = { callback, ms, cancelled: false }; timers.push(t); return () => { t.cancelled = true; }; }),
    readyTimeoutMs: 1000,
    pollIntervalMs: 100,
    idleMs: 5000,
    ...overrides,
  };
  return { manager: new DevServerManager(deps), deps, processes, timers, ready };
}

describe('DevServerManager', () => {
  it('starts on a free loopback port and returns the url', async () => {
    const { manager, deps, processes } = setup();
    const server = await manager.ensure('a', '/art/a');
    expect(server).toEqual({ artifactId: 'a', root: '/art/a', port: 4100, url: 'http://127.0.0.1:4100/' });
    expect(deps.spawn).toHaveBeenCalledWith({ command: 'node', args: ['next', 'dev', '-p', '4100'], cwd: '/art/a', env: {} });
    expect(deps.isReady).toHaveBeenCalledWith('http://127.0.0.1:4100/');
    expect(processes).toHaveLength(1);
    expect(manager.get('a')).toEqual(server);
  });

  it('reuses a running server', async () => {
    const { manager, deps } = setup();
    const first = await manager.ensure('a', '/art/a');
    const second = await manager.ensure('a', '/art/a');
    expect(second).toEqual(first);
    expect(deps.spawn).toHaveBeenCalledTimes(1);
  });

  it('shares one start between concurrent callers', async () => {
    const { manager, deps, ready } = setup();
    ready.value = false;
    const first = manager.ensure('a', '/art/a');
    const second = manager.ensure('a', '/art/a');
    expect(manager.get('a')).toBeUndefined();
    ready.value = true;
    expect(await first).toEqual(await second);
    expect(deps.spawn).toHaveBeenCalledTimes(1);
  });

  it('tracks servers per artifact on distinct ports', async () => {
    const { manager } = setup();
    const a = await manager.ensure('a', '/art/a');
    const b = await manager.ensure('b', '/art/b');
    expect(a.port).not.toBe(b.port);
  });

  it('polls until ready', async () => {
    const { manager, deps } = setup();
    let attempts = 0;
    vi.mocked(deps.isReady).mockImplementation(async () => ++attempts >= 4);
    await manager.ensure('a', '/art/a');
    expect(deps.isReady).toHaveBeenCalledTimes(4);
    expect(deps.sleep).toHaveBeenCalledWith(100);
  });

  it('kills the process and reports output when readiness times out', async () => {
    const { manager, processes, ready, deps } = setup();
    ready.value = false;
    vi.mocked(deps.sleep).mockImplementationOnce(async () => { processes[0].emitOutput('Error: compile failed'); });
    await expect(manager.ensure('a', '/art/a')).rejects.toThrow(/did not become ready within 1s[\s\S]*compile failed/);
    expect(processes[0].kill).toHaveBeenCalled();
    expect(manager.get('a')).toBeUndefined();
  });

  it('reports output when the process exits before it is ready', async () => {
    const { manager, processes, ready, deps } = setup();
    ready.value = false;
    vi.mocked(deps.sleep).mockImplementation(async () => { processes[0].emitOutput('EADDRINUSE'); processes[0].emitExit(1); });
    await expect(manager.ensure('a', '/art/a')).rejects.toThrow(/exited before it became ready[\s\S]*EADDRINUSE/);
    expect(manager.get('a')).toBeUndefined();
  });

  it('starts a fresh server after the previous one crashed', async () => {
    const { manager, processes, deps } = setup();
    const first = await manager.ensure('a', '/art/a');
    processes[0].emitExit(1);
    expect(manager.get('a')).toBeUndefined();
    const second = await manager.ensure('a', '/art/a');
    expect(second.port).not.toBe(first.port);
    expect(deps.spawn).toHaveBeenCalledTimes(2);
  });

  it('surfaces beforeStart failures without spawning', async () => {
    const { manager, deps } = setup({ beforeStart: vi.fn(async () => { throw new Error('npm install failed'); }) });
    await expect(manager.ensure('a', '/art/a')).rejects.toThrow('Could not prepare the Next.js preview: npm install failed');
    expect(deps.spawn).not.toHaveBeenCalled();
    expect(manager.get('a')).toBeUndefined();
  });

  it('surfaces spawn failures', async () => {
    const { manager } = setup({ spawn: vi.fn(() => { throw new Error('spawn ENOENT'); }) });
    await expect(manager.ensure('a', '/art/a')).rejects.toThrow('Could not start the Next.js dev server: spawn ENOENT');
  });

  it('stop kills one server and allows restarting', async () => {
    const { manager, processes, deps } = setup();
    await manager.ensure('a', '/art/a');
    manager.stop('a');
    expect(processes[0].kill).toHaveBeenCalledOnce();
    expect(manager.get('a')).toBeUndefined();
    await manager.ensure('a', '/art/a');
    expect(deps.spawn).toHaveBeenCalledTimes(2);
  });

  it('stopAll kills every server (plugin unload)', async () => {
    const { manager, processes } = setup();
    await manager.ensure('a', '/art/a');
    await manager.ensure('b', '/art/b');
    manager.stopAll();
    expect(processes.every(process => process.kill.mock.calls.length === 1)).toBe(true);
    expect(manager.get('a')).toBeUndefined();
    expect(manager.get('b')).toBeUndefined();
  });

  it('aborts a start that is stopped while waiting for readiness', async () => {
    const { manager, ready, deps } = setup();
    ready.value = false;
    vi.mocked(deps.sleep).mockImplementation(async () => { manager.stop('a'); });
    await expect(manager.ensure('a', '/art/a')).rejects.toThrow('stopped before it became ready');
  });

  it('stops an idle server and re-arms the idle timer on reuse', async () => {
    const { manager, processes, timers } = setup();
    await manager.ensure('a', '/art/a');
    expect(timers.at(-1)).toMatchObject({ ms: 5000, cancelled: false });
    await manager.ensure('a', '/art/a');
    expect(timers[0].cancelled).toBe(true);
    timers.at(-1)!.callback();
    expect(processes[0].kill).toHaveBeenCalledOnce();
    expect(manager.get('a')).toBeUndefined();
  });
});
