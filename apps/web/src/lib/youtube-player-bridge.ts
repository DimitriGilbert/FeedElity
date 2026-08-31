/**
 * Contained external transport boundary to YouTube's documented IFrame Player
 * API (https://developers.google.com/youtube/iframe_api_reference), speaking
 * the provider's public window.postMessage protocol directly so playback
 * progress can be tracked without loading the third-party widget script.
 *
 * AGENTS.md nuance, stated explicitly: this module is NOT app-internal
 * custom-event architecture and does not reintroduce document-wide custom
 * events. All `postMessage`/`message` usage for playback is confined to this
 * file — no other module may use `postMessage` or listen for `message` events
 * for playback purposes.
 *
 * Safety model:
 * - inbound messages are accepted ONLY when `event.source` is the tracked
 *   iframe's contentWindow AND `event.origin` is on the YouTube allowlist;
 * - outbound messages are posted ONLY to the iframe's contentWindow with the
 *   iframe URL's https origin as the targetOrigin;
 * - if the player never acknowledges the handshake within 5 seconds (blocked
 *   third-party cookies/JS, network failure), the tracker disposes itself
 *   silently: no saves, no console output.
 */

export interface YouTubePlaybackPositionReport {
  readonly positionSeconds: number;
  readonly durationSeconds: number | null;
  readonly ended: boolean;
}

export interface YouTubePlaybackTrackerOptions {
  readonly iframe: HTMLIFrameElement;
  readonly onPosition: (position: YouTubePlaybackPositionReport) => void;
  readonly onEnded: () => void;
}

export interface YouTubePlaybackTracker {
  dispose(): void;
}

interface PlayerMessage {
  readonly event: string;
  readonly info: unknown;
}

const allowedOrigins: readonly string[] = ["https://www.youtube-nocookie.com", "https://www.youtube.com"];

const handshakeTimeoutMs = 5_000;

const pollIntervalMs = 1_000;

// YT.PlayerState values from the IFrame API reference.
const playerStateEnded = 0;
const playerStatePlaying = 1;

// get* command functions polled once per second while the player is playing.
// The pending-reply queue holds exactly this batch (reset before each post),
// and replies arrive in post order, so FIFO attribution maps each numeric
// infoDelivery reply back to the command that asked for it.
const polledCommands: readonly string[] = ["getCurrentTime", "getDuration", "getPlayerState"];

function toFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toInfoObject(info: unknown): Record<string, unknown> | null {
  if (typeof info !== "object" || info === null) {
    return null;
  }

  return info as Record<string, unknown>;
}

function toPlayerMessage(data: unknown): PlayerMessage | null {
  let value: unknown = data;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }

  if (typeof value !== "object" || value === null) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (typeof candidate.event !== "string") {
    return null;
  }

  return { event: candidate.event, info: candidate.info };
}

