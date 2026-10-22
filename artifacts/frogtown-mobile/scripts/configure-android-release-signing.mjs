import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const required = [
  'ANDROID_KEYSTORE_PATH',
  'ANDROID_RELEASE_STORE_PASSWORD',
  'ANDROID_RELEASE_KEY_ALIAS',
  'ANDROID_RELEASE_KEY_PASSWORD',
];

const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Missing Android signing configuration: ${missing.join(', ')}`);
  process.exit(1);
}

const buildGradlePath = resolve('android/app/build.gradle');
let source = await readFile(buildGradlePath, 'utf8');

const signingConfigsPattern =
  /    signingConfigs \{\n([\s\S]*?)\n    \}\n    buildTypes \{/;
const signingMatch = source.match(signingConfigsPattern);
if (!signingMatch || signingMatch[1].includes('        release {')) {
  throw new Error('Unexpected Android signingConfigs block; refusing to build with an unknown signing setup.');
}

const releaseConfig = `        release {
            storeFile file(System.getenv("ANDROID_KEYSTORE_PATH"))
            storePassword System.getenv("ANDROID_RELEASE_STORE_PASSWORD")
            keyAlias System.getenv("ANDROID_RELEASE_KEY_ALIAS")
            keyPassword System.getenv("ANDROID_RELEASE_KEY_PASSWORD")
        }`;
source = source.replace(
  signingConfigsPattern,
  `    signingConfigs {\n${signingMatch[1]}\n${releaseConfig}\n    }\n    buildTypes {`,
);

const debugReleaseSigning =
  '            signingConfig signingConfigs.debug\n            def enableShrinkResources';
if (!source.includes(debugReleaseSigning)) {
  throw new Error('Expected generated release build to use debug signing; refusing to continue.');
}
source = source.replace(
  debugReleaseSigning,
  '            signingConfig signingConfigs.release\n            def enableShrinkResources',
);

await writeFile(buildGradlePath, source);
