# FeedElity Web UI Redesign — Orchestration Plan

> **Status: completed.** All 8 phases landed (the left pane even gained a fourth "collections" tab beyond this plan). Kept for history.

## Overview

Redesign the FeedElity 3-pane RSS client UI to address 8 user complaints: box-in-box border aesthetic, relocated add-source/refresh controls, multi-source video display, icon-button conversions, resizable snap panes, settings as display-pane takeover, left-pane tab system, and collapsible middle-pane controls. The redesign must preserve all existing data flows, API wiring, authenticated guards, and anonymous browsing. All 1345 lines of contract tests in `app-shell.test.ts` will be updated to match the new CSS classes and structural patterns.

## Prerequisites

- Bun runtime installed
- Monorepo bootstrapped (`bun install`)
- Existing codebase at `/home/didi/workspace/Code/FeedElity`
- `lucide-solid` v1.8+ available in `apps/web/`
- `check-types` and `build` scripts functional

## Key Technical Constraints

- **SolidJS only** — createSignal, createMemo, createResource, Show, For, Match/Switch. No React patterns.
- **Tailwind CSS v4** — CSS-first config in styles.css, no tailwind.config. Semantic color tokens only (no hex, no palette classes like `slate-500`).
- **TypeScript strict** — `verbatimModuleSyntax: true`, `import type` for type-only imports, no `any`.
- **Test file is source-code pattern tests** — Tests read component source files as strings and assert on CSS class names, DOM attributes, and API call patterns. Tests will be deferred to Phase 8 for bulk update. Intermediate phases use `check-types` + `build` as gatekeeping only.

## NO-SLOP Policy (Included in Every Phase)

- NO `any`, `as any`, `: any` ANYWHERE
- NO placeholder code, NO `// TODO`, NO `// FIXME`
- NO unused imports, NO unused variables
- NO console.log hacks, NO void hacks
- Use `import type` for type-only imports (`verbatimModuleSyntax: true`)
- External imports first, blank line, then local imports
- Do NOT start the dev server
- Use semantic Tailwind color tokens only (bg-foreground, text-muted-foreground, border-border, etc.)
- NO hex colors, NO palette classes (slate-500, zinc-200, etc.), NO arbitrary color classes
- NO emojis in code or markup

---

## Phase 1: Design System & Aesthetic Overhaul — Border Cleanup

**Type**: Sequential

**Skill Requirement**: The implementer MUST load the `design-taste-frontend` skill before starting work. The design guidance must inform border removal, spacing, and visual hierarchy decisions.

**Requirements**:

1. **Remove box-in-box borders**: Replace `border border-border` on nested containers with `border-t border-border` (top border only). The goal is an open, fluid feel where sections are separated by a single top rule, not enclosed in boxes on all four sides.

