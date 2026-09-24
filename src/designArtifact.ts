import * as fs from 'fs/promises';
import * as path from 'path';
import { DESIGN_ARTIFACT_KIND, DESIGN_ARTIFACT_SCHEMA_VERSION, DESIGN_PROVIDER_ID } from './designArtifactProvider';
import { normalizeHostTheme, type HostThemeSnapshot } from './hostTheme';

export { DESIGN_ARTIFACT_SCHEMA_VERSION };

export interface DesignArtifactManifest {
  schemaVersion: typeof DESIGN_ARTIFACT_SCHEMA_VERSION;
  id: string;
  title: string;
  entry: 'index.html';
  runtime: 'static';
  createdByThreadId: string;
  viewport: { preset: 'desktop'; width: 1440; height: 900 };
  permissions: { network: 'none'; clipboard: false };
}

export interface DesignArtifactFs {
  mkdir(target: string, options: { recursive: true }): Promise<unknown>;
  writeFile(target: string, data: string, options?: { flag: 'wx' }): Promise<unknown>;
  rm?(target: string, options: { recursive: true; force: true }): Promise<unknown>;
}

export type DesignPreviewResult = { status: 'opened' } | { status: 'source-revealed' | 'unavailable'; warning: string };

export interface DesignArtifact {
  id: string;
  kind: typeof DESIGN_ARTIFACT_KIND;
  title: string;
  providerId: typeof DESIGN_PROVIDER_ID;
  schemaVersion: typeof DESIGN_ARTIFACT_SCHEMA_VERSION;
  storageRoot: string;
  root: string;
  manifestPath: string;
  entryPath: string;
  createdAt: number;
  updatedAt: number;
  lastCapturePath?: string;
}

const defaultFs: DesignArtifactFs = {
  mkdir: (target, options) => fs.mkdir(target, options),
  writeFile: (target, data, options) => fs.writeFile(target, data, options),
  rm: (target, options) => fs.rm(target, options),
};

export function artifactIdForThread(threadId: string): string {
  const safe = threadId.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return `design-${safe.slice(0, 48) || 'thread'}`;
}

