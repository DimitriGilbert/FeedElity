/**
 * Pure keymap for the app-shell keyboard shortcuts (qol-features-plan.md F3).
 * Decision D5: no Space binding — cross-origin embeds cannot receive it and a
 * native-only binding would be inconsistent. Every function in this module is
 * side-effect free and unit-tested; the single window keydown listener that
 * consumes the resolved actions lives in app-shell.tsx.
 */

export type ShortcutAction =
  | "move-down"
  | "move-up"
  | "open-active"
  | "focus-creator-search"
  | "clear-selection"
  | "toggle-favorite"
  | "go-library"
  | "go-catalog";

/** Structural subset of KeyboardEvent the keymap reads. */
export interface ShortcutKeyEvent {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
}

/**
 * Resolves a keydown into a shortcut action. "g" (only when the prefix is not
 * already armed) arms the two-letter g prefix and returns null; while armed,
 * only "l" (library) and "c" (catalog) match — every other key is a
 * non-matching follow-up that cancels the prefix (see nextGoPrefixActive) and
 * fires nothing. Modifier chords (ctrl/meta/alt) never resolve.
 */
export function resolveShortcut(event: ShortcutKeyEvent, gPrefixActive: boolean): ShortcutAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return null;
  }

  if (gPrefixActive) {
    if (event.key === "l") {
      return "go-library";
    }
    if (event.key === "c") {
      return "go-catalog";
    }
    return null;
  }

  switch (event.key) {
    case "j":
    case "J":
      return "move-down";
    case "k":
    case "K":
      return "move-up";
    case "Enter":
      return "open-active";
    case "/":
      return "focus-creator-search";
    case "Escape":
      return "clear-selection";
    case "f":
      return "toggle-favorite";
    default:
      return null;
  }
}

/**
 * Next state of the g prefix after a keydown: a bare "g" arms it; anything
 * else (a consumed l/c follow-up, a non-matching follow-up, or a modifier
 * chord) disarms it. Pair with resolveShortcut so the prefix lifecycle stays
 * pure and testable.
 */
export function nextGoPrefixActive(event: ShortcutKeyEvent, gPrefixActive: boolean): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return false;
  }

  return !gPrefixActive && event.key === "g";
}

/**
 * True when the keydown target is a text-entry control the shortcuts must not
 * hijack (input, textarea, select, contentEditable). Reads tagName and
 * isContentEditable structurally instead of via instanceof HTMLElement so the
 * guard stays unit-testable outside a DOM — real elements expose both
 * properties the same way.
 */
export function isShortcutTargetBlocked(target: EventTarget | null): boolean {
  if (target === null || typeof target !== "object" || !("tagName" in target)) {
    return false;
  }

  // Narrowing probe over the two properties the guard reads; guarded by the
  // typeof/"tagName" checks above (same validated-narrowing discipline as the
  // JSON parsers in app-shell.contract.ts).
  const candidate = target as { readonly tagName?: unknown; readonly isContentEditable?: unknown };
  if (candidate.isContentEditable === true) {
    return true;
  }

  return candidate.tagName === "INPUT" || candidate.tagName === "TEXTAREA" || candidate.tagName === "SELECT";
}

/** Structural subset of Document/Element the dialog guard reads. */
export interface DialogQueryRoot {
  readonly querySelector: (selectors: string) => unknown;
}

/**
 * True when the root contains an open native <dialog> (the refresh-status
 * modal is the only dialog pattern in the app). Pure so it is testable
 * without a DOM; isDialogOpen adapts it to the global document.
 */
export function hasOpenDialog(root: DialogQueryRoot): boolean {
  return root.querySelector("dialog[open]") !== null;
}

/** App-shell guard: shortcuts are dead while a native dialog is open. */
export function isDialogOpen(): boolean {
  return hasOpenDialog(document);
}

const activationTargetSelector = "button, a, summary, [role='button'], [role='tab'], [role='separator']";

/**
 * True when the keydown target is (inside) an element that owns its own Enter
 * activation — buttons, links, popover summaries, and the ARIA button/tab/
 * separator roles (the pane resizer). Enter keeps its native activation there
 * instead of opening the active content row. Reads the DOM through the
 * structural closest probe so the check is unit-testable outside a DOM.
 */
export function isActivationTarget(target: EventTarget | null): boolean {
  if (target === null || typeof target !== "object") {
    return false;
  }

  const candidate = target as { readonly closest?: unknown };
  if (typeof candidate.closest !== "function") {
    return false;
  }

  // closest must be invoked on the target itself: Element.closest uses its
  // receiver, and a detached call would throw an illegal-invocation error.
  const closest = candidate.closest as (this: EventTarget, selectors: string) => unknown;
  return closest.call(target, activationTargetSelector) !== null;
}

/**
 * Clamps a keyboard-moved content-list index into the valid range: negative
 * values floor at 0, values past the end clamp to the last row, and an empty
 * list collapses everything to 0 (no row renders, so callers treat an
 * out-of-list 0 as "no active row").
 */
export function clampActiveIndex(index: number, length: number): number {
  if (length <= 0 || index < 0) {
    return 0;
  }

  return Math.min(index, length - 1);
}