2. **Specific border changes in contract.ts CSS class strings**:
   - `sourceColumnClass`: Change `border-b border-border` to remain (it's the bottom border on mobile), but change `lg:border-b-0 lg:border-r` to keep just the right border on desktop (already correct). Keep as-is for outer pane boundary.
   - `contentColumnClass`: Same treatment — keep `border-b` for mobile, `lg:border-b-0 lg:border-r` for desktop separator.
   - `sourceHeaderRegionClass`: Change `border-b border-border` to `border-b border-border` (keep — header needs bottom separator). BUT change the nested input/select `border border-input` to `border-b border-input` (inputs should have bottom border only, not full box).
   - `sourceFeedListRegionClass`: Keep `border-t border-border` (already a top border — good).
   - `sourceActionsRegionClass`: No border change needed — it's a container.
   - `contentHeaderRegionClass`: Keep `border-b border-border` (header separator — correct).
   - `viewerColumnClass`: Keep as-is (no border on viewer — correct).

3. **Remove inner box borders in components**:
   - In `app-shell-rows.tsx`: `CreatorSourceRow` — change `border border-border bg-card` to `border-t border-border` (top border only, no full box).
   - In `app-shell-rows.tsx`: `PlaylistItemRow` — change `border border-border bg-background p-2` to `border-t border-border` (top border only).
   - In `app-shell-rows.tsx`: `FeedRow` — change `border border-border` to `border-t border-border`.
   - In `app-shell-rows.tsx`: `ContentListItemRow` — change all `border border-border` on the outer row container to `border-t border-border`.
   - In `app-shell-source-sections.tsx`: `AddSourceSection` — change `border border-border bg-background p-2` on the form to `border-t border-border` (no box around form).
   - In `app-shell-source-sections.tsx`: `RefreshStatusSection` — change inner `border border-border bg-background px-2 py-1.5` containers to remove full border, use `border-t border-border` where section separation is needed.
   - In `app-shell-source-sections.tsx`: `SettingsColumnSection` — change `border border-border bg-background p-2` on typed-settings and advanced-settings to `border-t border-border`.
   - In `app-shell-source-sections.tsx`: `PlaylistColumnSection` — change `border border-border bg-background p-2` on management panel to `border-t border-border`.
   - In `app-shell-source-sections.tsx`: `SubscriptionActionButton` — keep the button border (it's an interactive control).
   - In `app-shell.tsx`: `LoadMoreControl` — change `border border-border bg-background px-2 py-1.5` to `border-t border-border` (top separator only).
   - In `app-shell-viewer.tsx`: Empty state, loading state, error state containers — change `border border-border bg-muted` to `border-t border-border` or just remove border entirely for empty states.
   - In `app-shell-viewer.tsx`: Source switcher `select` — keep `border border-input` (it's an interactive control).
   - In `app-shell-content-column.tsx`: `ContentLoadMoreControl` — change `border border-border bg-background px-2 py-1.5` to `border-t border-border`.
   - In `app-shell-content-column.tsx`: View mode buttons — keep their border (interactive controls).
   - In `app-shell-content-column.tsx`: Filter inputs and selects — keep `border border-input` (interactive controls).
   - In `app-shell-content-column.tsx`: Hide played checkbox container — change `border border-border bg-background` to `border-t border-border`.
   - In `app-shell-content-column.tsx`: Playlist action section — change `border border-border bg-background p-2` to `border-t border-border`.
   - In `source-indicator.tsx`: `SourceIconBadge` — keep `border border-border` (it's a small badge chip).
   - In `app-shell-source-sections.tsx`: Refresh run list items — change `border border-border bg-background px-2 py-1.5` to `border-t border-border`.
   - In `app-shell-source-sections.tsx`: Refresh feed result list items — change `border border-border bg-card px-2 py-1` to `border-t border-border`.
   - In `app-shell-source-sections.tsx`: Settings list items — change `border border-border bg-card p-2` to `border-t border-border`.
   - In `app-shell-source-sections.tsx`: Playlist list items — change `border border-border bg-card p-2` to `border-t border-border`.

4. **Add sensible padding/spacing**: Where full borders are removed, ensure there's adequate padding (`py-2`, `px-2`) and section spacing (`space-y-2`, `mt-2`) so content doesn't run together. The `p-2` padding should remain on containers that lose their border, so content still has breathing room.

5. **Keep interactive control borders**: Form inputs (`border border-input`), buttons (`border border-border`), selects (`border border-input`) retain their full borders. Only non-interactive container/wrapper elements lose their full borders.

6. **Preserve all data-testid attributes, aria attributes, and data-shell-column attributes exactly as they are.**

**Inputs**:
- Read: `apps/web/src/styles.css`, `apps/web/src/components/app-shell.contract.ts`, `apps/web/src/components/app-shell.tsx`, `apps/web/src/components/app-shell-content-column.tsx`, `apps/web/src/components/app-shell-viewer.tsx`, `apps/web/src/components/app-shell-source-sections.tsx`, `apps/web/src/components/app-shell-rows.tsx`, `apps/web/src/components/source-indicator.tsx`

**Outputs**:
- Modify: All 8 files listed above

**Validation Criteria**:
- `bun run check-types`: Zero errors
- `bun run build`: Success
- No `border border-border` on non-interactive container elements (only on buttons, inputs, selects, and pane outer boundaries)
- All `data-*` attributes preserved
- All aria attributes preserved
- Semantic color tokens only (no hex, no palette classes)
- design-taste-frontend skill guidance applied to spacing and visual hierarchy decisions

**Dependencies**: None (first phase)

---

## Phase 2: Resizable Pane System with Drag-to-Snap

**Type**: Sequential

**Requirements**:

1. **Create `pane-resizer.tsx` component** in `apps/web/src/components/`:
   - A thin vertical divider between panes that supports drag-to-resize.
   - On `mousedown` / `touchstart` on the divider, capture pointer and track horizontal movement.
   - Snap to preset width ratios after drag release. The snap sizes define column widths as CSS pixel values computed from the shell container width.
   - The component should use SolidJS patterns: `createSignal` for drag state, `onCleanup` for removing event listeners.
   - Visual: A 2px-wide grab handle with `cursor-col-resize`, subtle `bg-border` color, hover state `bg-ring`.
   - Keyboard-accessible: aria-label "Resize pane", role="separator", aria-orientation="vertical", aria-valuenow/min/max.
   - The component emits `onResize(leftDelta: number, rightDelta: number)` events to the parent.

2. **Define snap size configuration** in `contract.ts`:
   - Left pane snap sizes (as fractions of total width): `[0.04, 0.08, 0.16]` (roughly 0.5/1/2 column units out of 12).
   - Middle pane snap sizes: `[0.16, 0.24, 0.32]` (roughly 2/3/4 column units).
   - Right pane: Fills remaining space (no explicit snap — it gets what's left).
   - Default: Left 0.08, Middle 0.24, Right 0.68 (approximately 1:3:8 ratio matching current layout).
   - Export these as `leftPaneSnapFractions`, `middlePaneSnapFractions`, `defaultLeftFraction`, `defaultMiddleFraction`.
   - Find the nearest snap target for a given fraction using absolute difference.

3. **Replace static grid with dynamic pane widths** in `app-shell.tsx`:
   - Replace `lg:grid-cols-[1fr_3fr_8fr]` with inline `style` using CSS `grid-template-columns` set from signals.
   - Add two `createSignal` values: `leftPaneFraction` and `middlePaneFraction`. Right pane fraction is `1 - leftPaneFraction - middlePaneFraction` (computed via `createMemo`).
   - Insert `<PaneResizer>` components between pane sections (between left and middle, between middle and right).
   - On resize, compute new fractions and snap to nearest preset. Update signals.
   - On mobile (below `lg` breakpoint), panes stack vertically and resizers are hidden.
   - Clamp minimum widths: left >= 4% of total, middle >= 16% of total, right >= 40% of total.

4. **Update `desktopShellGridClass` in contract.ts**:
   - Change from the static `"lg:grid-cols-[1fr_3fr_8fr]"` to a dynamic constant name. The export `desktopShellGridClass` should become `desktopShellGridBase` with value `"lg:grid lg:h-full lg:min-h-0 lg:overflow-hidden"` (the grid part without column template, since columns are now dynamic).
   - Alternatively, keep `desktopShellGridClass` as a base class that excludes the column template, and add the column template as an inline style. The key point: the hardcoded `1fr_3fr_8fr` must no longer be in a CSS class string — it must be a dynamic inline style.

5. **Update `shellGridClass` composition**:
   - `shellGridClass` should contain `flex min-h-full w-full flex-col` for mobile and `lg:grid lg:h-full lg:min-h-0 lg:overflow-hidden` for desktop, but NOT `lg:grid-cols-[...]` — that will be an inline style.
   - Add a new exported function `toDesktopColumnTemplate(left: number, middle: number, right: number): string` that returns a CSS `grid-template-columns` value like `${left}fr ${middle}fr ${right}fr`.

6. **Persist pane widths** (optional but recommended):
   - Store pane fractions in `localStorage` keyed by `feedelity.pane-widths`.
   - On mount, read from localStorage if available, otherwise use defaults.
   - On resize snap completion, write to localStorage.

**Inputs**:
- Read: `apps/web/src/components/app-shell.contract.ts`, `apps/web/src/components/app-shell.tsx`
- Reference: `apps/web/src/styles.css` (for theme tokens)

**Outputs**:
- Create: `apps/web/src/components/pane-resizer.tsx`
- Modify: `apps/web/src/components/app-shell.contract.ts`, `apps/web/src/components/app-shell.tsx`

**Validation Criteria**:
- `bun run check-types`: Zero errors
- `bun run build`: Success
- `PaneResizer` component is keyboard-accessible with aria attributes
- Three panes render at default proportions matching current 1:3:8 ratio
- Drag resize works and snaps to preset sizes
- Mobile layout unaffected (panes stack, resizers hidden)
- Minimum pane width clamping prevents panes from collapsing
- localStorage persistence works (save on snap, restore on mount)
- No `setInterval`, `setTimeout`, `requestAnimationFrame` leaks — cleanup on unmount

**Dependencies**: Phase 1 must complete (border aesthetic changes are in place)

---

## Phase 3: Left Pane Tab System

**Type**: Sequential

**Requirements**:

1. **Add tab state to left pane** in `app-shell.tsx`:
   - Define `LeftPaneTab` type: `"library" | "feeds" | "playlists"`.
   - Add `createSignal<LeftPaneTab>` defaulting to `"library"`.
   - Add `leftPaneTabLabels` constant: `{ library: "Library", feeds: "Feeds", playlists: "Playlists" }` (or use `props.mode === "library" ? "Library" : "Catalog"` for the library tab label).
   - The tab bar is a horizontal row of tab buttons at the top of the left pane, below the header region (search + source filter).

2. **Tab content rendering**:
   - **Library tab**: Shows the creator list (what's currently in `sourceCreatorListRegionClass`). This is the default view — the creator catalog/library list.
   - **Feeds tab**: Shows the feed list for the selected creator (what's currently in `sourceFeedListRegionClass`). When no creator is selected, show "Select a source to see its feeds."
   - **Playlists tab**: Shows the playlist management UI (what's currently in `PlaylistColumnSection`). The playlist selector, management panel, and playlist items all render here.

3. **Tab bar design**:
   - Compact horizontal tab bar using top-border highlight for active tab: `border-t-2 border-t-ring` on active, `border-t-2 border-t-transparent` on inactive.
   - Use `role="tablist"`, `role="tab"`, `aria-selected` for accessibility.
   - Each tab button shows the tab label and optionally a count badge (e.g., creator count for Library, feed count for Feeds, playlist count for Playlists).
   - Tab bar is rendered inside the left pane header, after the search/filter controls.

4. **Remove vertical stacking**:
   - The current layout stacks: header → creator list → feed list → actions region vertically.
   - After tabs: header (with search + filter + tab bar) → selected tab content.
   - The `sourceActionsRegionClass` region is eliminated — AddSource and Refresh move to Phase 4, Settings moves to Phase 5, Playlists moves to the Playlists tab.

5. **Update `CreatorSourceColumn` props and rendering**:
   - Add `activeTab` signal and `setActiveTab` to CreatorSourceColumn.
   - Conditionally render creator list, feed list, or playlist section based on active tab.
   - Feed list tab auto-selects when a creator is selected (or stays on Library).
   - Keep the playlist data wiring from `PlaylistColumnSection` — it just moves into the tab content area.

6. **Move `PlaylistColumnSection` content into the Playlists tab**:
   - The entire `PlaylistColumnSection` render tree moves into the playlists tab content.
   - Keep all the same data fetching, state management, and API calls.
   - The section's outer `border-t border-border` wrapper is no longer needed (it's now a full tab panel).

**Inputs**:
- Read: `apps/web/src/components/app-shell.tsx`, `apps/web/src/components/app-shell-source-sections.tsx`, `apps/web/src/components/app-shell.contract.ts`

**Outputs**:
- Modify: `apps/web/src/components/app-shell.tsx`, `apps/web/src/components/app-shell-source-sections.tsx`, `apps/web/src/components/app-shell.contract.ts`

**Validation Criteria**:
- `bun run check-types`: Zero errors
- `bun run build`: Success
- Three tabs visible in left pane: Library, Feeds, Playlists
- Only authenticated users see the Playlists tab
- Tab switching works — content area updates to show selected tab's content
- All existing data flows (creator list, feed list, playlist management) continue working
- `role="tablist"` and `role="tab"` and `aria-selected` attributes present
- No `data-source-actions-region` needed anymore (actions are relocated in later phases)

**Dependencies**: Phase 1 must complete

---

## Phase 4: Relocate Add Source & Refresh to Middle Pane

**Type**: Sequential

**Requirements**:

1. **Convert AddSourceSection to an icon button trigger**:
   - In the left pane header (or tab bar area), replace the full `AddSourceSection` inline form with a single icon button using `Plus` icon from `lucide-solid`.
   - The button has `aria-label="Add source"` and `title="Add source"`.
   - Clicking the button sets a signal `middlePanePanel: "add-source" | "refresh" | null` that the middle pane reads.

2. **Convert RefreshStatusSection to an icon button trigger**:
   - Replace the full `RefreshStatusSection` in the left pane with a single icon button using `RefreshCw` icon from `lucide-solid`.
   - The button has `aria-label="Refresh"` and `title="Refresh"`.
   - Authenticated-only (hidden for anonymous users).
   - Clicking the button sets `middlePanePanel` to `"refresh"`.

3. **Render Add Source panel in the middle pane**:
   - When `middlePanePanel() === "add-source"`, the middle pane shows the Add Source form as an inline panel at the top of the content list (above the scroll region, replacing or overlaying the header temporarily).
   - The panel includes a close button (`X` icon from `lucide-solid`) that sets `middlePanePanel` back to `null`.
   - The form content is the same as current `AddSourceSection` — input, submit button, help text, success/error messages.
   - After successful source addition, auto-close the panel.

4. **Render Refresh panel in the middle pane**:
   - When `middlePanePanel() === "refresh"`, the middle pane shows the refresh controls as an inline panel at the top.
   - The panel includes a close button.
   - The refresh controls are the same as current `RefreshStatusSection` — the 6 refresh buttons in a grid, refresh history, latest report.
   - After refresh completion, the panel stays open (user may want to see the report).

5. **Lift `middlePanePanel` signal to `AppShell`**:
   - The `middlePanePanel` signal lives in `AppShell` (the parent) so it can be passed to both `CreatorSourceColumn` (for the trigger buttons) and `ContentListColumn` (for the panel rendering).
   - New props on `CreatorSourceColumn`: `onOpenAddSource: () => void`, `onOpenRefresh: () => void`.
   - New props on `ContentListColumn`: `activePanel: () => "add-source" | "refresh" | null`, `onClosePanel: () => void`, plus the existing add-source and refresh callback props.

6. **Keep all API wiring intact**:
   - `client.ingestion.addSource` still called from the same place.
   - `client.refresh.*` still called from the same place.
   - `onSourceAdded`, `onRefreshCompleted` callbacks still fire and invalidate resources.

7. **Remove AddSourceSection and RefreshStatusSection from the left pane actions region**.
   - The `sourceActionsRegionClass` div no longer renders these sections.
   - The left pane now only has: header (search + filter + tabs) → tab content (library/feeds/playlists).

**Inputs**:
- Read: `apps/web/src/components/app-shell.tsx`, `apps/web/src/components/app-shell-source-sections.tsx`, `apps/web/src/components/app-shell-content-column.tsx`, `apps/web/src/components/app-shell.contract.ts`

**Outputs**:
- Modify: `apps/web/src/components/app-shell.tsx`, `apps/web/src/components/app-shell-source-sections.tsx`, `apps/web/src/components/app-shell-content-column.tsx`, `apps/web/src/components/app-shell.contract.ts`

**Validation Criteria**:
- `bun run check-types`: Zero errors
- `bun run build`: Success
- Add Source and Refresh appear as compact icon buttons in the left pane
- Clicking them opens their full UI as a panel in the middle pane
- Close button dismisses the panel
- All ingestion and refresh API calls still work
- Anonymous users see Add Source button but not Refresh button
- The left pane no longer shows the full AddSourceSection or RefreshStatusSection inline

**Dependencies**: Phases 1 and 3 must complete

---

## Phase 5: Settings as Right Pane Takeover

**Type**: Sequential

**Requirements**:

1. **Convert Settings to an icon button trigger**:
   - Add a gear icon button (`Settings` icon from `lucide-solid`) in the left pane header area (next to the Add Source and Refresh icon buttons).
   - The button has `aria-label="Settings"` and `title="Settings"`.
   - Authenticated-only.
   - Clicking the button sets a signal `viewerMode: "content" | "settings"` in `AppShell`.

2. **Render Settings in the right pane (viewer column)**:
   - When `viewerMode() === "settings"`, the right pane shows the `SettingsColumnSection` content instead of the content viewer.
   - The settings UI fills the viewer column's scroll region.
   - A close/back button (`ArrowLeft` or `X` icon from `lucide-solid`) at the top of the settings view returns `viewerMode` to `"content"`.

3. **Update `AppShell` state**:
   - Add `createSignal<"content" | "settings">("content")` for viewer mode.
   - Pass `viewerMode` and `setViewerMode` down to the viewer column.
   - When settings is open, the `SelectedContentViewer` is hidden (but not unmounted — keep resources alive via `display: none` or conditional render with `Show`).

4. **Remove `SettingsColumnSection` from left pane**:
   - The `sourceActionsRegionClass` no longer renders `SettingsColumnSection`.
   - The settings entry point is now only the gear icon button.

5. **Keep all settings API wiring intact**:
   - `client.overlays.settings()`, `client.overlays.saveSetting()`, `client.overlays.deleteSetting()` still called.
   - `readerDensity` computation still works.
   - `onSettingsChanged` callback still fires.

6. **Add `data-settings-viewer` attribute** to the settings view container in the right pane for test discoverability.

**Inputs**:
- Read: `apps/web/src/components/app-shell.tsx`, `apps/web/src/components/app-shell-source-sections.tsx`, `apps/web/src/components/app-shell-viewer.tsx`, `apps/web/src/components/app-shell.contract.ts`

**Outputs**:
- Modify: `apps/web/src/components/app-shell.tsx`, `apps/web/src/components/app-shell-source-sections.tsx`, `apps/web/src/components/app-shell-viewer.tsx`, `apps/web/src/components/app-shell.contract.ts`

**Validation Criteria**:
- `bun run check-types`: Zero errors
- `bun run build`: Success
- Gear icon button visible for authenticated users
- Clicking it renders settings UI in the right pane
- Close button returns to content viewer
- All settings API calls still work
- Reader density setting still applies to rows
- Settings no longer appears in the left pane

**Dependencies**: Phases 1 and 3 must complete

---

## Phase 6: Middle Pane Collapsible Controls

**Type**: Sequential

**Requirements**:

1. **Add collapsible state to middle pane header**:
   - Add `createSignal<boolean>(true)` for controls expanded state.
   - When expanded, all header controls are visible (view mode buttons, search, source filter, hide played, playlist target).
   - When collapsed, only a compact summary row is visible: section title + content count + expand button.

2. **Toggle button**:
   - Add a chevron button in the header row: `ChevronDown` icon when expanded, `ChevronUp` when collapsed, from `lucide-solid`.
   - `aria-label="Expand filters"` / `aria-label="Collapse filters"`.
   - `aria-expanded` attribute on the button.

3. **Collapsed state**:
   - Show only: section title, content count badge, and the expand chevron button.
   - A single compact row: `flex items-center justify-between`.
   - All filter controls, view mode buttons, and playlist target are hidden.

4. **Expanded state** (current behavior):
   - All controls visible as they are now.
   - The toggle button shows the collapse chevron.

5. **Preserve filter state when collapsing**:
   - Collapsing does NOT reset any filter values. Search, source type, view mode, hide played — all retained.
   - Expanding reveals the controls with their current values.

6. **When the Add Source or Refresh panel is open (from Phase 4), controls auto-collapse**:
   - The `activePanel` prop from Phase 4 triggers collapse when non-null.
   - This maximizes the panel display area.

**Inputs**:
- Read: `apps/web/src/components/app-shell-content-column.tsx`, `apps/web/src/components/app-shell.contract.ts`

**Outputs**:
- Modify: `apps/web/src/components/app-shell-content-column.tsx`, `apps/web/src/components/app-shell.contract.ts`

**Validation Criteria**:
- `bun run check-types`: Zero errors
- `bun run build`: Success
- Toggle button visible in middle pane header
- Clicking it hides/shows filter controls
- Filter state preserved across collapse/expand
- Content list scroll area gains more space when controls are collapsed
- `aria-expanded` attribute present on toggle button
- When add-source/refresh panel is open, controls auto-collapse

**Dependencies**: Phase 4 must complete (middle pane panel state)

---

## Phase 7: Icon Buttons & Multi-Source Display

**Type**: Parallel (two sub-phases)

### 7.1: Icon Button Conversion

**Requirements**:

1. **Replace text buttons with Lucide icon buttons throughout all components**:
   - `SubscriptionActionButton`: Replace "Subscribe" / "Unsubscribe" text with `UserPlus` / `UserMinus` icons from `lucide-solid`. Keep `aria-label` with the text.
   - View mode buttons in content header (All, Favorites, History/Open, Played): Replace text with icons — `LayoutGrid`, `Heart`, `Clock`, `CheckCircle` from `lucide-solid`. Keep `aria-label` with text. Add `title` attributes.
   - "Load more" buttons: Replace "Load more creators", "Load more feeds", "Load more videos" text with `ChevronDown` icon + compact label like "More". Keep `aria-label`.
   - Settings "Use app default" button: Replace with `RotateCcw` icon + compact "Default" text.
   - Settings "Save" / "Clear" / "Delete" buttons: Replace with `Save` / `X` / `Trash2` icons. Keep `aria-label`.
   - Playlist "Create" / "Save" / "New" / "Update" / "Delete" buttons: Replace with `Plus` / `Save` / `FilePlus` / `Save` / `Trash2` icons. Keep `aria-label`.
   - Playlist item reorder buttons (move up/down): Replace "Up" / "Down" with `ChevronUp` / `ChevronDown` icons.
   - Playlist item remove button: Replace "Remove" with `X` icon.
   - Refresh buttons (Normal all, Force all, Normal source, Force source, Normal feed, Force feed): Replace text with `RefreshCw` (normal) / `Zap` (force) icons + compact labels like "All", "Source", "Feed". Keep `aria-label`.
   - Favorite toggle button: Replace "Mark favorite" / "Unfavorite" with `Heart` / `Heart` (filled via CSS). Keep `aria-label`.
   - Opened/Played status buttons: Replace "Mark opened" / "Opened" / "Mark played" / "Played" with `Eye` / `EyeOff` and `PlayCircle` / `CheckCircle` icons. Keep `aria-label`.

2. **Icon button styling**:
   - All icon buttons use a consistent size: `h-7 w-7` or `h-6 w-6` for compact density.
   - Consistent focus ring: `focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring`.
   - Consistent hover: `hover:bg-accent hover:text-accent-foreground`.
   - Disabled state: `disabled:cursor-not-allowed disabled:opacity-60`.
   - Icon-only buttons have `aria-label` and `title` for accessibility.

3. **Import pattern for Lucide icons**:
   - Use per-icon imports: `import Heart from "lucide-solid/icons/heart"` (not barrel import).
   - This matches the existing pattern in `source-indicator.tsx`.

**Inputs**:
- Read: All component files in `apps/web/src/components/`
- Reference: `apps/web/src/components/source-indicator.tsx` (for existing Lucide import pattern)

**Outputs**:
- Modify: `apps/web/src/components/app-shell-source-sections.tsx`, `apps/web/src/components/app-shell-content-column.tsx`, `apps/web/src/components/app-shell-viewer.tsx`, `apps/web/src/components/app-shell-rows.tsx`

**Validation**:
- All buttons that previously had text labels now have icon + `aria-label`
- No text-only buttons remain where an icon is appropriate
- Lucide imports use per-icon file imports
- Semantic color tokens only

### 7.2: Multi-Source Video Display

**Requirements**:

1. **Replace the `<select>` source switcher with a tab/button group**:
   - When `playableSources().length > 1`, show a horizontal row of source buttons instead of a `<select>`.
   - Each button shows the source type icon (using `SourceTypeIcon` from `source-indicator.tsx`) and the source label (e.g., "YouTube embed", "PeerTube media").
   - Active source button has visual emphasis: `bg-accent text-accent-foreground`.
   - Each button has `aria-label` and `aria-pressed`.
   - Keep the `id="viewer-source-switcher"` on the container div for test compatibility.

2. **Show source count badge on content rows**:
   - When a content item has `sourceCount > 1`, show a small badge or visual indicator on the content row (e.g., `x2` or `x3` chip next to the source icon badge).
   - This is already partially implemented via `SourceIconBadge` with `sourceCount` prop — ensure it's visible and prominent for multi-source items.

3. **Auto-select best source**:
   - The current behavior already sorts by priority. Keep this.
   - When the user manually selects a different source, persist that selection for the current content item (via `selectedSourceId` signal — already implemented).

**Inputs**:
- Read: `apps/web/src/components/app-shell-viewer.tsx`, `apps/web/src/components/source-indicator.tsx`, `apps/web/src/components/app-shell-rows.tsx`

**Outputs**:
- Modify: `apps/web/src/components/app-shell-viewer.tsx`

**Validation**:
- Multi-source items show a source button group instead of a `<select>`
- Single-source items show no switcher (current behavior)
- Source icons are from `lucide-solid` via `source-indicator.tsx`
- `id="viewer-source-switcher"` attribute preserved on the container
- `onChange` / `setSelectedSourceId` still works
- Source count badge visible on content rows

**Phase-level Validation**:
- All sub-tasks pass individual validation
- `bun run check-types`: Zero errors
- `bun run build`: Success
- No text-only buttons remain where icons are appropriate
- Multi-source display uses button group, not `<select>`
- All `aria-*` attributes preserved or improved

**Dependencies**: Phase 1 must complete

---

## Phase 8: Test Updates & Final Integration

**Type**: Sequential

**Requirements**:

1. **Update `desktopShellGridClass` test** (line ~101):
   - The test currently asserts `desktopShellGridClass` === `"lg:grid-cols-[1fr_3fr_8fr]"`. After Phase 2, this constant changes. Update the assertion to match the new constant value (the base grid class without column template, or the new dynamic system).
   - Add a new test for `toDesktopColumnTemplate` function that verifies default column template.

2. **Update border class assertions** throughout the test file:
   - Many tests assert that source code contains `border border-border` on specific elements. After Phase 1, most of these become `border-t border-border`. Update ALL assertions that check for `border border-border` on non-interactive container elements.
   - Interactive controls (buttons, inputs, selects) still have `border border-input` or `border border-border` — these assertions remain.

3. **Update `data-source-actions-region` assertions**:
   - After Phase 3/4/5, the left pane actions region may be restructured. Update assertions that reference this data attribute.
   - If the region no longer exists, update tests to check for the new tab structure instead.

4. **Update `data-add-source-region` assertions**:
   - After Phase 4, AddSourceSection is no longer in the left pane — it's in the middle pane panel. Update the test to look for it in the content column source instead.

5. **Update settings assertions**:
   - After Phase 5, settings are in the right pane. Update tests that assert `<SettingsColumnSection` location.
   - Add assertions for the new settings viewer mode.

6. **Update button text assertions**:
   - After Phase 7, many buttons now have icons instead of text. Update assertions that check for button text content (e.g., "Subscribe", "Unsubscribe", "Normal all", etc.).
   - Replace text-content assertions with `aria-label` assertions where buttons became icon-only.

7. **Update multi-source display assertions**:
   - After Phase 7.2, the `<select>` source switcher is replaced with buttons. Update assertions that check for `<select id="viewer-source-switcher">` and `onChange`.

8. **Update collapsible controls assertions**:
   - After Phase 6, the middle pane header has a toggle button. Add assertions for `aria-expanded` attribute.

9. **Add new test for left pane tabs**:
   - Verify tab rendering with `role="tablist"`, `role="tab"`, `aria-selected`.
   - Verify tab switching changes visible content.

10. **Add new test for resizable panes**:
    - Verify `PaneResizer` component exists with correct aria attributes.
    - Verify snap fraction constants are defined.
    - Verify `toDesktopColumnTemplate` function returns correct values.

11. **Preserve all behavioral tests**:
    - Tests that verify API call patterns, data flow, authenticated guards, resource key patterns — these should continue to pass unchanged because the data wiring is not modified.
    - If any data-wiring test breaks due to file restructuring (e.g., a function moved from one file to another), update the file path in the test's source reading.

12. **Run the full test suite**:
    - `bun test apps/web/src/components/app-shell.test.ts`
    - All tests must pass.

**Inputs**:
- Read: `apps/web/src/components/app-shell.test.ts` (full file), all modified component files

**Outputs**:
- Modify: `apps/web/src/components/app-shell.test.ts`

**Validation Criteria**:
- `bun run check-types`: Zero errors
- `bun run build`: Success
- `bun test apps/web/src/components/app-shell.test.ts`: All tests pass
- All API wiring tests still pass (client.overlays.*, client.catalog.*, client.refresh.*, client.ingestion.*)
- All authenticated guard tests still pass
- All resource key pattern tests still pass
- New tests for tabs, resizable panes, settings viewer, icon buttons, multi-source display all pass
- Semantic color token test still passes (no hex colors, no palette classes)

**Dependencies**: ALL previous phases must complete

---

## Phase Dependency Graph

```
Phase 1 (Design/Aesthetic)
  |
Phase 2 (Resizable Panes)
  |
Phase 3 (Left Pane Tabs)
  |
Phase 4 (Add Source/Refresh to Middle)
  |
Phase 5 (Settings to Right Pane)
  |
Phase 6 (Collapsible Controls)
  |
Phase 7 (Icon Buttons + Multi-Source)
  |
Phase 8 (Test Updates & Final Integration)
```

**Note on parallelism**: Phases 4, 5, 6, and 7 are logically independent but all modify overlapping files (`app-shell.tsx`, `app-shell-source-sections.tsx`, `app-shell-content-column.tsx`, `app-shell-viewer.tsx`). Running them sequentially prevents merge conflicts and context confusion. Phase 7 has two parallel sub-phases (icon buttons and multi-source display) since they touch different files.

## Success Criteria

Overall success requires:
- All 8 phases complete and validate successfully
- `bun run check-types`: Zero errors across monorepo
- `bun run build`: Success across monorepo
- `bun test apps/web/src/components/app-shell.test.ts`: All tests pass
- All 8 user complaints addressed:
  1. Box-in-box borders removed → top-border-only design
  2. Add Source & Refresh are icon buttons → middle pane panels
  3. Multi-source videos displayed with button group, not hidden select
  4. Text buttons replaced with Lucide icon buttons
  5. Panes resizable with drag-to-snap
  6. Settings renders as right pane takeover via gear button
  7. Left pane has Library/Feeds/Playlists tabs
  8. Middle pane controls are collapsible
- No regression in: anonymous browsing, authenticated guards, API wiring, data flows
- `design-taste-frontend` skill guidance applied to Phase 1 aesthetic decisions
