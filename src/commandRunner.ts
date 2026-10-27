import { spawn } from 'node:child_process';

export interface CommandSpec {
  command: string;
  args: readonly string[];
  cwd: string;
  env?: Readonly<Record<string, string>>;
  timeoutMs?: number;
}

export interface CommandResult {
  /** Exit code; null when the process was killed or never started. */
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** Spawn-level failure (for example ENOENT: command not found). */
  error?: string;
}

/** Everything that runs an external command goes through this seam so tests never spawn real processes. */
export type CommandRunner = (spec: CommandSpec) => Promise<CommandResult>;

const MAX_CAPTURE = 64_000;
const keepTail = (current: string, chunk: string): string => {
  const next = current + chunk;
  return next.length > MAX_CAPTURE ? next.slice(next.length - MAX_CAPTURE) : next;
};

export function nodeCommandRunner(): CommandRunner {
  return spec => new Promise<CommandResult>(resolve => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const finish = (result: Omit<CommandResult, 'stdout' | 'stderr' | 'timedOut'>): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ ...result, stdout, stderr, timedOut });
    };
    let timer: NodeJS.Timeout | undefined;
    let child;
    try {
      child = spawn(spec.command, [...spec.args], { cwd: spec.cwd, env: { ...process.env, ...spec.env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (error) {
      finish({ code: null, error: error instanceof Error ? error.message : String(error) });
      return;
    }
    child.stdout?.on('data', chunk => { stdout = keepTail(stdout, String(chunk)); });
    child.stderr?.on('data', chunk => { stderr = keepTail(stderr, String(chunk)); });
    child.on('error', error => finish({ code: null, error: error.message }));
    child.on('close', code => finish({ code }));
    if (spec.timeoutMs) {
      timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, spec.timeoutMs);
    }
  });
}
