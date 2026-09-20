import type { AgentHarness, AgentThreadsApiV1, ThreadArtifactRef } from './contracts';
import {
  artifactIdForThread,
  designKickoffMessage,
  designTitle,
  scaffoldDesignArtifact,
  type DesignArtifact,
  type DesignArtifactFs,
} from './designArtifact';
import {
  DESIGN_ACTION_PREVIEW,
  DESIGN_ARTIFACT_KIND,
  DESIGN_ARTIFACT_SCHEMA_VERSION,
  DESIGN_PROVIDER_ID,
  DESIGN_PROVIDER_OWNER,
} from './designArtifactProvider';

export interface PreparedDesign {
  artifact: DesignArtifact;
  created: boolean;
  instructions: string;
}

const message = (error: unknown): string => error instanceof Error ? error.message : String(error);

export class DesignService {
  private readonly pending = new Set<ReturnType<AgentThreadsApiV1['threads']['beginProvisional']> extends Promise<infer T> ? T : never>();

  constructor(
    private readonly api: AgentThreadsApiV1,
    private readonly fileFs: DesignArtifactFs,
    private readonly report: (message: string, isError?: boolean) => void = () => {},
  ) {}

  async state(threadId: string): Promise<{ hasArtifacts: boolean; existingTitle?: string } | null> {
    const thread = await this.api.threads.get(threadId);
    if (!thread) return null;
    const ref = (await this.api.artifacts.list(threadId)).find(item => item.kind === DESIGN_ARTIFACT_KIND);
    return { hasArtifacts: !!ref, existingTitle: ref?.title };
  }

  async prepare(threadId: string, brief: string, checkPermissions = true): Promise<PreparedDesign> {
    if (checkPermissions) {
      const permissions = await this.api.threads.permissions(threadId);
      if (!permissions) throw new Error('Calling thread is unavailable.');
      if (permissions.planApprovalPending) throw new Error('Design mode is unavailable while plan approval is pending.');
      if (permissions.effectivePermissionMode === 'plan') {
        throw new Error('Design mode writes artifact files and is unavailable in read-only Plan mode.');
      }
    }

    const existing = (await this.api.artifacts.list(threadId)).find(ref => ref.kind === DESIGN_ARTIFACT_KIND);
    let artifact: DesignArtifact;
    let created = false;
    let allocatedRoot: string | undefined;
    try {
      if (existing) {
        artifact = existing.data as DesignArtifact;
        artifact = { ...artifact, updatedAt: Date.now() };
        const updated = await this.api.artifacts.update(DESIGN_PROVIDER_OWNER, threadId, existing.id, { data: artifact });
        if (!updated.success) throw new Error(updated.message ?? 'Could not update design artifact.');
      } else {
        const artifactId = artifactIdForThread(threadId);
        const allocation = await this.api.artifacts.allocateStorage(threadId, artifactId);
        if (!allocation.success) throw new Error(allocation.message);
        allocatedRoot = allocation.path;
        artifact = await scaffoldDesignArtifact(threadId, allocation.path, brief, Date.now(), this.fileFs);
        const ref: ThreadArtifactRef = {
          providerId: DESIGN_PROVIDER_ID,
          kind: DESIGN_ARTIFACT_KIND,
          schemaVersion: DESIGN_ARTIFACT_SCHEMA_VERSION,
          id: artifact.id,
          title: artifact.title,
          data: artifact,
          storageRoot: artifact.storageRoot,
        };
        const attached = await this.api.artifacts.attach(DESIGN_PROVIDER_OWNER, threadId, ref);
        if (!attached.success) throw new Error(attached.message ?? 'Could not attach design artifact.');
        created = true;
      }

      await this.api.threads.open(threadId);
      const preview = await this.api.artifacts.invokeAction(threadId, artifact.id, DESIGN_ACTION_PREVIEW);
      if (preview.status === 'error') throw new Error(preview.message);
      if (preview.status === 'warning') this.report(preview.message);
      return { artifact, created, instructions: designKickoffMessage(artifact, brief) };
    } catch (error) {
      if (allocatedRoot) {
        try { await this.fileFs.rm?.(allocatedRoot, { recursive: true, force: true }); } catch { /* host rollback remains authoritative */ }
      }
      throw error;
    }
  }

  async dispatch(brief: string, harness?: AgentHarness): Promise<string> {
    const handle = await this.api.threads.beginProvisional(DESIGN_PROVIDER_OWNER, {
      title: designTitle(brief),
      agentHarness: harness,
      ownerPluginId: DESIGN_PROVIDER_OWNER.pluginId,
    });
    this.pending.add(handle);
    try {
      const prepared = await this.prepare(handle.threadId, brief, false);
      await handle.commit();
      this.pending.delete(handle);
      try {
        await this.api.threads.send(handle.threadId, {
          prompt: prepared.instructions,
          ownerPluginId: DESIGN_PROVIDER_OWNER.pluginId,
        });
      } catch (error) {
        this.report(`Failed to start design turn: ${message(error)}`, true);
      }
      return handle.threadId;
    } catch (error) {
      await handle.rollback();
      this.pending.delete(handle);
      throw error;
    }
  }

  async dispose(): Promise<void> {
    const pending = [...this.pending];
    this.pending.clear();
    await Promise.allSettled(pending.map(handle => handle.rollback()));
  }
}
