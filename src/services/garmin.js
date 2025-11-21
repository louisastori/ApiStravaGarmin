import OAuth from "oauth-1.0a";
import CryptoJS from "crypto-js";
import setCookieParser from "set-cookie-parser";

const { splitCookiesString, parse: parseSetCookie } = setCookieParser;

import { HttpError } from "../utils/responses.js";
import { normalizeLimit } from "../utils/limits.js";

const USER_AGENT_MOBILE = "com.garmin.android.apps.connectmobile";
const USER_AGENT_BROWSER =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const DEFAULT_DOMAIN = "garmin.com";
const OAUTH_CONSUMER_URL = "https://thegarth.s3.amazonaws.com/oauth_consumer.json";
const CSRF_RE = /name="_csrf"\s+value="(.+?)"/i;
const TICKET_RE = /ticket=([^"]+)"/i;
const ACCOUNT_LOCKED_RE = /var status\s*=\s*"([^"]*)"/i;
const PAGE_TITLE_RE = /<title>([^<]*)<\/title>/i;

const sessionCache = new Map();

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  clear() {
    this.cookies.clear();
  }

  absorb(response) {
    const entries = [];
    for (const [key, value] of response.headers) {
      if (key.toLowerCase() === "set-cookie") {
        entries.push(value);
      }
    }

    if (!entries.length) {
      return;
    }

    for (const entry of entries) {
      const splitted = splitCookiesString(entry);
      for (const cookieStr of splitted) {
        const parsed = parseSetCookie(cookieStr);
        if (!parsed?.name) {
          continue;
        }
        if (!parsed.value) {
          this.cookies.delete(parsed.name);
        } else {
          this.cookies.set(parsed.name, parsed.value);
        }
      }
    }
  }

  apply(headers) {
    if (!this.cookies.size) {
      return;
    }

    const serialized = Array.from(this.cookies.entries())
      .map(([key, value]) => `${key}=${value}`)
      .join("; ");

    if (serialized) {
      headers.set("cookie", serialized);
    }
  }
}

const buildUrls = (domain = DEFAULT_DOMAIN) => ({
  domain,
  GC_MODERN: `https://connect.${domain}/modern`,
  GARMIN_SSO_ORIGIN: `https://sso.${domain}`,
  GARMIN_SSO_EMBED: `https://sso.${domain}/sso/embed`,
  SIGNIN_URL: `https://sso.${domain}/sso/signin`,
  OAUTH_URL: `https://connectapi.${domain}/oauth-service/oauth`,
  GC_API: `https://connectapi.${domain}`,
});

class GarminSession {
  constructor({ username, password, domain }) {
    this.credentials = { username, password };
    this.urls = buildUrls(domain);
    this.cookieJar = new CookieJar();
    this.oauthConsumer = null;
    this.oauthClient = null;
    this.oauth1Token = null;
    this.oauth2Token = null;
  }

  async ensureReady() {
    const now = Math.floor(Date.now() / 1000);
    if (this.oauth2Token && this.oauth2Token.expires_at > now + 60) {
      return;
    }

    if (this.oauth2Token && this.oauth1Token && this.oauthClient) {
      try {
        await this.exchange({
          oauth: this.oauthClient,
          token: this.oauth1Token,
        });
        return;
      } catch (error) {
        console.warn("Refresh Garmin OAuth echoue, reconnexion...", error);
      }
    }

    await this.login();
  }

  async login() {
    this.cookieJar.clear();
    await this.fetchOauthConsumer();
    const ticket = await this.getLoginTicket();
    const oauth1 = await this.getOauth1Token(ticket);
    this.oauthClient = oauth1.oauth;
    this.oauth1Token = oauth1.token;
    await this.exchange(oauth1);
  }

  async fetchOauthConsumer() {
    if (this.oauthConsumer) {
      return this.oauthConsumer;
    }

    const response = await fetch(OAUTH_CONSUMER_URL, {
      headers: { "User-Agent": USER_AGENT_MOBILE },
    });

    if (!response.ok) {
      throw new HttpError(
        response.status,
        "Impossible de recuperer la configuration OAuth Garmin."
      );
    }

    this.oauthConsumer = await response.json();
    return this.oauthConsumer;
  }

