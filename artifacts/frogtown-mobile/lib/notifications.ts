import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { registerMobilePushDevice } from '@workspace/api-client-react';
import { writeSecure } from './storage';

export async function enableMessageAlerts(wallet: string) {
  if (Platform.OS === 'web') throw new Error('Native alerts are available in the iOS and Android app, not this browser preview.');
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) throw new Error('Remote push needs an installed development or release build, not Expo Go.');
  if (!Device.isDevice) throw new Error('Use a physical phone to enable message alerts.');
  const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID || Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) throw new Error('This build has no Expo project ID. Configure the push project and rebuild the app.');
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('messages', {
    name: 'Encrypted messages', importance: Notifications.AndroidImportance.HIGH,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  });
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) permission = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowBadge: true, allowSound: true },
  });
  if (!permission.granted) throw new Error(permission.canAskAgain ? 'Notifications were not enabled. You can try again.' : 'Notifications are disabled. Enable them in your phone’s Settings.');
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  const saved = await registerMobilePushDevice({
    token, platform: Platform.OS as 'ios' | 'android',
    name: `${Device.modelName || 'Phone'} · ${Platform.OS}`.slice(0, 60),
  });
  await writeSecure(`frogtown.push.${wallet}`, saved.id);
  return saved.id;
}
