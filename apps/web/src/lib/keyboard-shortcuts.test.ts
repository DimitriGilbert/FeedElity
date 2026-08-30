import { expect, test } from "bun:test";

import {
  clampActiveIndex,
  hasOpenDialog,
  isActivationTarget,
  isShortcutTargetBlocked,
  nextGoPrefixActive,
  resolveShortcut,
  type DialogQueryRoot,
  type ShortcutAction,
  type ShortcutKeyEvent,
} from "./keyboard-shortcuts";

function keyEvent(
  key: string,
  modifiers: Partial<Pick<ShortcutKeyEvent, "ctrlKey" | "metaKey" | "altKey">> = {},
): ShortcutKeyEvent {
  return {
    key,
    ctrlKey: modifiers.ctrlKey ?? false,
    metaKey: modifiers.metaKey ?? false,
    altKey: modifiers.altKey ?? false,
  };
}

// Bun exposes the EventTarget global but no DOM classes, so guards are tested
// against real EventTarget instances augmented with the properties the guards
// read structurally (real elements carry the same properties).
function domTarget(properties: Record<string, unknown>): EventTarget {
  return Object.assign(new EventTarget(), properties);
}

test("resolveShortcut maps the base keys to shell actions", () => {
  const bindings: ReadonlyArray<readonly [string, ShortcutAction]> = [
    ["j", "move-down"],
    ["J", "move-down"],
    ["k", "move-up"],
    ["K", "move-up"],
    ["Enter", "open-active"],
    ["/", "focus-creator-search"],
    ["Escape", "clear-selection"],
    ["f", "toggle-favorite"],
  ];

  for (const [key, action] of bindings) {
    expect(resolveShortcut(keyEvent(key), false)).toBe(action);
  }
});

test("resolveShortcut ignores modifier chords and unbound keys", () => {
  expect(resolveShortcut(keyEvent("j", { ctrlKey: true }), false)).toBeNull();
  expect(resolveShortcut(keyEvent("j", { metaKey: true }), false)).toBeNull();
  expect(resolveShortcut(keyEvent("j", { altKey: true }), false)).toBeNull();
  expect(resolveShortcut(keyEvent("Enter", { metaKey: true }), false)).toBeNull();
  expect(resolveShortcut(keyEvent("Escape", { ctrlKey: true, altKey: true }), false)).toBeNull();
  expect(resolveShortcut(keyEvent("x"), false)).toBeNull();
  expect(resolveShortcut(keyEvent("F"), false)).toBeNull();
  // "g" never resolves on its own — it arms the prefix instead.
  expect(resolveShortcut(keyEvent("g"), false)).toBeNull();
  expect(resolveShortcut(keyEvent("G"), false)).toBeNull();
});

test("resolveShortcut gates go-library and go-catalog behind the g prefix", () => {
  expect(resolveShortcut(keyEvent("l"), false)).toBeNull();
  expect(resolveShortcut(keyEvent("c"), false)).toBeNull();
  expect(resolveShortcut(keyEvent("l"), true)).toBe("go-library");
  expect(resolveShortcut(keyEvent("c"), true)).toBe("go-catalog");

  // While the prefix is armed, every non-matching follow-up fires nothing.
  expect(resolveShortcut(keyEvent("j"), true)).toBeNull();
  expect(resolveShortcut(keyEvent("k"), true)).toBeNull();
  expect(resolveShortcut(keyEvent("Enter"), true)).toBeNull();
  expect(resolveShortcut(keyEvent("/"), true)).toBeNull();
  expect(resolveShortcut(keyEvent("Escape"), true)).toBeNull();
  expect(resolveShortcut(keyEvent("f"), true)).toBeNull();
  expect(resolveShortcut(keyEvent("x"), true)).toBeNull();
  // A second "g" while armed is itself a non-matching follow-up.
  expect(resolveShortcut(keyEvent("g"), true)).toBeNull();
  // Modifier chords never resolve, even with the prefix armed.
  expect(resolveShortcut(keyEvent("l", { ctrlKey: true }), true)).toBeNull();
});

