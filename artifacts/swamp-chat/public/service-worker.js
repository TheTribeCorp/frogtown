const FALLBACK_TITLE = 'New Frogtown message';

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = typeof payload.title === 'string' ? payload.title : FALLBACK_TITLE;
  const messageId = typeof payload.messageId === 'string' ? payload.messageId : '';
  const options = {
    body: 'An encrypted message is waiting. Message contents are never included in notifications.',
    tag: messageId ? `frogtown-message-${messageId}` : 'frogtown-message',
    renotify: false,
    data: {
      conversationId: typeof payload.conversationId === 'string' ? payload.conversationId : '',
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const conversationId = event.notification.data?.conversationId;
  const target = new URL(self.registration.scope);
  if (conversationId) target.searchParams.set('conversation', conversationId);

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const appWindow = windows.find((client) => client.url.startsWith(self.registration.scope));
    if (appWindow) {
      await appWindow.focus();
      if (conversationId) appWindow.postMessage({ type: 'frogtown:open-conversation', conversationId });
      return;
    }
    await self.clients.openWindow(target.href);
  })());
});
