/**
 * Publishes an element's height as a CSS custom property on `<html>`.
 *
 * Check-in stacks three independent sticky bars — the app's own top bar, the
 * roster search box, the roster heading — and each one has to know how tall the
 * ones above it are or it pins underneath them, out of sight. Those numbers
 * cannot be written down: the top bar carries the safe-area inset on a notched
 * phone, disappears entirely at `lg` where navigation moves to a sidebar, and
 * grows with the reader's font size. A hard-coded `top-12` is right on exactly
 * one device.
 *
 * So they are measured and handed to CSS, where `position: sticky` can use them
 * directly. Published on the document element rather than through context
 * because the consumers are style values, not React props — a component three
 * levels down sticks itself correctly without anything having to thread an
 * offset to it.
 *
 * A callback ref rather than an effect: the bars being measured are rendered
 * behind guards (no event, still loading), so the node they belong to arrives
 * some renders after the component first mounts, and an effect keyed on the
 * variable name would have run against nothing and never looked again.
 */
import { useCallback, type RefCallback } from 'react';

export function useHeightVar<T extends HTMLElement>(name: string): RefCallback<T> {
  return useCallback(
    (element: T | null) => {
      if (!element) return;

      const root = document.documentElement;
      // `offsetHeight` reads 0 for a `display: none` element, which is exactly
      // what a `lg:hidden` bar should contribute to the offset below it.
      const publish = () => root.style.setProperty(name, `${element.offsetHeight}px`);

      publish();

      // The observer catches content changes; the resize listener catches the
      // breakpoint flip, where the element is hidden rather than resized.
      const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(publish);
      observer?.observe(element);
      window.addEventListener('resize', publish);

      return () => {
        observer?.disconnect();
        window.removeEventListener('resize', publish);
        // Leaving a stale height behind would strand whatever sticks below it.
        root.style.removeProperty(name);
      };
    },
    [name],
  );
}
