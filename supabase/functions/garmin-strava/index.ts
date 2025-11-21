import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "@supabase/supabase-js";

import router from "../src/router.js";
import {
  errorResponse,
  HttpError,
  jsonResponse,
} from "../src/utils/responses.js";
import { getStravaProfile, getStravaStats } from "../src/services/strava.js";

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
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
];

const loadEnv = () =>
  ENV_KEYS.reduce((acc, key) => {
    const value = Deno.env.get(key);
    if (value !== undefined && value !== null) {
      acc[key] = value;
    }
    return acc;
  }, {});

const createSupabaseClient = (env) => {
  const url = env?.SUPABASE_URL;
  const serviceRoleKey = env?.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new HttpError(
      500,
      "SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY doivent etre definis pour persister les stats Strava."
    );
  }

  return createClient(url, serviceRoleKey, {
    global: { fetch },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
};

const persistStravaStats = async (env) => {
  const profile = await getStravaProfile(env);
  const stats = await getStravaStats(env, profile);

  const supabase = createSupabaseClient(env);
  const generatedAt = new Date().toISOString();

  const { error } = await supabase.from("strava_stats").insert({
    athlete_id: profile.id,
    generated_at: generatedAt,
    snapshot: stats,
    source: "strava",
  });

  if (error) {
    throw new HttpError(
      500,
      `Insertion Supabase echouee: ${error.message}`
    );
  }

  return { athleteId: profile.id, generatedAt, snapshot: stats };
};

const stripPrefix = (pathname) =>
  pathname.startsWith("/garmin-strava")
    ? pathname.slice("/garmin-strava".length) || "/"
    : pathname;

serve(async (request) => {
  const env = loadEnv();
  const url = new URL(request.url);
  const pathname = stripPrefix(url.pathname);

  try {
    if (pathname === "/api/strava/stats/store") {
      if (request.method !== "POST") {
        throw new HttpError(
          405,
          "Utilise POST pour stocker les stats Strava."
        );
      }

      const payload = await persistStravaStats(env);
      return jsonResponse(payload, { status: 201 });
    }

    const normalizedUrl = `${url.origin}${pathname}${url.search}`;
    const normalizedRequest =
      normalizedUrl === request.url
        ? request
        : new Request(normalizedUrl, request);

    const response = await router.handle(normalizedRequest, env, {});
    if (!response) {
      throw new Error("Route introuvable.");
    }
    return response;
  } catch (error) {
    console.error("Erreur Supabase function:", error);
    return errorResponse(error, env);
  }
});