  async getLoginTicket() {
    const step1Params = new URLSearchParams({
      clientId: "GarminConnect",
      locale: "en",
      service: this.urls.GC_MODERN,
    });
    await this.fetchText(`${this.urls.GARMIN_SSO_EMBED}?${step1Params}`);

    const step2Params = new URLSearchParams({
      id: "gauth-widget",
      embedWidget: "true",
      locale: "en",
      gauthHost: this.urls.GARMIN_SSO_EMBED,
    });
    const step2 = await this.fetchText(
      `${this.urls.SIGNIN_URL}?${step2Params}`
    );

    const csrfMatch = CSRF_RE.exec(step2);
    if (!csrfMatch) {
      throw new HttpError(500, "Impossible de recuperer le token CSRF Garmin.");
    }
    const csrf = csrfMatch[1];

    const signinParams = new URLSearchParams({
      id: "gauth-widget",
      embedWidget: "true",
      clientId: "GarminConnect",
      locale: "en",
      gauthHost: this.urls.GARMIN_SSO_EMBED,
      service: this.urls.GARMIN_SSO_EMBED,
      source: this.urls.GARMIN_SSO_EMBED,
      redirectAfterAccountLoginUrl: this.urls.GARMIN_SSO_EMBED,
      redirectAfterAccountCreationUrl: this.urls.GARMIN_SSO_EMBED,
    });

    const body = new URLSearchParams({
      username: this.credentials.username,
      password: this.credentials.password,
      embed: "true",
      _csrf: csrf,
    });

    const html = await this.fetchText(
      `${this.urls.SIGNIN_URL}?${signinParams}`,
      {
        method: "POST",
        body: body.toString(),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Dnt: "1",
          Origin: this.urls.GARMIN_SSO_ORIGIN,
          Referer: this.urls.SIGNIN_URL,
          "User-Agent": USER_AGENT_BROWSER,
        },
      }
    );

    this.assertLoginAllowed(html);

    const ticketMatch = TICKET_RE.exec(html);
    if (!ticketMatch) {
      throw new HttpError(
        401,
        "Impossible d'obtenir le ticket Garmin (MFA requise ?)."
      );
    }

