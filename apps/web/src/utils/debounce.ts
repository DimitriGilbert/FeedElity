import { createEffect, createSignal, onCleanup } from "solid-js";

/**
 * Debounced read-only mirror of a reactive value: the returned signal follows
 * `value`, but only publishes a change once `value` has stayed unchanged for
 * `delayMs`. Pending timers are cleared whenever `value` changes again and on
 * owner disposal (`onCleanup`), so no timer outlives the owning component.
 *
 * This is for user-typed input (search fields): it coalesces keystrokes so a
 * keyed resource refetches once typing settles. It is NOT a background refresh
 * — nothing re-fires on its own; it only reacts to changes of `value`.
 */
export function createDebouncedValue<T>(value: () => T, delayMs: number): () => T {
  const [debounced, setDebounced] = createSignal(value());
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  createEffect(() => {
    const next = value();
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      // Updater form: Solid's setter would treat a bare function-typed value as
      // an updater, so always publish through a lambda regardless of T.
      setDebounced(() => next);
    }, delayMs);
  });

  onCleanup(clearTimer);

  return debounced;
}
