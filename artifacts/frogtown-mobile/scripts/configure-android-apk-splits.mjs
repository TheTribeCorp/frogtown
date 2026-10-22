import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const gradlePath = path.resolve('android/app/build.gradle');
const marker = '// Frogtown signed per-architecture APKs, plus a universal fallback.';
const configuration = `${marker}
android {
    splits {
        abi {
            enable true
            reset()
            include "arm64-v8a", "armeabi-v7a"
            universalApk true
        }
    }
}
`;

const gradle = await readFile(gradlePath, 'utf8');
if (!gradle.includes('android {')) throw new Error('Generated Android app Gradle file has no android configuration.');
if (!gradle.includes(marker)) {
  await writeFile(gradlePath, `${gradle.trimEnd()}\n\n${configuration}`);
}
console.info('Configured signed arm64, armeabi-v7a, and universal APK variants.');
