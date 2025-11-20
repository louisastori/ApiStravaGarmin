export const normalizeLimit = (
  value,
  { min = 1, max = 200, fallback = 10 } = {}
) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.min(Math.max(Math.trunc(numeric), min), max);
};
