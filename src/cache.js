const OVERVIEW_CACHE_KEY = "overview:snapshot";

export const readOverviewCache = async (env) => {
  if (!env?.GARMIN_STRAVA_CACHE) {
    return null;
  }

  const raw = await env.GARMIN_STRAVA_CACHE.get(OVERVIEW_CACHE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch (_error) {
    console.warn("Impossible de parser le cache overview, purge nécessaire.");
    return null;
  }
};

export const writeOverviewCache = async (env, snapshot) => {
  if (!env?.GARMIN_STRAVA_CACHE) {
    return false;
  }

  await env.GARMIN_STRAVA_CACHE.put(
    OVERVIEW_CACHE_KEY,
    JSON.stringify(snapshot),
    {
      metadata: { generatedAt: snapshot.generatedAt },
    }
  );
  return true;
};
