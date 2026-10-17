const USERNAME_PATTERN = /^[a-z0-9_]{4,17}$/;

export function normalizeUsername(value: string): string | null {
  const normalized = value.toLowerCase();
  return USERNAME_PATTERN.test(normalized) ? normalized : null;
}
