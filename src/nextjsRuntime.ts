import { nodeCommandRunner, type CommandRunner } from './commandRunner';
import type { NextjsRuntimeDeps } from './designArtifactProvider';
import { exportStaticSite } from './designExport';
import {
  DevServerManager,
  nodeFindFreePort,
  nodeIsReady,
  nodeSchedule,
  nodeSleep,
  nodeSpawnServer,
} from './devServerManager';
import { NextjsToolchain } from './nextjsToolchain';

export interface NextjsRuntime {
  toolchain: NextjsToolchain;
  devServers: DevServerManager;
  provider: NextjsRuntimeDeps;
  /** Stops every dev server; call on plugin unload. */
  dispose(): void;
}

/** Wires the real toolchain, dev-server manager and exporter together. */
export function createNextjsRuntime(options: { cacheDir: string; run?: CommandRunner }): NextjsRuntime {
  const run = options.run ?? nodeCommandRunner();
  const toolchain = new NextjsToolchain({ cacheDir: options.cacheDir, run });
  const devServers = new DevServerManager({
    commandFor: (root, port) => ({
      command: toolchain.nodeCommand,
      args: [toolchain.nextBin(root), 'dev', '--webpack', '-H', '127.0.0.1', '-p', String(port)],
      cwd: root,
      env: toolchain.nodeEnv,
    }),
    spawn: nodeSpawnServer,
    findFreePort: nodeFindFreePort,
    isReady: nodeIsReady,
    sleep: nodeSleep,
    schedule: nodeSchedule,
    beforeStart: root => toolchain.ensureDependencies(root),
  });
  return {
    toolchain,
    devServers,
    provider: {
      devServers,
      exportStatic: artifact => exportStaticSite(artifact, {
        run,
        nodeCommand: toolchain.nodeCommand,
        nextBin: root => toolchain.nextBin(root),
        nodeEnv: toolchain.nodeEnv,
        ensureDependencies: root => toolchain.ensureDependencies(root),
      }),
    },
    dispose: () => devServers.stopAll(),
  };
}
