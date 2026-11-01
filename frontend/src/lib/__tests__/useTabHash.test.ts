// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useTabHash } from '../useTabHash';

const TABS = ['performance', 'workforce', 'attendance'] as const;

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

describe('useTabHash', () => {
  it('opens the tab named in the address after a reload', () => {
    window.history.replaceState(null, '', '/#production-attendance');
    const { result } = renderHook(() => useTabHash('production', TABS));
    expect(result.current[0]).toBe('attendance');
  });

  it('writes the tab into the address when it changes', () => {
    window.history.replaceState(null, '', '/#production');
    const { result } = renderHook(() => useTabHash('production', TABS));
    expect(result.current[0]).toBe('performance');
    act(() => result.current[1]('workforce'));
    expect(window.location.hash).toBe('#production-workforce');
    expect(result.current[0]).toBe('workforce');
  });

  it('follows Back and falls back for a tab the role cannot see', () => {
    const { result } = renderHook(() => useTabHash('production', ['performance', 'workforce'] as const));
    act(() => {
      window.history.replaceState(null, '', '/#production-workforce');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(result.current[0]).toBe('workforce');
    act(() => {
      window.history.replaceState(null, '', '/#production-attendance');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(result.current[0]).toBe('performance');
  });
});
