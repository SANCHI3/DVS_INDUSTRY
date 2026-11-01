import { useCallback, useEffect, useState } from "react";

// Section ids are short slugs such as "security" or "security-incidents"
const SECTION_ID = /^[a-z0-9-]{1,64}$/;

function readHash(): string | null {
  const id = decodeURIComponent(window.location.hash.slice(1));
  return SECTION_ID.test(id) ? id : null;
}

/**
 * The open section of a signed-in app, kept in the URL hash (#security) so a
 * reload stays on the same page and the browser's Back button moves between
 * sections. Each section change adds one history entry.
 */
export function useSectionHash(fallback: string): [string, (section: string) => void] {
  const [section, setSectionState] = useState(() => readHash() ?? fallback);

  useEffect(() => {
    const onHashChange = () => setSectionState(readHash() ?? fallback);
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [fallback]);

  const setSection = useCallback((next: string) => {
    setSectionState(next);
    if (readHash() !== next) window.history.pushState(null, "", `#${next}`);
  }, []);

  return [section, setSection];
}

/** Drops the section from the URL, so the next sign-in starts on its home page. */
export function clearSectionHash(): void {
  if (window.location.hash) {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }
}
