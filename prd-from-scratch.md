# Feedelity Rewrite PRD

## Product Vision
Feedelity is a personal-first, video-oriented RSS client for following creators across YouTube, Odysee, and PeerTube in one fast, high-density interface. The rewrite replaces the old low-code backend with a new source of truth while preserving current user-visible behavior and completing currently stubbed features.

## Goals
- Match current Feedelity functionality without regression.
- Support YouTube, Odysee, and PeerTube from day one, with a clear path to new source types later.
- Keep both web and desktop usage through Electrobun.
- Preserve account-based use with local email/password auth and self-service sign-up.
- Preserve per-user subscriptions, favorites, open/played history, playlists, and manual refresh behavior.
- Provide a one-time import path from the old app, then make the new app authoritative.
- Modernize the UI while keeping the current three-column, high-density workflow.

## Non-Goals
- Automatic background refresh in v1.
- Dropping current functionality to simplify the rewrite.
- Forcing a multi-user-first model that gets in the way of personal use.
- Redesigning the product into a generic social or non-video RSS app.

## Primary User Journeys
- Sign up, log in, and return to the same subscriptions and history across sessions.
- Import data once from the old app and continue using the new app as the source of truth.
- Add a creator/source URL, subscribe, and start receiving content.
- Browse the creator list, content list, and selected content viewer in the three-column shell.
- Mark items open, played, and favorite.
- Refresh subscriptions manually when the user chooses.
- Create and use playlists.

## Functional Requirements
- Users can create an account, sign in, and sign out with local email/password auth.
- Users can self-register without admin assistance.
- Each user has private subscriptions, favorites, open/played history, and playlists.
- The app supports browsing, selecting, and viewing video-oriented content.
- The app supports manual refresh of all sources and individual subscriptions.
- Current placeholders and no-op surfaces must become working features where they are part of the current UI.
- The app must preserve the current dense sidebar/list/viewer workflow.
- The app must support both web and desktop delivery.

## Data Migration Requirements
- Provide a one-time import path from the old backend/app.
- Import all user-owned data needed to preserve continuity: account identity, subscriptions, favorites, open/played history, playlists, and source metadata where available.
- After import, the new app becomes the source of truth for future changes.
- Migration must be safe to run once per account and report any items that could not be mapped cleanly.

## Source Support Requirements
- Support YouTube, Odysee, and PeerTube at launch.
- Treat source handling as extensible so additional source types can be added without redesigning the app.
- Normalize source-specific differences so the main reading and playback experience stays consistent.
- Preserve source-specific playback where needed, especially for embedded or native video handling.

## Auth Requirements
- Use local better-auth email/password authentication.
- Support self-service sign-up.
- Keep account-based personalization as the default model.
- Do not block later multi-user growth, but optimize the product for an individual owner first.

## UX Requirements
- Keep the recognizable high-density three-column structure.
- Modernize visual styling, spacing, and interaction polish without making the interface feel sparse.
- Make browsing creators, scanning content, and reading/viewing the selected item feel immediate.
- Keep favorite, open, played, playlist, and refresh actions easy to reach.
- Preserve placeholders from the current app as real, discoverable features rather than removing them.

## Success Criteria
- Existing users can move to the new app without losing core data or workflows.
- Users can sign up, sign in, subscribe, favorite, track history, manage playlists, and refresh manually.
- YouTube, Odysee, and PeerTube sources work reliably.
- The UI feels modern while still serving power-user scanning behavior.
- The new app functions as the long-term source of truth after import.
