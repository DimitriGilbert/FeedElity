import type { SourceType } from "../domain/catalog";

export interface RefreshSourcePolicy {
  readonly defaultCadenceSeconds: number;
  readonly minCadenceSeconds: number;
  readonly normalDelayBetweenFetchesMs: number;
  readonly forceDelayBetweenFetchesMs: number;
  readonly jitterMaxSeconds: number;
}

const fifteenMinutesSeconds = 15 * 60;

const refreshPolicies = {
  youtube: {
    defaultCadenceSeconds: 2 * 60 * 60,
    minCadenceSeconds: 15 * 60,
    normalDelayBetweenFetchesMs: 20_000,
    forceDelayBetweenFetchesMs: 30_000,
    jitterMaxSeconds: fifteenMinutesSeconds,
  },
  odysee: {
    defaultCadenceSeconds: 60 * 60,
    minCadenceSeconds: 15 * 60,
    normalDelayBetweenFetchesMs: 10_000,
    forceDelayBetweenFetchesMs: 15_000,
    jitterMaxSeconds: fifteenMinutesSeconds,
  },
  peertube: {
    defaultCadenceSeconds: 60 * 60,
    minCadenceSeconds: 15 * 60,
    normalDelayBetweenFetchesMs: 8_000,
    forceDelayBetweenFetchesMs: 12_000,
    jitterMaxSeconds: fifteenMinutesSeconds,
  },
} satisfies Record<SourceType, RefreshSourcePolicy>;

export function getRefreshPolicy(sourceType: SourceType): RefreshSourcePolicy {
  return refreshPolicies[sourceType];
}

export function effectiveRefreshCadenceSeconds(sourceType: SourceType, cadenceSeconds: number | null | undefined): number {
  const policy = getRefreshPolicy(sourceType);
  return Math.max(cadenceSeconds ?? policy.defaultCadenceSeconds, policy.minCadenceSeconds);
}

export function delayBetweenFeedFetchesMs(sourceType: SourceType, force: boolean): number {
  const policy = getRefreshPolicy(sourceType);
  return force ? policy.forceDelayBetweenFetchesMs : policy.normalDelayBetweenFetchesMs;
}

export function nextRefreshDate(refreshedAt: Date, sourceType: SourceType, feedId: string, cadenceSeconds: number | null | undefined): Date {
  const effectiveCadence = effectiveRefreshCadenceSeconds(sourceType, cadenceSeconds);
  const jitterSeconds = deterministicJitterSeconds(feedId, getRefreshPolicy(sourceType).jitterMaxSeconds);
  return new Date(refreshedAt.getTime() + (effectiveCadence + jitterSeconds) * 1000);
}

export function deterministicJitterSeconds(seed: string, maxSeconds: number): number {
  if (maxSeconds <= 0) {
    return 0;
  }

  let hash = 2_166_136_261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) % (maxSeconds + 1);
}
