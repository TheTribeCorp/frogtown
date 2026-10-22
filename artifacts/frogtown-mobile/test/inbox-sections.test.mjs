import assert from "node:assert/strict";
import test from "node:test";
import { isIncomingMessageRequest, splitInboxConversations } from "../lib/inbox-sections.ts";

const wallet = `0x${"a".repeat(40)}`;

test("incoming private-message requests with no counted messages still land in Unread", () => {
  const incoming = {
    id: "incoming",
    type: "direct",
    directStatus: "pending",
    requesterAddress: `0x${"b".repeat(40)}`,
    unreadCount: 0,
  };
  const sections = splitInboxConversations([incoming], wallet);

  assert.equal(isIncomingMessageRequest(incoming, wallet), true);
  assert.deepEqual(sections.unread.map((conversation) => conversation.id), ["incoming"]);
  assert.deepEqual(sections.read, []);
});

test("outgoing requests, read chats, and unread chats are assigned to the expected sections", () => {
  const conversations = [
    { id: "outgoing", type: "direct", directStatus: "pending", requesterAddress: wallet, unreadCount: 0 },
    { id: "read", type: "direct", directStatus: "accepted", requesterAddress: null, unreadCount: 0 },
    { id: "unread", type: "group", unreadCount: 2 },
  ];
  const sections = splitInboxConversations(conversations, wallet);

  assert.deepEqual(sections.unread.map((conversation) => conversation.id), ["unread"]);
  assert.deepEqual(sections.read.map((conversation) => conversation.id), ["outgoing", "read"]);
});
