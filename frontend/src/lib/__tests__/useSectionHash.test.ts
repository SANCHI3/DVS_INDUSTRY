// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { clearSectionHash, useSectionHash } from '../useSectionHash';

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

describe('useSectionHash', () => {
  it('starts on the fallback when the URL has no section', () => {
    const { result } = renderHook(() => useSectionHash('dashboard'));
    expect(result.current[0]).toBe('dashboard');
  });

  it('restores the section from the URL after a reload', () => {
    window.history.replaceState(null, '', '/#security');
    const { result } = renderHook(() => useSectionHash('dashboard'));
    expect(result.current[0]).toBe('security');
  });

  it('writes the section to the URL when it changes', () => {
    const { result } = renderHook(() => useSectionHash('dashboard'));
    act(() => result.current[1]('reports'));
    expect(result.current[0]).toBe('reports');
    expect(window.location.hash).toBe('#reports');
  });

  it('follows the URL when Back changes the hash', () => {
    const { result } = renderHook(() => useSectionHash('dashboard'));
    act(() => {
      window.history.replaceState(null, '', '/#inventory');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(result.current[0]).toBe('inventory');
  });

  it('ignores a hash that is not a section id', () => {
    window.history.replaceState(null, '', '/#<script>');
    const { result } = renderHook(() => useSectionHash('dashboard'));
    expect(result.current[0]).toBe('dashboard');
  });

  it('clears the section on sign-out', () => {
    window.history.replaceState(null, '', '/?x=1#security');
    clearSectionHash();
    expect(window.location.hash).toBe('');
    expect(window.location.search).toBe('?x=1');
  });
});
