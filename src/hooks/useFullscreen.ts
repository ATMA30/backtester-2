import { useEffect, useState } from 'react';

/**
 * Fullscreen state and toggle.
 *
 * `Topbar` read `document.fullscreenElement` inline during render. Nothing
 * subscribed to `fullscreenchange`, so leaving fullscreen with F11 or Escape —
 * the two ways users actually leave it — left the menu entry reading "Quitter
 * le plein écran" until some unrelated state change happened to re-render the
 * bar. The label described a state the document was no longer in.
 *
 * The toggle also lives here so the topbar menu and the keyboard shortcut drive
 * exactly the same code path.
 */

export function isFullscreenActive(): boolean {
  return typeof document !== 'undefined' && document.fullscreenElement !== null;
}

/** Enter or leave fullscreen. Resolves to the state after the call. */
export async function toggleFullscreen(): Promise<boolean> {
  if (typeof document === 'undefined') return false;
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return false;
    }
    await document.documentElement.requestFullscreen();
    return true;
  } catch (error) {
    // Denied by the browser (no user gesture, embedded in an iframe without
    // `allow="fullscreen"`, or unsupported). Report the real state.
    console.warn('[fullscreen] request rejected:', error);
    return isFullscreenActive();
  }
}

/** Reactive fullscreen flag, kept in step with the document. */
export function useIsFullscreen(): boolean {
  const [isFullscreen, setIsFullscreen] = useState(isFullscreenActive);

  useEffect(() => {
    const sync = () => setIsFullscreen(isFullscreenActive());
    document.addEventListener('fullscreenchange', sync);
    // Safari still ships the prefixed event only.
    document.addEventListener('webkitfullscreenchange', sync);
    sync();
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
    };
  }, []);

  return isFullscreen;
}
