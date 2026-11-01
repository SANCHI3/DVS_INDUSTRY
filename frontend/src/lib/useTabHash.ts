import { useCallback, useEffect, useState } from "react";

function tabFromHash<T extends string>(base: string, tabs: readonly T[]): T | null {
  const hash = decodeURIComponent(window.location.hash.slice(1));
  if (!hash.startsWith(`${base}-`)) return null;
  const sub = hash.slice(base.length + 1);
  return (tabs as readonly string[]).includes(sub) ? (sub as T) : null;
}

/**
 * A tab inside a section, kept in the URL hash as "#<section>-<tab>"
 * (e.g. #production-attendance), so refresh and the Back button keep it.
 * Unknown or missing tabs fall back to the first allowed tab.
 */
export function useTabHash<T extends string>(base: string, tabs: readonly T[]): [T, (tab: T) => void] {
  const first = tabs[0] as T;
  const [tab, setTabState] = useState<T>(() => tabFromHash(base, tabs) ?? first);

  useEffect(() => {
    const onHashChange = () => setTabState(tabFromHash(base, tabs) ?? first);
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
    // `tabs` is a fresh array each render; its contents follow `base` and the role
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, first, tabs.join("|")]);

  const setTab = useCallback((next: T) => {
    setTabState(next);
    const hash = `#${base}-${next}`;
    if (window.location.hash !== hash) window.history.pushState(null, "", hash);
  }, [base]);

  // A tab this role may not see (old link) shows the first one instead
  const shown = (tabs as readonly string[]).includes(tab) ? tab : first;
  return [shown, setTab];
}
