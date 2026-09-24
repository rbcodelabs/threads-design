import { describe, expect, it } from 'vitest';
import { captureHostTheme, normalizeHostTheme } from '../src/hostTheme';

describe('host theme', () => {
  it('preserves safe resolved theme literals', () => {
    expect(normalizeHostTheme('light', {
      background: ' rgb(250, 249, 247) ',
      text: '#222222',
      mutedText: 'oklch(50% 0.02 260)',
      accent: 'hsl(230 40% 50%)',
      border: 'rgba(0, 0, 0, 0.12)',
      interfaceFont: '"Avenir Next", system-ui, sans-serif',
    })).toEqual({
      mode: 'light',
      background: 'rgb(250, 249, 247)',
      text: '#222222',
      mutedText: 'oklch(50% 0.02 260)',
      accent: 'hsl(230 40% 50%)',
      border: 'rgba(0, 0, 0, 0.12)',
      interfaceFont: '"Avenir Next", system-ui, sans-serif',
    });
  });

  it('uses mode-appropriate fallbacks for unresolved or unsafe values', () => {
    const theme = normalizeHostTheme('dark', {
      background: 'var(--background-primary)',
      text: 'red; } body { display: none',
      mutedText: 'url(https://example.com/value)',
      accent: '',
      border: 'transparent',
      interfaceFont: 'system-ui\nbody {}',
    });

    expect(theme).toEqual({
      mode: 'dark',
      background: '#1e1e1e',
      text: '#dcddde',
      mutedText: '#999999',
      accent: '#7f6df2',
      border: '#3a3a3a',
      interfaceFont: 'Inter, ui-sans-serif, system-ui, sans-serif',
    });
  });

  it('does not mistake an inherited probe color for a missing semantic token', () => {
    const values = new Map([
      ['--text-normal', '#eeeeee'],
      ['--text-muted', '#aaaaaa'],
      ['--interactive-accent', '#9988ff'],
      ['--background-modifier-border', '#444444'],
    ]);
    const probe = { style: {} as Record<string, string>, remove: () => {} };
    const rootStyle = {
      colorScheme: 'dark',
      fontFamily: 'system-ui',
      getPropertyValue: (name: string) => values.get(name) ?? '',
    };
    const root = {
      classList: { contains: () => true },
      appendChild: () => {},
      ownerDocument: {
        createElement: () => probe,
        defaultView: {
          getComputedStyle: (element: unknown) => element === root
            ? rootStyle
            : { color: values.get(probe.style.color.slice(4, -1)) ?? 'rgb(0, 0, 0)' },
        },
      },
    };

    expect(captureHostTheme(root as unknown as HTMLElement)).toEqual({
      mode: 'dark',
      background: '#1e1e1e',
      text: '#eeeeee',
      mutedText: '#aaaaaa',
      accent: '#9988ff',
      border: '#444444',
      interfaceFont: 'system-ui',
    });
  });
});
