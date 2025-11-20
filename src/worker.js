import router from "./router.js";
import { errorResponse } from "./utils/responses.js";
import { refreshOverviewCache } from "./services/overview.js";

const computeCronLimit = (env) => {
  const cronLimit = Number(env?.CRON_OVERVIEW_LIMIT);
  if (Number.isFinite(cronLimit)) {
    return cronLimit;
  }
  const fallback = Number(env?.DEFAULT_OVERVIEW_LIMIT);
  return Number.isFinite(fallback) ? fallback : undefined;
};

export default {
  async fetch(request, env, ctx) {
    try {
      const response = await router.handle(request, env, ctx);
      if (!response) {
        throw new Error("Aucune reponse generee par le routeur.");
      }
      return response;
    } catch (error) {
      console.error("Erreur Worker:", error);
      return errorResponse(error, env);
    }
  },
  async scheduled(event, env, ctx) {
    const limit = computeCronLimit(env);
    ctx.waitUntil(
      refreshOverviewCache(env, limit).catch((error) => {
        console.error(`Cron ${event.cron} echoue:`, error);
      })
    );
  },
};