export function designTitle(brief: string): string {
  const firstLine = brief.trim().split(/\r?\n/, 1)[0].replace(/^#+\s*/, '').trim();
  if (!firstLine) return 'Design artifact';
  return firstLine.length <= 120 ? firstLine : `${firstLine.slice(0, 117)}…`;
}

export function designArtifactRoot(vaultRoot: string, threadId: string): string {
  return path.join(vaultRoot, '.geode', 'artifacts', artifactIdForThread(threadId));
}

export function buildDesignManifest(threadId: string, brief: string): DesignArtifactManifest {
  return {
    schemaVersion: DESIGN_ARTIFACT_SCHEMA_VERSION,
    id: artifactIdForThread(threadId),
    title: designTitle(brief),
    entry: 'index.html',
    runtime: 'static',
    createdByThreadId: threadId,
    viewport: { preset: 'desktop', width: 1440, height: 900 },
    permissions: { network: 'none', clipboard: false },
  };
}

function scaffoldHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Preparing your design</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <main class="design-shell" aria-live="polite">
    <div class="design-mark" aria-hidden="true"><span></span><span></span><span></span></div>
    <p class="eyebrow">Agent Threads · Design</p>
    <h1>Preparing your design</h1>
    <p class="status">Turning your brief into a responsive interface.</p>
  </main>
  <script src="app.js"></script>
</body>
</html>
`;
}

function scaffoldCss(theme: HostThemeSnapshot): string {
  return `:root {
  color-scheme: ${theme.mode};
  font-family: ${theme.interfaceFont};
  background: ${theme.background};
  color: ${theme.text};
}
* { box-sizing: border-box; }
body { min-height: 100vh; margin: 0; display: grid; place-items: center; padding: clamp(24px, 6vw, 64px); background: ${theme.background}; }
.design-shell { width: min(420px, 100%); text-align: center; }
.design-mark { width: 34px; height: 34px; margin: 0 auto 20px; display: grid; grid-template-columns: repeat(3, 1fr); align-items: center; gap: 4px; padding: 9px; border: 1px solid ${theme.border}; border-radius: 9px; }
.design-mark span { width: 4px; height: 4px; justify-self: center; border-radius: 50%; background: ${theme.accent}; animation: prepare 1.2s ease-in-out infinite alternate; }
.design-mark span:nth-child(2) { animation-delay: .18s; }
.design-mark span:nth-child(3) { animation-delay: .36s; }
.eyebrow { margin: 0; color: ${theme.accent}; font-size: 11px; font-weight: 600; letter-spacing: .12em; text-transform: uppercase; }
h1 { margin: 10px 0 7px; color: ${theme.text}; font-size: clamp(22px, 5vw, 28px); font-weight: 600; line-height: 1.2; letter-spacing: -.02em; }
.status { margin: 0; color: ${theme.mutedText}; font-size: 14px; line-height: 1.55; }
@keyframes prepare { to { opacity: .28; transform: translateY(2px); } }
@media (prefers-reduced-motion: reduce) { .design-mark span { animation: none; } }
`;
}

const SCAFFOLD_JS = `document.documentElement.dataset.artifactReady = 'true';\n`;

async function writeIfMissing(fileFs: DesignArtifactFs, target: string, content: string): Promise<void> {
  try {
    await fileFs.writeFile(target, content, { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
}

export async function scaffoldDesignArtifact(
  threadId: string,
  root: string,
  brief: string,
  now = Date.now(),
  fileFs: DesignArtifactFs = defaultFs,
  theme: HostThemeSnapshot = normalizeHostTheme('dark', {}),
): Promise<DesignArtifact> {
  const manifest = buildDesignManifest(threadId, brief);
  await fileFs.mkdir(root, { recursive: true });
  await writeIfMissing(fileFs, path.join(root, 'artifact.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeIfMissing(fileFs, path.join(root, 'index.html'), scaffoldHtml());
  await writeIfMissing(fileFs, path.join(root, 'styles.css'), scaffoldCss(theme));
  await writeIfMissing(fileFs, path.join(root, 'app.js'), SCAFFOLD_JS);

  const artifact: DesignArtifact = {
    id: manifest.id,
    kind: DESIGN_ARTIFACT_KIND,
    title: manifest.title,
    providerId: DESIGN_PROVIDER_ID,
    schemaVersion: DESIGN_ARTIFACT_SCHEMA_VERSION,
    // Host-visible so thread deletion can collect it; re-validated by the host
    // against the vault artifact root before it is ever stored or removed.
    storageRoot: root,
    root,
    manifestPath: path.join(root, 'artifact.json'),
    entryPath: path.join(root, manifest.entry),
    createdAt: now,
    updatedAt: now,
  };
  return artifact;
}

export function designKickoffMessage(artifact: DesignArtifact, brief: string): string {
  return `You are working in Agent Threads Design mode.

Create or revise the static UI artifact at:
${artifact.root}

User brief:
${brief.trim()}

Design intent:
- Treat the user brief as requirements and context, not literal page copy. Do not echo the brief as a headline or paste it into the interface.
- Replace the preparation scaffold promptly; it is a temporary loading state, not a design direction.
- Establish appropriate information architecture, realistic content, clear visual hierarchy, and a distinctive visual direction suited to the brief.
- Review and refine both desktop and mobile layouts before finishing.

Artifact rules:
- Treat artifact.json as the host contract; do not change its schemaVersion, id, runtime, thread id, or permissions.
- Build a polished responsive interface using index.html, styles.css, app.js, and local assets only.
- Use external CSS and JavaScript files. Inline JavaScript is blocked by the artifact CSP.
- Do not install packages, start a server, load remote fonts, call network APIs, submit forms, or request clipboard access.
- Keep every asset beneath the artifact root and use relative paths.
- Preserve accessibility: semantic landmarks, keyboard operation, labels, focus states, and sufficient contrast.

Start now. Edit the artifact files directly, verify the static result, and report what you changed.`;
}
