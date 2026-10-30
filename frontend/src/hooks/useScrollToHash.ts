import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Smoothly scroll to the element named by the URL hash (`/#features`). Landing-page anchors are
 * router links, so they work from any page and again on repeat clicks (each navigation gets a
 * fresh `location.key`). Respects `prefers-reduced-motion`.
 */
export function useScrollToHash(): void {
  const { hash, key } = useLocation();

  useEffect(() => {
    if (!hash) return;
    const target = document.getElementById(decodeURIComponent(hash.slice(1)));
    if (!target) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  }, [hash, key]);
}
