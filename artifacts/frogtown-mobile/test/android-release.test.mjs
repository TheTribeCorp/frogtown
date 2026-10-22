import assert from 'node:assert/strict';
import test from 'node:test';
import {
  androidReleaseBaseUrl, isNewerAndroidRelease, parseAndroidRelease, selectAndroidApk,
} from '../lib/android-release.ts';

const tag = 'android-v1.0.2';
const asset = (name, size) => ({
  name,
  size,
  browser_download_url: `${androidReleaseBaseUrl}/${tag}/${name}`,
});
const release = () => parseAndroidRelease({
  tag_name: tag,
  assets: [
    asset('Frogtown.apk', 70_000_000),
    asset('Frogtown-arm64-v8a.apk', 35_000_000),
    asset('Frogtown-armeabi-v7a.apk', 38_000_000),
  ],
});

test('release checker finds newer Android versions, including patch and major bumps', () => {
  assert.equal(isNewerAndroidRelease('1.0.1', '1.0.2'), true);
  assert.equal(isNewerAndroidRelease('1.0.1', '1.1.0'), true);
  assert.equal(isNewerAndroidRelease('1.9.9', '2.0.0'), true);
  assert.equal(isNewerAndroidRelease('1.0.2', '1.0.2'), false);
  assert.equal(isNewerAndroidRelease('1.2.0', '1.1.9'), false);
  assert.equal(isNewerAndroidRelease('development', '1.0.2'), false);
});

test('release metadata accepts only official Frogtown APK assets with real sizes', () => {
  const parsed = release();
  assert.equal(parsed.version, '1.0.2');
  assert.equal(parsed.assets.length, 3);
  assert.throws(() => parseAndroidRelease({ tag_name: 'malicious-tag', assets: [asset('Frogtown.apk', 10)] }));
  assert.throws(() => parseAndroidRelease({
    tag_name: tag,
    assets: [{ ...asset('Frogtown.apk', 10), browser_download_url: 'https://evil.example/Frogtown.apk' }],
  }));
});

test('update notice selects the device ABI APK and keeps a universal fallback', () => {
  const parsed = release();
  const arm64 = selectAndroidApk(parsed.assets, ['arm64-v8a']);
  assert.equal(arm64.preferred?.name, 'Frogtown-arm64-v8a.apk');
  assert.equal(arm64.universal?.name, 'Frogtown.apk');
  assert.equal(selectAndroidApk(parsed.assets, ['armeabi-v7a']).preferred?.name, 'Frogtown-armeabi-v7a.apk');
  assert.equal(selectAndroidApk(parsed.assets, null).preferred?.name, 'Frogtown.apk');
});
