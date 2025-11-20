# API Garmin & Strava - Cloudflare Workers / Supabase Edge

Ce projet expose des endpoints Strava et Garmin depuis un runtime serverless. Il tourne nativement sur Cloudflare Workers (KV + Cron) et peut etre deploye sur Supabase Edge Functions (sans cache KV par defaut).

## Stack & fonctionnement

- Worker/Edge handler : `src/worker.js` (Cloudflare) ou `supabase/functions/garmin-strava/index.ts` (Supabase).
- Routing : `itty-router`.
- Cache : namespace KV `GARMIN_STRAVA_CACHE` (Cloudflare uniquement).
- Cron : Cloudflare Cron triggers (optionnel) pour rafraichir `/api/overview`.
- Outils : `wrangler` pour Cloudflare, `supabase` CLI pour les Edge Functions.

## Prerequis

- Node.js 18+ et npm.
- Identifiants Strava : `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_REFRESH_TOKEN`.
- Identifiants Garmin Connect : `GARMIN_EMAIL`, `GARMIN_PASSWORD` (+ `GARMIN_DOMAIN` si besoin).
- Compte Cloudflare (Workers + KV) **ou** compte Supabase si tu deployes la fonction edge.

## Installation

```bash
git clone <repo>
cd apiGarminStrava
npm install
```

## Configuration locale

1. Copie `.dev.vars.example` en `.dev.vars`.
2. Renseigne les valeurs :

| Variable | Description |
| --- | --- |
| `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_REFRESH_TOKEN` | Identifiants OAuth Strava. |
| `STRAVA_SCOPES` | CSV de scopes (defaut `read,profile:read_all,activity:read_all`). |
| `GARMIN_EMAIL`, `GARMIN_PASSWORD` | Identifiants Garmin Connect. |
| `GARMIN_DOMAIN` | Optionnel (`garmin.com` par defaut). |
| `DEFAULT_OVERVIEW_LIMIT` | Limite par defaut pour `/api/overview` (5). |
| `CRON_OVERVIEW_LIMIT` | Limite pour le Cron (20). |

`wrangler dev` charge automatiquement `.dev.vars`. Pour la prod Cloudflare, utilise `wrangler secret put` si tu veux masquer certaines valeurs.

## KV & Cron Cloudflare

1. Cree la namespace KV :
   ```bash
   wrangler kv namespace create GARMIN_STRAVA_CACHE
   wrangler kv namespace create GARMIN_STRAVA_CACHE --preview
   ```
   Copie les IDs dans `wrangler.toml`.
2. Ajuste la cron rule si besoin (`0 */2 * * *` = toutes les 2 h).

## Developpement local (Cloudflare)

```bash
npm run dev
# http://127.0.0.1:8787
```

## Deploiement (Cloudflare Workers)

```bash
wrangler login   # 1re utilisation
npm run deploy
```

Le worker sera accessible sur `<name>.workers.dev` (ou ton domaine).

## Deploiement (Supabase Edge Functions)

1. Secrets Supabase : ajoute dans ton projet (via `supabase secrets set` ou le workflow GitHub) :
   - `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_REFRESH_TOKEN`
   - `GARMIN_EMAIL`, `GARMIN_PASSWORD`, `GARMIN_DOMAIN` (optionnel)
   - `DEFAULT_OVERVIEW_LIMIT`, `CRON_OVERVIEW_LIMIT` (optionnel)
2. Deploie : `supabase functions deploy garmin-strava --project-ref <PROJECT_REF> --import-map supabase/functions/import_map.json`
3. Endpoint : `https://<PROJECT_REF>.functions.supabase.co/garmin-strava/api/overview?limit=5` (toutes les routes sont identiques à celles ci-dessous).

Note : pas de KV sur Supabase, donc `/api/overview` recalcule les donnees à chaque appel (ou ajoute un stockage custom dans `src/cache.js`).

## Endpoints

| Methode | Route | Description |
| --- | --- | --- |
| `GET` | `/health` | Statut du service. |
| `GET` | `/api/strava/profile` | Profil Strava (`/athlete`). |
| `GET` | `/api/strava/activities?limit=50` | Dernieres activites Strava (max 200). |
| `GET` | `/api/strava/stats` | Stats agregees Strava. |
| `GET` | `/api/garmin/profile` | Profil Garmin Connect. |
| `GET` | `/api/garmin/activities?limit=50` | Dernieres activites Garmin (max 200). |
| `GET` | `/api/overview?limit=5&source=live` | Snapshot agrege (profil + activites + stats). `source=live` bypass le cache KV. |
| `POST` | `/api/cache/overview/refresh` | Force un recalcul (à proteger en prod). |

Toutes les reponses sont en JSON, la stack trace n est exposee qu en mode dev.

## Notes Garmin

- Garmin n expose pas d API publique : on reproduit le flux de l appli mobile (OAuth1/HMAC-SHA1, cookies, etc.). Un changement cote Garmin peut necessiter une mise à jour.
- Si le compte demande MFA ou Update phone number, la fonction renvoie un message explicite et s arrete.
- Les appels partent des IP du provider (Cloudflare ou Supabase) : surveille les alertes de connexion sur ton compte Garmin.

## Idees d evolution

- Stocker plusieurs snapshots (KV ou base) pour generer des timelines.
- Ajouter un webhook Strava afin de rafraichir immediatement apres chaque activite.
- Alimenter un site statique (GitHub Pages) en consommant `/api/overview`.
