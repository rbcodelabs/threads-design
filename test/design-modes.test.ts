import { describe, expect, it } from 'vitest';
import { DESIGN_MODES, isDesignMode, parseDesignModeArgs } from '../src/designModes';

describe('design mode parsing', () => {
  it('lists the supported modes', () => {
    expect(DESIGN_MODES).toEqual(['wireframe', 'states']);
    expect(isDesignMode('states')).toBe(true);
    expect(isDesignMode('States')).toBe(false);
    expect(isDesignMode('foo')).toBe(false);
    expect(isDesignMode(undefined)).toBe(false);
  });

  it.each([
    ['wireframe: a billing settings page', 'wireframe', 'a billing settings page'],
    ['States:   the plan-picker card', 'states', 'the plan-picker card'],
    ['WIREFRAME:checkout', 'wireframe', 'checkout'],
    ['  states :  the plan-picker card  ', 'states', 'the plan-picker card'],
    ['wireframe: line one\nline two', 'wireframe', 'line one\nline two'],
  ] as const)('parses a leading mode keyword with a colon: %j', (args, mode, brief) => {
    expect(parseDesignModeArgs(args)).toEqual({ mode, brief });
  });

  it.each(['wireframe:', 'States:   ', ' wireframe : '])('returns an empty brief for a bare mode %j', args => {
    expect(parseDesignModeArgs(args)).toEqual({ mode: expect.any(String), brief: '' });
  });

  it.each([
    'states of the union dashboard',
    'wireframe a billing page',
    'foo: a billing page',
    'wireframes: a billing page',
    'a page with states: loading and error',
    '',
  ])('treats %j as a plain brief', args => {
    expect(parseDesignModeArgs(args)).toEqual({ brief: args });
  });
});
