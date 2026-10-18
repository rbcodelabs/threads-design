export interface DesignGuidance {
  path: string;
  content: string;
  truncated: boolean;
}

export interface DesignGuidanceFs {
  readFile(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
}

export type DesignGuidanceReader = (cwd: string) => Promise<DesignGuidance | null>;

export const DESIGN_GUIDANCE_MAX_CHARS = 12000;
export const DESIGN_GUIDANCE_CANDIDATES = ['DESIGN.md', '.claude/DESIGN.md', 'docs/DESIGN.md'] as const;

const join = (dir: string, rel: string): string => (dir.endsWith('/') ? dir : `${dir}/`) + rel;
const parentOf = (dir: string): string | null => {
  const trimmed = dir.length > 1 ? dir.replace(/\/+$/, '') : dir;
  const index = trimmed.lastIndexOf('/');
  if (index < 0) return null;
  const parent = index === 0 ? '/' : trimmed.slice(0, index);
  return parent === trimmed ? null : parent;
};

/** Nearest DESIGN.md (then .claude/, docs/) from cwd upward, stopping after the first directory containing .git. Never throws. */
export async function loadDesignGuidance(cwd: string, fs: DesignGuidanceFs): Promise<DesignGuidance | null> {
  try {
    let dir: string | null = cwd.replace(/\\/g, '/');
    while (dir) {
      for (const candidate of DESIGN_GUIDANCE_CANDIDATES) {
        const file = join(dir, candidate);
        if (!(await fs.exists(file))) continue;
        const raw = await fs.readFile(file);
        if (!raw.trim()) continue;
        const truncated = raw.length > DESIGN_GUIDANCE_MAX_CHARS;
        const content = truncated ? `${raw.slice(0, DESIGN_GUIDANCE_MAX_CHARS)}\n\n[truncated]` : raw;
        return { path: file, content, truncated };
      }
      if (await fs.exists(join(dir, '.git'))) return null;
      dir = parentOf(dir);
    }
  } catch {
    return null;
  }
  return null;
}
