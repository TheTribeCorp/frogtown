const repository = 'TheTribeCorp/frogtown';
export const androidUpdateCheckUrl = `https://api.github.com/repos/${repository}/releases/latest`;
export const androidReleaseBaseUrl = `https://github.com/${repository}/releases/download`;

export type AndroidApkAsset = { name: string; url: string; size: number };
export type AndroidRelease = { tag: string; version: string; assets: AndroidApkAsset[] };

const assetNames = new Set([
  'Frogtown.apk',
  'Frogtown-arm64-v8a.apk',
  'Frogtown-armeabi-v7a.apk',
]);

export function parseAndroidRelease(input: unknown): AndroidRelease {
  if (!input || typeof input !== 'object') throw new Error('Invalid release metadata.');
  const value = input as { tag_name?: unknown; assets?: unknown };
  if (typeof value.tag_name !== 'string') throw new Error('Release version is missing.');
  const match = /^android-v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value.tag_name);
  if (!match || !Array.isArray(value.assets)) throw new Error('No valid Frogtown Android release was found.');

  const assets = value.assets.flatMap((candidate): AndroidApkAsset[] => {
    if (!candidate || typeof candidate !== 'object') return [];
    const asset = candidate as { name?: unknown; browser_download_url?: unknown; size?: unknown };
    if (
      typeof asset.name !== 'string' || !assetNames.has(asset.name)
      || typeof asset.browser_download_url !== 'string'
      || !Number.isSafeInteger(asset.size) || (asset.size as number) < 1
    ) return [];
    const expectedUrl = `${androidReleaseBaseUrl}/${value.tag_name}/${asset.name}`;
    return asset.browser_download_url === expectedUrl
      ? [{ name: asset.name, url: expectedUrl, size: asset.size as number }]
      : [];
  });
  if (assets.length === 0) throw new Error('This Frogtown Android release has no downloadable APKs yet.');
  return { tag: value.tag_name, version: match.slice(1).join('.'), assets };
}

export function isNewerAndroidRelease(installedVersion: string, latestVersion: string) {
  const parse = (version: string) => /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  const installed = parse(installedVersion), latest = parse(latestVersion);
  if (!installed || !latest) return false;
  for (let index = 1; index <= 3; index += 1) {
    const difference = Number(latest[index]) - Number(installed[index]);
    if (difference !== 0) return difference > 0;
  }
  return false;
}

export function selectAndroidApk(
  assets: AndroidApkAsset[],
  supportedArchitectures: string[] | null | undefined,
) {
  const byName = new Map(assets.map((asset) => [asset.name, asset]));
  const supported = new Set((supportedArchitectures ?? []).map((arch) => arch.toLowerCase().replaceAll(' ', '')));
  const specific = supported.has('arm64-v8a')
    ? byName.get('Frogtown-arm64-v8a.apk')
    : supported.has('armeabi-v7a') || supported.has('armeabi')
      ? byName.get('Frogtown-armeabi-v7a.apk')
      : undefined;
  return { preferred: specific ?? byName.get('Frogtown.apk') ?? assets[0], universal: byName.get('Frogtown.apk') };
}
