const STORAGE_KEY = 'frogtown-referral-installation-v1';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Returns a random first-party browser-installation ID for referral eligibility.
 * This deliberately avoids hardware fingerprinting and is not an authentication factor.
 */
export function getReferralInstallationId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing && UUID_PATTERN.test(existing)) return existing;
    const id = window.crypto?.randomUUID?.();
    if (!id || !UUID_PATTERN.test(id)) return null;
    window.localStorage.setItem(STORAGE_KEY, id);
    return id;
  } catch {
    return null;
  }
}