test("nextGoPrefixActive tracks the full g-prefix lifecycle", () => {
  // A bare "g" arms the prefix.
  expect(nextGoPrefixActive(keyEvent("g"), false)).toBe(true);
  // The matching follow-ups consume it.
  expect(nextGoPrefixActive(keyEvent("l"), true)).toBe(false);
  expect(nextGoPrefixActive(keyEvent("c"), true)).toBe(false);
  // A non-matching follow-up cancels it.
  expect(nextGoPrefixActive(keyEvent("x"), true)).toBe(false);
  // Pressing "g" again while armed cancels it instead of re-arming.
  expect(nextGoPrefixActive(keyEvent("g"), true)).toBe(false);
  // Ordinary keys never arm it.
  expect(nextGoPrefixActive(keyEvent("j"), false)).toBe(false);
  expect(nextGoPrefixActive(keyEvent("Escape"), false)).toBe(false);
  // Only lowercase "g" arms the prefix, and modifier chords never do.
  expect(nextGoPrefixActive(keyEvent("G"), false)).toBe(false);
  expect(nextGoPrefixActive(keyEvent("g", { ctrlKey: true }), false)).toBe(false);
  expect(nextGoPrefixActive(keyEvent("g", { metaKey: true }), true)).toBe(false);
});

test("clampActiveIndex keeps the active row inside the rendered list", () => {
  // An empty list collapses every index to 0 (no row renders).
  expect(clampActiveIndex(0, 0)).toBe(0);
  expect(clampActiveIndex(3, 0)).toBe(0);
  // Negative indices floor at the first row.
  expect(clampActiveIndex(-1, 5)).toBe(0);
  // In-range indices pass through.
  expect(clampActiveIndex(0, 5)).toBe(0);
  expect(clampActiveIndex(2, 5)).toBe(2);
  expect(clampActiveIndex(4, 5)).toBe(4);
  // Indices past the end clamp to the last row.
  expect(clampActiveIndex(5, 5)).toBe(4);
  expect(clampActiveIndex(50, 5)).toBe(4);
  expect(clampActiveIndex(1, 1)).toBe(0);
});

test("isShortcutTargetBlocked blocks text-entry targets only", () => {
  expect(isShortcutTargetBlocked(domTarget({ tagName: "INPUT", isContentEditable: false }))).toBe(true);
  expect(isShortcutTargetBlocked(domTarget({ tagName: "TEXTAREA", isContentEditable: false }))).toBe(true);
  expect(isShortcutTargetBlocked(domTarget({ tagName: "SELECT", isContentEditable: false }))).toBe(true);
  expect(isShortcutTargetBlocked(domTarget({ tagName: "INPUT" }))).toBe(true);
  expect(isShortcutTargetBlocked(domTarget({ tagName: "DIV", isContentEditable: true }))).toBe(true);
  expect(isShortcutTargetBlocked(domTarget({ tagName: "INPUT", isContentEditable: true }))).toBe(true);

  expect(isShortcutTargetBlocked(domTarget({ tagName: "DIV", isContentEditable: false }))).toBe(false);
  expect(isShortcutTargetBlocked(domTarget({ tagName: "BODY", isContentEditable: false }))).toBe(false);
  // SVG elements (row icons) expose a tagName but no isContentEditable.
  expect(isShortcutTargetBlocked(domTarget({ tagName: "svg" }))).toBe(false);
  expect(isShortcutTargetBlocked(new EventTarget())).toBe(false);
  expect(isShortcutTargetBlocked(null)).toBe(false);
});

test("hasOpenDialog detects an open native dialog and ignores closed or missing ones", () => {
  const openDialogRoot: DialogQueryRoot = {
    querySelector: (selectors) => (selectors === "dialog[open]" ? { open: true } : null),
  };
  const noDialogRoot: DialogQueryRoot = { querySelector: () => null };

  expect(hasOpenDialog(openDialogRoot)).toBe(true);
  expect(hasOpenDialog(noDialogRoot)).toBe(false);
});

test("isActivationTarget detects elements that own their own Enter activation", () => {
  expect(isActivationTarget(domTarget({ closest: () => ({ button: true }) }))).toBe(true);
  expect(isActivationTarget(domTarget({ closest: () => null }))).toBe(false);
  // Plain targets (body, document, window) expose no closest at all.
  expect(isActivationTarget(new EventTarget())).toBe(false);
  expect(isActivationTarget(null)).toBe(false);
});
