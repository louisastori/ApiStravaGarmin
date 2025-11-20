import { Router } from "itty-router";

import {
  getStravaProfile,
  getStravaActivities,
  getStravaStats,
} from "./services/strava.js";
import {
  getGarminProfile,
  getGarminActivities,
} from "./services/garmin.js";
import { getOverview, refreshOverviewCache } from "./services/overview.js";
import { jsonResponse, HttpError } from "./utils/responses.js";
import { normalizeLimit } from "./utils/limits.js";

const router = Router();

const extractLimit = (request, { fallback = 10, max = 200 } = {}) =>
  normalizeLimit(request?.query?.limit, { fallback, max, min: 1 });

router.get("/health", () =>
  jsonResponse({
    status: "ok",
    runtime: "cloudflare-worker",
    timestamp: new Date().toISOString(),
  })
);

router.get("/api/strava/profile", async (_request, env) => {
  const data = await getStravaProfile(env);
  return jsonResponse(data);
});

router.get("/api/strava/activities", async (request, env) => {
  const limit = extractLimit(request, { fallback: 10, max: 200 });
  const activities = await getStravaActivities(env, limit);
  return jsonResponse({ count: activities.length, activities });
});

router.get("/api/strava/stats", async (_request, env) => {
  const stats = await getStravaStats(env);
  return jsonResponse(stats);
});

router.get("/api/garmin/profile", async (_request, env) => {
  const profile = await getGarminProfile(env);
  return jsonResponse(profile);
});

router.get("/api/garmin/activities", async (request, env) => {
  const limit = extractLimit(request, { fallback: 10, max: 200 });
  const activities = await getGarminActivities(env, limit);
  return jsonResponse({ count: activities.length, activities });
});

router.get("/api/overview", async (request, env) => {
  const preferCache = request?.query?.source !== "live";
  const snapshot = await getOverview(env, request?.query?.limit, {
    preferCache,
  });
  return jsonResponse(snapshot);
});

router.post("/api/cache/overview/refresh", async (_request, env) => {
  const snapshot = await refreshOverviewCache(env);
  return jsonResponse(snapshot);
});

router.all("*", () => {
  throw new HttpError(404, "Route introuvable.");
});

export default router;