    return ticketMatch[1];
  }

  assertLoginAllowed(html) {
    const lockedMatch = ACCOUNT_LOCKED_RE.exec(html);
    if (lockedMatch) {
      throw new HttpError(
        401,
        `Connexion Garmin bloquee: ${lockedMatch[1] || "Compte verrouille."}`
      );
    }

    const titleMatch = PAGE_TITLE_RE.exec(html);
    if (titleMatch && titleMatch[1].includes("Update Phone Number")) {
      throw new HttpError(
        401,
        "Garmin exige la mise a jour du numero de telephone. Connectez-vous manuellement pour finaliser."
      );
    }
  }

  async getOauth1Token(ticket) {
    if (!this.oauthConsumer) {
      throw new HttpError(500, "Configuration OAuth Garmin indisponible.");
    }

    const params = new URLSearchParams({
      ticket,
      "login-url": this.urls.GARMIN_SSO_EMBED,
      "accepts-mfa-tokens": "true",
    });

    const url = `${this.urls.OAUTH_URL}/preauthorized?${params}`;
    const oauth = this.getOauthClient();

    const headers = oauth.toHeader(
      oauth.authorize({
        url,
        method: "GET",
      })
    );

    const payload = await this.fetchText(url, {
      headers: {
        ...headers,
        "User-Agent": USER_AGENT_MOBILE,
      },
    });

    const token = Object.fromEntries(new URLSearchParams(payload));
    if (!token.oauth_token || !token.oauth_token_secret) {
      throw new HttpError(401, "Token OAuth1 Garmin invalide.");
    }

    this.oauth1Token = token;
    return { token, oauth };
  }

  async exchange(oauth1) {
    const baseUrl = `${this.urls.OAUTH_URL}/exchange/user/2.0`;
    const authParams = oauth1.oauth.authorize(
      {
        url: baseUrl,
        method: "POST",
        data: null,
      },
      {
        key: oauth1.token.oauth_token,
        secret: oauth1.token.oauth_token_secret,
      }
    );

    const url = `${baseUrl}?${new URLSearchParams(authParams)}`;
    const response = await this.fetchJson(url, {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT_MOBILE,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    if (!response?.access_token) {
      throw new HttpError(401, "Token OAuth2 Garmin invalide.");
    }

    const now = Math.floor(Date.now() / 1000);
    response.expires_at = now + Number(response.expires_in || 3600);
    response.refresh_token_expires_at =
      now + Number(response.refresh_token_expires_in || 86400);

    this.oauth2Token = response;
    return response;
  }

  getOauthClient() {
    if (this.oauthClient && this.oauthConsumer) {
      return this.oauthClient;
    }

    if (!this.oauthConsumer) {
      throw new HttpError(500, "Configuration OAuth Garmin absente.");
    }

    this.oauthClient = new OAuth({
      consumer: {
        key: this.oauthConsumer.consumer_key,
        secret: this.oauthConsumer.consumer_secret,
      },
      signature_method: "HMAC-SHA1",
      hash_function(baseString, key) {
        return CryptoJS.HmacSHA1(baseString, key).toString(CryptoJS.enc.Base64);
      },
    });

    return this.oauthClient;
  }

  async getUserProfile() {
    await this.ensureReady();
    return this.apiGet("/userprofile-service/socialProfile");
  }

  async getActivities(limit) {
    await this.ensureReady();
    return this.apiGet("/activitylist-service/activities/search/activities", {
      start: "0",
      limit: limit.toString(),
    });
  }

  async apiGet(path, params) {
    if (!this.oauth2Token?.access_token) {
      throw new HttpError(401, "Session Garmin invalide.");
    }

    const url = new URL(
      path.startsWith("http") ? path : `${this.urls.GC_API}${path}`
    );

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, value);
        }
      }
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.oauth2Token.access_token}`,
        Accept: "application/json",
        "User-Agent": USER_AGENT_MOBILE,
        NK: "NT",
      },
    });

    if (response.status === 401) {
      this.oauth2Token = null;
      throw new HttpError(401, "Garmin a refuse le token OAuth2.");
    }

    if (!response.ok) {
      const text = await response.text();
      throw new HttpError(
        response.status,
        `Garmin API (${response.status}): ${text}`
      );
    }

    const text = await response.text();
    if (!text) {
      return null;
    }

    try {
      return JSON.parse(text);
    } catch (error) {
      console.error("Reponse Garmin invalide:", text);
      throw new HttpError(502, "Reponse Garmin illisible.");
    }
  }

  async fetchText(url, init) {
    const response = await this.request(url, init);
    return response.text();
  }

  async fetchJson(url, init) {
    const response = await this.request(url, init);
    if (!response.ok) {
      const text = await response.text();
      throw new HttpError(response.status, text || "Erreur Garmin.");
    }
    return response.json();
  }

  async request(url, init = {}) {
    const headers = new Headers(init.headers || {});
    headers.set("accept-language", "en-US,en;q=0.9");
    this.cookieJar.apply(headers);

    const response = await fetch(url, {
      ...init,
      headers,
    });

    this.cookieJar.absorb(response);
    return response;
  }
}

const getSession = async (env) => {
  const username = env?.GARMIN_EMAIL;
  const password = env?.GARMIN_PASSWORD;

  if (!username || !password) {
    throw new HttpError(
      500,
      "GARMIN_EMAIL et GARMIN_PASSWORD doivent etre definis."
    );
  }

  const cacheKey = `${username}@${env?.GARMIN_DOMAIN || DEFAULT_DOMAIN}`;
  let session = sessionCache.get(cacheKey);
  if (!session) {
    session = new GarminSession({
      username,
      password,
      domain: env?.GARMIN_DOMAIN || DEFAULT_DOMAIN,
    });
    sessionCache.set(cacheKey, session);
  }

  await session.ensureReady();
  return session;
};

export const getGarminProfile = async (env) => {
  const session = await getSession(env);
  return session.getUserProfile();
};

export const getGarminActivities = async (env, limit = 10) => {
  const session = await getSession(env);
  const normalized = normalizeLimit(limit, { max: 200, fallback: 10 });
  return session.getActivities(normalized);
};
