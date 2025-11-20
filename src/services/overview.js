import {
  getStravaActivities,
  getStravaProfile,
  getStravaStats,
} from "./strava.js";
import {
  getGarminActivities,
  getGarminProfile,
} from "./garmin.js";
import { readOverviewCache, writeOverviewCache } from "../cache.js";
import { normalizeLimit } from "../utils/limits.js";

const DEFAULT_LIMIT = 5;

const computeLimit = (env, limit) => {
  const fallback = Number(env?.DEFAULT_OVERVIEW_LIMIT);
  const resolvedFallback = Number.isFinite(fallback)
    ? fallback
    : DEFAULT_LIMIT;

  return normalizeLimit(limit ?? resolvedFallback, {
    min: 1,
    max: 50,
    fallback: resolvedFallback,
  });
};

export const buildOverviewPayload = async (env, limit) => {
  const normalized = computeLimit(env, limit);

  const [
    stravaProfile,
    stravaActivities,
    stravaStats,
    garminProfile,
    garminActivities,
  ] = await Promise.all([
    getStravaProfile(env),
    getStravaActivities(env, normalized),
    getStravaStats(env),
    getGarminProfile(env),
    getGarminActivities(env, normalized),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    limit: normalized,
    strava: {
      profile: stravaProfile,
      activities: stravaActivities,
      stats: stravaStats,
    },
    garmin: {
      profile: garminProfile,
      activities: garminActivities,
    },
  };
};

export const refreshOverviewCache = async (env, limit) => {
  const snapshot = await buildOverviewPayload(env, limit);
  await writeOverviewCache(env, snapshot);
  return snapshot;
};

export const getOverview = async (
  env,
  limit,
  { preferCache = true } = {}
) => {
  const normalized = computeLimit(env, limit);

  if (preferCache) {
    const cached = await readOverviewCache(env);
    if (cached?.limit && cached.limit >= normalized) {
      return cached;
    }
  }

  return refreshOverviewCache(env, normalized);
};
