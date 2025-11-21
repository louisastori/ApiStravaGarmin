import { HttpError } from "../utils/responses.js";
import { normalizeLimit } from "../utils/limits.js";

const STRAVA_BASE_URL = "https://www.strava.com/api/v3";
const STRAVA_TOKEN_URL = "https://www.strava.com/oauth/token";
const DEFAULT_SCOPES = ["read", "profile:read_all", "activity:read_all"];

const tokenCache = new Map();
const refreshTokenCache = new Map();

const stravaCacheKey = (env) => {
  if (!env?.STRAVA_CLIENT_ID) {
    throw new HttpError(500, "STRAVA_CLIENT_ID manquant.");
  }
  return env.STRAVA_CLIENT_ID;
};

const sanitizeScopes = (value) => {
  if (!value) {
    return DEFAULT_SCOPES;
  }

  const splitted = value
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);

  return splitted.length ? splitted : DEFAULT_SCOPES;
};

const getStravaConfig = (env) => {
  const required = [
    "STRAVA_CLIENT_ID",
    "STRAVA_CLIENT_SECRET",
    "STRAVA_REFRESH_TOKEN",
  ];

  const missing = required.filter((key) => !env?.[key]);
  if (missing.length) {
    throw new HttpError(
      500,
      `Variables d'environnement Strava manquantes: ${missing.join(", ")}`
    );
  }

  const clientId = Number(env.STRAVA_CLIENT_ID);
  if (Number.isNaN(clientId)) {
    throw new HttpError(500, "STRAVA_CLIENT_ID doit être un nombre.");
  }

  return {
    clientId,
    clientSecret: env.STRAVA_CLIENT_SECRET,
    refreshToken: env.STRAVA_REFRESH_TOKEN,
    scopes: sanitizeScopes(env.STRAVA_SCOPES),
  };
};

const refreshAccessToken = async (env) => {
  const config = getStravaConfig(env);
  const cacheKey = stravaCacheKey(env);
  const refreshToken = refreshTokenCache.get(cacheKey) || config.refreshToken;

  const params = new URLSearchParams({
    client_id: config.clientId.toString(),
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const response = await fetch(STRAVA_TOKEN_URL, {
    method: "POST",
    body: params.toString(),
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new HttpError(
      response.status,
      `Impossible de rafraîchir le token Strava: ${text}`
    );
  }

  const data = await response.json();
  const expiresAt = data?.expires_at
    ? Number(data.expires_at)
    : Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600);

  const payload = {
    accessToken: data.access_token,
    expiresAt,
    refreshToken: data.refresh_token || refreshToken,
  };

  refreshTokenCache.set(cacheKey, payload.refreshToken);
  tokenCache.set(cacheKey, payload);
  return payload;
};

const getAccessToken = async (env) => {
  const cacheKey = stravaCacheKey(env);
  const cached = tokenCache.get(cacheKey);
  const threshold = Math.floor(Date.now() / 1000) + 30;

  if (cached?.accessToken && cached.expiresAt > threshold) {
    return cached;
  }

  return refreshAccessToken(env);
};

const stravaRequest = async (env, path, searchParams) => {
  const token = await getAccessToken(env);
  const url = new URL(
    path.startsWith("http") ? path : `${STRAVA_BASE_URL}${path}`
  );

  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, value);
      }
    }
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new HttpError(
      response.status,
      `Erreur Strava (${response.status}): ${text}`
    );
  }

  return response.json();
};

export const getStravaProfile = (env) => stravaRequest(env, "/athlete");

export const getStravaActivities = (env, limit = 10) => {
  const perPage = normalizeLimit(limit, { max: 200, fallback: 10 });
  return stravaRequest(env, "/athlete/activities", {
    per_page: perPage,
  });
};

export const getStravaStats = async (env, profile) => {
  const resolvedProfile = profile || (await getStravaProfile(env));
  return stravaRequest(env, `/athletes/${resolvedProfile.id}/stats`);
};
