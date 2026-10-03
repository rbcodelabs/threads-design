/** Visible vault folder (host-created) that holds one subfolder per design. */
export const DESIGNS_FOLDER_NAME = 'Designs';

/** Longest folder name we request; the host may append a collision suffix. */
export const MAX_FOLDER_NAME_LENGTH = 60;

/**
 * Lowercase kebab-case ASCII slug. Returns '' when nothing usable remains, so
 * callers choose their own fallback. The host re-sanitizes whatever we send;
 * this only keeps requested names readable and predictable.
 */
export function slugifyFolderName(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_FOLDER_NAME_LENGTH)
    .replace(/-+$/g, '');
}

/** Folder name to request for a design: slug of its title, else the artifact id. */
export function designFolderName(title: string, artifactId: string): string {
  return slugifyFolderName(title) || artifactId;
}

/** True for paths in the legacy hidden `.geode/artifacts/` area. */
export function isHiddenArtifactPath(target: string): boolean {
  return `/${target.replace(/\\/g, '/')}/`.includes('/.geode/artifacts/');
}
