import type { SourceType } from "../domain/catalog";

export interface RefreshSourcePolicy {
  readonly defaultCadenceSeconds: number;
  readonly minCadenceSeconds: number;
}

const minDelayBetweenFetchesMs = 3_000;
const maxDelayBetweenFetchesMs = 20_000;
const minJitterSeconds = 60;
const maxJitterSeconds = 15 * 60;

const refreshPolicies = {
  youtube: {
    defaultCadenceSeconds: 2 * 60 * 60,
    minCadenceSeconds: 15 * 60,
  },
  odysee: {
    defaultCadenceSeconds: 60 * 60,
    minCadenceSeconds: 15 * 60,
  },
  peertube: {
    defaultCadenceSeconds: 60 * 60,
    minCadenceSeconds: 15 * 60,
  },
} satisfies Record<SourceType, RefreshSourcePolicy>;

export function getRefreshPolicy(sourceType: SourceType): RefreshSourcePolicy {
  return refreshPolicies[sourceType];
}

export function effectiveRefreshCadenceSeconds(sourceType: SourceType, cadenceSeconds: number | null | undefined): number {
  const policy = getRefreshPolicy(sourceType);
  return Math.max(cadenceSeconds ?? policy.defaultCadenceSeconds, policy.minCadenceSeconds);
}

export function delayBetweenFeedFetchesMs(random: () => number): number {
  return randomIntegerInclusive(minDelayBetweenFetchesMs, maxDelayBetweenFetchesMs, random);
}

export function nextRefreshDate(refreshedAt: Date, sourceType: SourceType, cadenceSeconds: number | null | undefined, random: () => number): Date {
  const effectiveCadence = effectiveRefreshCadenceSeconds(sourceType, cadenceSeconds);
  const jitterSeconds = randomIntegerInclusive(minJitterSeconds, maxJitterSeconds, random);
  return new Date(refreshedAt.getTime() + (effectiveCadence + jitterSeconds) * 1000);
}

function randomIntegerInclusive(minimum: number, maximum: number, random: () => number): number {
  const normalized = Math.min(Math.max(random(), 0), 0.999_999_999);
  return Math.floor(normalized * (maximum - minimum + 1)) + minimum;
}
