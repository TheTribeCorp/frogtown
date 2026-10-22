export interface InboxConversationState {
  id: string;
  type: string;
  directStatus?: string | null;
  requesterAddress?: string | null;
  unreadCount: number;
}

export function isIncomingMessageRequest(
  conversation: InboxConversationState,
  walletAddress: string,
): boolean {
  return conversation.type === "direct"
    && conversation.directStatus === "pending"
    && Boolean(conversation.requesterAddress)
    && conversation.requesterAddress !== walletAddress;
}

export function splitInboxConversations<T extends InboxConversationState>(
  conversations: readonly T[],
  walletAddress: string,
): { unread: T[]; read: T[] } {
  const unread: T[] = [];
  const read: T[] = [];

  for (const conversation of conversations) {
    if (conversation.unreadCount > 0 || isIncomingMessageRequest(conversation, walletAddress)) {
      unread.push(conversation);
    } else {
      read.push(conversation);
    }
  }

  return { unread, read };
}
