import { useEffect } from 'react';
import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { useRouter } from 'expo-router';
import { useSession } from '@/providers/session';
import type { NotificationResponse } from 'expo-notifications';
import { readSecure } from '@/lib/storage';
export function NotificationNavigation() {
  const { wallet } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (!wallet || Platform.OS === 'web' || Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void import('expo-notifications').then(async (Notifications) => {
      if (disposed) return;
      Notifications.setNotificationHandler({ handleNotification: async () => ({
        shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false,
      }) });
      const open = (response: NotificationResponse | null) => {
        if (disposed) return;
        const id = response?.notification.request.content.data?.conversationId;
        if (typeof id === 'string' && /^conversation-[a-z0-9-]{1,80}$/i.test(id)) {
          router.push({ pathname: '/chat/[id]', params: { id } });
          void Notifications.clearLastNotificationResponseAsync();
        }
      };
      const response = Notifications.addNotificationResponseReceivedListener(open);
      const tokenChange = Notifications.addPushTokenListener(() => {
        void readSecure(`frogtown.push.${wallet}`).then(async (id) => {
          if (id && !disposed) {
            const { enableMessageAlerts } = await import('@/lib/notifications');
            await enableMessageAlerts(wallet);
          }
        }).catch(() => {});
      });
      cleanup = () => { response.remove(); tokenChange.remove(); };
      open(await Notifications.getLastNotificationResponseAsync());
    });
    return () => { disposed = true; cleanup?.(); };
  }, [wallet, router]);
  return null;
}