function resolveTargetOrigin(iframeSrc: string): string | null {
  try {
    const url = new URL(iframeSrc);
    if (url.protocol !== "https:" || !allowedOrigins.includes(url.origin)) {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
}

export function createYouTubePlaybackTracker(options: YouTubePlaybackTrackerOptions): YouTubePlaybackTracker {
  const iframe = options.iframe;
  let disposed = false;
  // The handshake is acknowledged by ANY inbound message from the tracked
  // iframe over an allowlisted origin: it proves the IFrame API channel is
  // alive without depending on a specific event name.
  let acknowledged = false;
  let endedReported = false;
  let trackedPositionSeconds: number | null = null;
  let trackedDurationSeconds: number | null = null;
  let trackedPlayerState: number | null = null;
  let lastReportedPositionSeconds: number | null = null;
  let lastReportedEnded = false;
  const pendingCommandReplies: string[] = [];
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let handshakeTimer: ReturnType<typeof setTimeout> | null = null;

  const targetOrigin = resolveTargetOrigin(iframe.src);

  const post = (payload: Record<string, unknown>): void => {
    if (disposed || targetOrigin === null) {
      return;
    }

    const contentWindow = iframe.contentWindow;
    if (contentWindow === null) {
      return;
    }

    contentWindow.postMessage(JSON.stringify(payload), targetOrigin);
  };

  // Fires onPosition only when the (position, ended) pair actually changed
  // since the last delivery, so the ~1/s poll (three command replies per tick)
  // never reports an identical pair twice — including a repeated ended
  // report at an unchanged position. The parent's own once-per-session
  // endedReported guard stays the single gate for onEnded.
  const deliverPosition = (ended: boolean): void => {
    if (trackedPositionSeconds === null) {
      return;
    }

    if (trackedPositionSeconds === lastReportedPositionSeconds && ended === lastReportedEnded) {
      return;
    }

    lastReportedEnded = ended;
    lastReportedPositionSeconds = trackedPositionSeconds;
    options.onPosition({
      positionSeconds: trackedPositionSeconds,
      durationSeconds: trackedDurationSeconds,
      ended,
    });
  };

  const applyPlayerState = (state: number): void => {
    trackedPlayerState = state;
    if (state === playerStateEnded) {
      deliverPosition(true);
      if (!endedReported) {
        endedReported = true;
        options.onEnded();
      }
    }
  };

  const applyMessage = (message: PlayerMessage): void => {
    if (message.event === "onStateChange") {
      const state = toFiniteNumber(message.info);
      if (state !== null) {
        applyPlayerState(state);
      }
      return;
    }

    if (message.event !== "infoDelivery") {
      // onReady and other events only matter for handshake acknowledgment.
      return;
    }

    const infoObject = toInfoObject(message.info);
    if (infoObject !== null) {
      // Periodic full info delivery: authoritative snapshot for all fields.
      const currentTime = toFiniteNumber(infoObject.currentTime);
      if (currentTime !== null && currentTime >= 0) {
        trackedPositionSeconds = currentTime;
      }
      const duration = toFiniteNumber(infoObject.duration);
      // YouTube reports duration 0 until the video's metadata loads (normally
      // just after playback starts). A 0 duration would trivially satisfy the
      // viewer's near-end check (position >= 0 - 30) and spuriously auto-mark
      // the item as played, so 0 is treated as unknown (durationSeconds null
      // downstream), mirroring toNativeDuration in app-shell-viewer.tsx.
      if (duration !== null && duration > 0) {
        trackedDurationSeconds = duration;
      }
      const playerState = toFiniteNumber(infoObject.playerState);
      if (playerState !== null) {
        applyPlayerState(playerState);
      }
      deliverPosition(trackedPlayerState === playerStateEnded);
      return;
    }

    // A numeric infoDelivery is the reply to one of our polled get* commands.
    // Replies arrive in post order, so FIFO attribution holds.
    const numericReply = toFiniteNumber(message.info);
    if (numericReply === null) {
      return;
    }

    const command = pendingCommandReplies.shift();
    if (command === undefined) {
      return;
    }

    if (command === "getCurrentTime" && numericReply >= 0) {
      trackedPositionSeconds = numericReply;
    } else if (command === "getDuration" && numericReply > 0) {
      // Same 0-means-unknown rule as the infoDelivery snapshot above.
      trackedDurationSeconds = numericReply;
    } else if (command === "getPlayerState") {
      applyPlayerState(numericReply);
    }

    deliverPosition(trackedPlayerState === playerStateEnded);
  };

  const handleMessage = (event: MessageEvent): void => {
    if (disposed) {
      return;
    }

    if (event.source !== iframe.contentWindow || !allowedOrigins.includes(event.origin)) {
      return;
    }

    const message = toPlayerMessage(event.data);
    if (message === null) {
      return;
    }

    if (!acknowledged) {
      acknowledged = true;
      if (handshakeTimer !== null) {
        clearTimeout(handshakeTimer);
        handshakeTimer = null;
      }
    }

    applyMessage(message);
  };

  // Polls once per second: until acknowledged it re-posts the "listening"
  // handshake (the player only starts reporting after receiving it), and once
  // acknowledged it polls position/duration/state commands while the last
  // known state is playing. State changes themselves are pushed by the player
  // (onStateChange/infoDelivery), so a paused player costs no commands.
  const poll = (): void => {
    if (disposed) {
      return;
    }

    if (!acknowledged) {
      post({ event: "listening" });
    } else if (trackedPlayerState === playerStatePlaying) {
      pendingCommandReplies.length = 0;
      for (const func of polledCommands) {
        pendingCommandReplies.push(func);
        post({ event: "command", func, args: [] });
      }
    }

    pollTimer = setTimeout(poll, pollIntervalMs);
  };

  const dispose = (): void => {
    if (disposed) {
      return;
    }

    disposed = true;
    window.removeEventListener("message", handleMessage);
    if (pollTimer !== null) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    if (handshakeTimer !== null) {
      clearTimeout(handshakeTimer);
      handshakeTimer = null;
    }
    pendingCommandReplies.length = 0;
  };

  window.addEventListener("message", handleMessage);
  poll();
  handshakeTimer = setTimeout(() => {
    handshakeTimer = null;
    if (!acknowledged) {
      // Silent degradation for blocked third-party cookies/JS: stop tracking
      // without saving or logging anything.
      dispose();
    }
  }, handshakeTimeoutMs);

  return { dispose };
}
