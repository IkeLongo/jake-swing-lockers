/**
 * Returns the configured app base URL without a trailing slash.
 *
 * If APP_BASE_URL is missing, returns null and logs a warning.
 * Callers should gracefully fall back to relative paths.
 */
export function getAppBaseUrl(): string | null {
  const raw = process.env.APP_BASE_URL?.trim();
  if (!raw) {
    console.warn("[getAppBaseUrl] APP_BASE_URL is not set. Falling back to relative URLs.");
    return null;
  }

  return raw.replace(/\/+$/, "");
}

/**
 * Builds an app URL for a path.
 *
 * If APP_BASE_URL exists, returns an absolute URL.
 * If APP_BASE_URL is missing, returns a relative path.
 */
export function getAppUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const baseUrl = getAppBaseUrl();
  return baseUrl ? `${baseUrl}${normalizedPath}` : normalizedPath;
}
