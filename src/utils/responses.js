const JSON_HEADERS = {
  "content-type": "application/json; charset=UTF-8",
  "cache-control": "no-store",
};

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export const jsonResponse = (payload, init = {}) =>
  new Response(JSON.stringify(payload, null, 2), {
    status: init.status || 200,
    headers: { ...JSON_HEADERS, ...(init.headers || {}) },
  });

export const errorResponse = (error, env) => {
  const status =
    typeof error?.status === "number" && error.status >= 100
      ? error.status
      : 500;

  const body = {
    message: error?.message || "Internal Server Error",
  };

  if (env?.NODE_ENV !== "production" && error?.stack) {
    body.stack = error.stack;
  }

  return jsonResponse(body, { status });
};
