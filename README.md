# API Garmin & Strava – Cloudflare Workers

Cette version tourne integralement sur Cloudflare Workers, KV et Cron Triggers (option A 0 EUR). Le worker appelle Strava et Garmin Connect, met les donnees dans un snapshot KV et expose les memes endpoints qu'avant sans serveur Express.

## Stack & fonctionnement

- **Worker module** (`src/worker.js`) : gere `fetch` + `scheduled`.
- **itty-router** : mini routeur pour Workers.
- **KV namespace** (`GARMIN_STRAVA_CACHE`) : stocke le dernier snapshot `/api/overview`.
- **Cron Trigger** : rafraichit automatiquement le cache (par defaut toutes les 2 h).
- **Wrangler** : CLI pour dev local et deploiement.

Tout est base sur `fetch`, `crypto-js`, `oauth-1.0a` et un cookie jar maison, donc aucune dependance Node-only.

## Prerequis

- Compte Cloudflare (Workers + KV gratuits).
- Node.js 18+ et npm.
- Identifiants Strava (client id, client secret, refresh token).
- Identifiants Garmin Connect (email + mot de passe, MFA desactivee obligatoire pour l'instant).

## Installation

```bash
git clone <repo>
cd apiGarminStrava
npm install
```

## Configuration locale

1. Copiez `.dev.vars.example` en `.dev.vars`.
2. Renseignez vos valeurs :

| Variable | Description |
| --- | --- |
| `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_REFRESH_TOKEN` | Identifiants OAuth Strava. |
| `STRAVA_SCOPES` | CSV de scopes (defaut `read,profile:read_all,activity:read_all`). |
| `GARMIN_EMAIL`, `GARMIN_PASSWORD` | Credentials Garmin Connect. |
| `GARMIN_DOMAIN` | Optionnel (`garmin.com` par defaut). |
| `DEFAULT_OVERVIEW_LIMIT` | Limite par defaut pour `/api/overview` (5). |
| `CRON_OVERVIEW_LIMIT` | Limite utilisee par le Cron (20). |

`wrangler dev` charge automatiquement `.dev.vars`. Pour la prod, utilisez `wrangler secret put` si vous voulez masquer certaines valeurs.

## KV & Cron Cloudflare

1. Creez la KV namespace :
   ```bash
   wrangler kv namespace create GARMIN_STRAVA_CACHE
   wrangler kv namespace create GARMIN_STRAVA_CACHE --preview
   ```
   Copiez les IDs dans `wrangler.toml`.

2. Adaptez si besoin la Cron rule (`0 */2 * * *` = toutes les 2 h).

## Developpement local

```bash
npm run dev
# http://127.0.0.1:8787
```

## Deploiement

```bash
wrangler login   # 1re utilisation
npm run deploy
```

Le worker est accessible sur `<name>.workers.dev`. Vous pouvez ensuite attacher votre domaine.

## Endpoints

| Methode | Route | Description |
| --- | --- | --- |
| `GET` | `/health` | Statut du worker. |
| `GET` | `/api/strava/profile` | Profil Strava (`/athlete`). |
| `GET` | `/api/strava/activities?limit=50` | Dernieres activites Strava (max 200). |
| `GET` | `/api/strava/stats` | Stats agregees Strava. |
| `GET` | `/api/garmin/profile` | Profil Garmin Connect. |
| `GET` | `/api/garmin/activities?limit=50` | Dernieres activites Garmin (max 200). |
| `GET` | `/api/overview?limit=5&source=live` | Snapshot agrege (profil + activites + stats). `source=live` bypass le cache KV. |
| `POST` | `/api/cache/overview/refresh` | Force un recalcul (a proteger via token cote GitLab CI si besoin). |

Toutes les reponses sont en JSON, la stack trace nest exposee quen mode dev.

## Cron Trigger

Le handler `scheduled` appelle `refreshOverviewCache` pour remplir KV (`GARMIN_STRAVA_CACHE`). `/api/overview` renvoie en priorite le cache si le `limit` demande  celui deja stocke. Sinon (ou si `source=live`) il reconstruit le snapshot en direct.

## Notes Garmin

- Garmin nexpose pas dAPI publique : on reproduit le flux de lappli mobile (OAuth1/HMAC-SHA1, cookies, etc.). Un changement cote Garmin peut necessiter une mise a jour.
- Si votre compte demande une validation MFA ou Update phone number, le worker renvoie un message explicite et nira pas plus loin.
- Les appels partent des IP Cloudflare  surveillez les alertes de connexion sur votre compte Garmin.

## Idees devolution

- Stocker plusieurs snapshots (KV ou Durable Object) pour generer des timelines.
- Ajouter un webhook Strava afin de rafraichir immediatement apres chaque activite.
- Brancher votre GitLab Pages pour consommer `/api/overview` a intervalles reguliers.
