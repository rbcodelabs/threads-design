export type HostThemeMode = 'light' | 'dark';

export interface HostThemeSnapshot {
  mode: HostThemeMode;
  background: string;
  text: string;
  mutedText: string;
  accent: string;
  border: string;
  interfaceFont: string;
}

type ThemeValues = Omit<HostThemeSnapshot, 'mode'>;

const FALLBACKS: Record<HostThemeMode, ThemeValues> = {
  light: {
    background: '#ffffff',
    text: '#2e3338',
    mutedText: '#6b6f76',
    accent: '#6c5ce7',
    border: '#e1e4e8',
    interfaceFont: 'Inter, ui-sans-serif, system-ui, sans-serif',
  },
  dark: {
    background: '#1e1e1e',
    text: '#dcddde',
    mutedText: '#999999',
    accent: '#7f6df2',
    border: '#3a3a3a',
    interfaceFont: 'Inter, ui-sans-serif, system-ui, sans-serif',
  },
};

const SAFE_COLOR = /^(?:#[0-9a-f]{3,8}|(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\([^;{}\n\r]+\)|[a-z]+)$/i;

function safeColor(value: string | undefined, fallback: string): string {
  const candidate = value?.trim() ?? '';
  if (!candidate || candidate.toLowerCase() === 'transparent' || candidate.includes('var(') || candidate.includes('url(')) return fallback;
  return SAFE_COLOR.test(candidate) ? candidate : fallback;
}

function safeFont(value: string | undefined, fallback: string): string {
  const candidate = value?.trim() ?? '';
  if (!candidate || /[;{}\n\r]/.test(candidate) || candidate.includes('var(') || candidate.includes('url(')) return fallback;
  return candidate;
}

export function normalizeHostTheme(mode: HostThemeMode, values: Partial<ThemeValues>): HostThemeSnapshot {
  const fallback = FALLBACKS[mode];
  return {
    mode,
    background: safeColor(values.background, fallback.background),
    text: safeColor(values.text, fallback.text),
    mutedText: safeColor(values.mutedText, fallback.mutedText),
    accent: safeColor(values.accent, fallback.accent),
    border: safeColor(values.border, fallback.border),
    interfaceFont: safeFont(values.interfaceFont, fallback.interfaceFont),
  };
}

function resolveThemeColor(root: HTMLElement, variable: string): string {
  const view = root.ownerDocument.defaultView;
  if (!view) return '';
  if (!view.getComputedStyle(root).getPropertyValue(variable).trim()) return '';
  const probe = root.ownerDocument.createElement('span');
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  probe.style.pointerEvents = 'none';
  probe.style.color = `var(${variable})`;
  root.appendChild(probe);
  try {
    return view.getComputedStyle(probe).color;
  } finally {
    probe.remove();
  }
}

export function captureHostTheme(root: HTMLElement = document.body): HostThemeSnapshot {
  const view = root.ownerDocument.defaultView;
  const rootStyle = view?.getComputedStyle(root);
  const mode: HostThemeMode = root.classList.contains('theme-dark') || rootStyle?.colorScheme.includes('dark')
    ? 'dark'
    : 'light';

  return normalizeHostTheme(mode, {
    background: resolveThemeColor(root, '--background-primary'),
    text: resolveThemeColor(root, '--text-normal'),
    mutedText: resolveThemeColor(root, '--text-muted'),
    accent: resolveThemeColor(root, '--interactive-accent'),
    border: resolveThemeColor(root, '--background-modifier-border'),
    interfaceFont: rootStyle?.fontFamily,
  });
}
