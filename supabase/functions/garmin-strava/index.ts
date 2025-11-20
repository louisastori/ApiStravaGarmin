import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

import router from "../../../src/router.js";
import { errorResponse } from "../../../src/utils/responses.js";

const ENV_KEYS = [
  "STRAVA_CLIENT_ID",
  "STRAVA_CLIENT_SECRET",
  "STRAVA_REFRESH_TOKEN",
  "STRAVA_SCOPES",
  "GARMIN_EMAIL",
  "GARMIN_PASSWORD",
  "GARMIN_DOMAIN",
  "DEFAULT_OVERVIEW_LIMIT",
  "CRON_OVERVIEW_LIMIT",
  "NODE_ENV",
];

const loadEnv = () =>
  ENV_KEYS.reduce((acc, key) => {
    const value = Deno.env.get(key);
    if (value !== undefined && value !== null) {
      acc[key] = value;
    }
    return acc;
  }, {});

serve(async (request) => {
  const env = loadEnv();
  try {
    const response = await router.handle(request, env, {});
    if (!response) {
      throw new Error("Route introuvable.");
    }
    return response;
  } catch (error) {
    console.error("Erreur Supabase function:", error);
    return errorResponse(error, env);
  }
});
