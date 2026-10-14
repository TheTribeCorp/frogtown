const VERCEL_API_PATH_PARAM = "__frogtown_api_path";

export function restoreVercelApiPath(requestUrl: string | undefined) {
  if (!requestUrl) return requestUrl;

  const parsedUrl = new URL(requestUrl, "http://localhost");
  const routedPath = parsedUrl.searchParams.get(VERCEL_API_PATH_PARAM);
  if (routedPath === null) return requestUrl;

  parsedUrl.searchParams.delete(VERCEL_API_PATH_PARAM);
  const normalizedPath = routedPath.replace(/^\/+/, "");
  const apiPath = normalizedPath ? `/api/${normalizedPath}` : "/api";
  const query = parsedUrl.searchParams.toString();
  return query ? `${apiPath}?${query}` : apiPath;
}
