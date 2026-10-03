import { describe, expect, it } from 'vitest';
import { DESIGNS_FOLDER_NAME, designFolderName, isHiddenArtifactPath, slugifyFolderName } from '../src/designStorage';

describe('design storage helpers', () => {
  it('names the visible folder Designs', () => {
    expect(DESIGNS_FOLDER_NAME).toBe('Designs');
  });

  it('slugifies to lowercase kebab-case ASCII', () => {
    expect(slugifyFolderName('Billing Settings Page')).toBe('billing-settings-page');
    expect(slugifyFolderName('  Café — Menü / v2!! ')).toBe('cafe-menu-v2');
    expect(slugifyFolderName('a/b\\c:d')).toBe('a-b-c-d');
    expect(slugifyFolderName('日本語')).toBe('');
    expect(slugifyFolderName('---')).toBe('');
    expect(slugifyFolderName('..')).toBe('');
  });

  it('caps slugs at 60 characters without a trailing dash', () => {
    const slug = slugifyFolderName('word '.repeat(30));
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith('-')).toBe(false);
    expect(slugifyFolderName('x'.repeat(100))).toBe('x'.repeat(60));
  });

  it('falls back to the artifact id when the title has no usable characters', () => {
    expect(designFolderName('Settings page', 'design-t1')).toBe('settings-page');
    expect(designFolderName('日本語', 'design-t1')).toBe('design-t1');
    expect(designFolderName('', 'design-t1')).toBe('design-t1');
  });

  it('detects the hidden artifact area on posix and windows paths', () => {
    expect(isHiddenArtifactPath('/vault/.geode/artifacts/design-x')).toBe(true);
    expect(isHiddenArtifactPath('C:\\vault\\.geode\\artifacts\\design-x')).toBe(true);
    expect(isHiddenArtifactPath('/vault/Designs/design-x')).toBe(false);
    expect(isHiddenArtifactPath('/vault/notes/.geodex/artifacts/x')).toBe(false);
  });
});
