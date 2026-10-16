import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { after, before, test } from "node:test";
import pg from "pg";
import { fileURLToPath } from "node:url";
import path from "node:path";

const { Client } = pg;
const testSecret = "swamp-auth-regression-only-local-test-key-not-a-real-secret";
const walletA = "r123456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const walletB = "r987654321ZYXWVUTSRQPNMLKJHGFEDCBA";
const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let child;
let baseUrl;

async function freePort() {
  const listener = createServer();
  await new Promise((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  const address = listener.address();
  if (!address || typeof address === "string") throw new Error("Could not reserve a test port.");
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

function sessionCookie(walletAddress, expiresAt = Date.now() + 60_000, secret = testSecret) {
  const payload = Buffer.from(JSON.stringify({ walletAddress, expiresAt })).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `swamp_session=${payload}.${signature}`;
}

function randomWalletAddress() {
  return `r${randomUUID().replaceAll("-", "").replaceAll("0", "1")}`;
}

function recipientEnvelope(walletAddresses) {
  const entries = Object.fromEntries(walletAddresses.map((walletAddress) => [
    walletAddress,
    {
      iv: Buffer.alloc(12, 1).toString("base64url"),
      ciphertext: Buffer.alloc(16, 2).toString("base64url"),
    },
  ]));
  return `e2ee:v1:${Buffer.from(JSON.stringify({ version: 1, entries })).toString("base64url")}`;
}

async function registerWalletKey(walletAddress) {
  const publicKey = JSON.stringify({
    kty: "EC",
    crv: "P-256",
    x: Buffer.alloc(32, 1).toString("base64url"),
    y: Buffer.alloc(32, 2).toString("base64url"),
    ext: true,
    key_ops: [],
  });
  const response = await request("/api/wallet/keys", {
    method: "PUT",
    cookie: sessionCookie(walletAddress),
    body: { publicKey },
  });
  assert.ok([200, 201].includes(response.status), `wallet key registration should succeed, got ${response.status}`);
}

async function request(pathname, { method = "GET", cookie, body, origin } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (origin) headers.origin = origin;
  if (body !== undefined) headers["content-type"] = "application/json";
  return fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function openMessageEvents(walletAddress) {
  const controller = new AbortController();
  const response = await fetch(`${baseUrl}/api/events`, {
    headers: { cookie: sessionCookie(walletAddress) },
    signal: controller.signal,
  });
  assert.equal(response.status, 200);
  assert.ok(response.body, "authenticated event stream should have a response body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  return {
    async nextEvent() {
      const timeout = setTimeout(() => controller.abort(), 5_000);
      try {
        while (true) {
          const start = buffer.indexOf("data: ");
          if (start >= 0) {
            const end = buffer.indexOf("\n", start);
            if (end >= 0) {
              const data = buffer.slice(start + 6, end).trim();
              buffer = buffer.slice(end + 1);
              const event = JSON.parse(data);
              if (event.type !== "ready") return event;
              continue;
            }
          }
          const { value, done } = await reader.read();
          if (done) throw new Error("Event stream closed before the message notification arrived.");
          buffer += decoder.decode(value, { stream: true });
        }
      } catch (error) {
        if (controller.signal.aborted) throw new Error("Timed out waiting for a message notification.");
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    },
    close() {
      controller.abort();
    },
  };
}

before(async () => {
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [path.join(apiDir, "dist/index.mjs")], {
    cwd: apiDir,
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(port),
      SESSION_SECRET: testSecret,
      FROGTOWN_MODERATOR_WALLETS: walletB,
    },
    stdio: "ignore",
  });

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("API server exited before authorization tests started.");
    try {
      const response = await request("/api/wallet/me");
      if (response.status === 401) return;
    } catch {
      // The child server has not started listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("API server did not start in time for authorization tests.");
});

after(() => {
  child?.kill("SIGTERM");
});

test("preview deployments use a separate session signing secret", async () => {
  const port = await freePort();
  const previewSecret = "preview-auth-regression-only-local-test-key";
  const productionSecret = "production-auth-regression-only-local-test-key";
  const previewChild = spawn(process.execPath, [path.join(apiDir, "dist/index.mjs")], {
    cwd: apiDir,
    env: {
      ...process.env,
      NODE_ENV: "test",
      VERCEL_ENV: "preview",
      PORT: String(port),
      SESSION_SECRET: productionSecret,
      PREVIEW_SESSION_SECRET: previewSecret,
    },
    stdio: "ignore",
  });

  try {
    const deadline = Date.now() + 10_000;
    let started = false;
    while (Date.now() < deadline) {
      if (previewChild.exitCode !== null) {
        throw new Error("Preview-mode API exited before serving authorization requests.");
      }
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/wallet/me`);
        if (response.status === 401) {
          started = true;
          break;
        }
      } catch {
        // The child server has not started listening yet.
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(started, true, "preview-mode API should start and reject missing cookies");

    const previewCookie = await fetch(`http://127.0.0.1:${port}/api/wallet/me`, {
      headers: { cookie: sessionCookie(walletA, Date.now() + 60_000, previewSecret) },
    });
    assert.equal(previewCookie.status, 200, "preview signing secret should authenticate preview sessions");

    const productionCookie = await fetch(`http://127.0.0.1:${port}/api/wallet/me`, {
      headers: { cookie: sessionCookie(walletA, Date.now() + 60_000, productionSecret) },
    });
    assert.equal(productionCookie.status, 401, "production signing secret must not authenticate preview sessions");
  } finally {
    previewChild.kill("SIGTERM");
  }
});

test("wallet authentication and ownership guards reject unauthenticated or mismatched callers", async () => {
  const invalidSessions = [
    undefined,
    "swamp_session=not-a-signed-session",
    sessionCookie(walletA, Date.now() - 1),
  ];
  for (const cookie of invalidSessions) {
    const response = await request("/api/wallet/me", { cookie });
    assert.equal(response.status, 401, "invalid session should be rejected");
  }

  const crossOrigin = await request("/api/wallet/me", { origin: "https://attacker.example" });
  assert.equal(crossOrigin.status, 401);
  assert.equal(crossOrigin.headers.get("access-control-allow-origin"), null);
  assert.equal(crossOrigin.headers.get("access-control-allow-credentials"), null);

  const validCookie = sessionCookie(walletA);
  const identityResponse = await request("/api/wallet/me", { cookie: validCookie });
  assert.equal(identityResponse.status, 200);
  assert.equal((await identityResponse.json()).walletAddress, walletA);

  const unauthenticated = [
    ["/api/conversations?walletAddress=" + walletA, "GET"],
    ["/api/conversations/wallet-test/messages?walletAddress=" + walletA, "GET"],
    ["/api/conversations/wallet-test/history-share-work", "GET"],
    ["/api/conversations/wallet-test/history-shares", "GET"],
    ["/api/conversations/wallet-test/history-shares", "POST", { messageId: "11111111-1111-4111-8111-111111111111", recipientAddress: walletB, body: recipientEnvelope([walletB]) }],
    ["/api/conversations/wallet-test/read", "POST", { messageId: "message-test" }],
    ["/api/conversations/wallet-test/messages", "POST", { senderAddress: walletA, messageId: "11111111-1111-4111-8111-111111111111", body: "e2ee:v1:test" }],
    ["/api/conversations/wallet-test/keys", "GET"],
    ["/api/events", "GET"],
    ["/api/wallet/keys/" + walletA, "GET"],
    ["/api/wallet/keys", "PUT", { publicKey: "not-a-key" }],
    ["/api/wallets/" + walletA + "/hermit-tick?refresh=true", "GET"],
    ["/api/groups?walletAddress=" + walletA, "GET"],
    ["/api/groups", "POST", { name: "test", description: "", creatorAddress: walletA }],
    ["/api/groups/group-test/join", "POST", { walletAddress: walletA }],
    ["/api/timeline/posts", "GET"],
    ["/api/timeline/posts", "POST", { body: "public post" }],
    ["/api/timeline/posts/post-test", "PATCH", { body: "edited public post" }],
    ["/api/timeline/posts/post-test", "DELETE"],
    ["/api/timeline/posts/post-test/likes", "POST"],
    ["/api/timeline/posts/post-test/likes", "DELETE"],
    ["/api/timeline/posts/post-test/comments", "GET"],
    ["/api/timeline/posts/post-test/comments", "POST", { body: "comment" }],
    ["/api/timeline/posts/post-test/comments/comment-test", "PATCH", { body: "edited comment" }],
    ["/api/timeline/posts/post-test/comments/comment-test", "DELETE"],
    ["/api/timeline/reports", "POST", { subjectType: "post", subjectId: "post-test", category: "spam" }],
    ["/api/timeline/moderation/access", "GET"],
    ["/api/timeline/moderation/reports", "GET"],
    ["/api/timeline/moderation/reports/post/post-test", "POST", { action: "dismiss" }],
    ["/api/gamification/summary", "GET"],
    ["/api/gamification/check-in", "POST"],
    ["/api/gamification/leaderboard", "GET"],
    ["/api/gamification/coin-flips", "POST", { requestId: randomUUID(), choice: "heads" }],
  ];

  for (const [pathname, method, body] of unauthenticated) {
    const response = await request(pathname, { method, body });
    assert.equal(response.status, 401, `${method} ${pathname} should require a wallet session`);
  }

  const authenticatedMismatches = [
    ["/api/conversations?walletAddress=" + walletB, "GET"],
    ["/api/conversations/wallet-test/messages?walletAddress=" + walletB, "GET"],
    ["/api/conversations/wallet-test/messages", "POST", { senderAddress: walletB, messageId: "22222222-2222-4222-8222-222222222222", body: "e2ee:v1:test" }],
    ["/api/conversations", "POST", { walletAddress: walletB, fromWalletAddress: walletB }],
    ["/api/groups?walletAddress=" + walletB, "GET"],
    ["/api/groups", "POST", { name: "test", description: "", creatorAddress: walletB }],
    ["/api/groups/group-test/join", "POST", { walletAddress: walletB }],
    ["/api/wallets/" + walletB + "/hermit-tick?refresh=true", "GET"],
  ];

  for (const [pathname, method, body] of authenticatedMismatches) {
    const response = await request(pathname, { method, cookie: validCookie, body });
    assert.equal(response.status, 403, `${method} ${pathname} should reject a wallet different from the session`);
  }
});

test("health check reports database outages without exposing connection details", async () => {
  const healthy = await request("/api/healthz");
  assert.equal(healthy.status, 200);
  assert.deepEqual(await healthy.json(), { status: "ok", database: "ok" });

  const port = await freePort();
  const unhealthyChild = spawn(process.execPath, [path.join(apiDir, "dist/index.mjs")], {
    cwd: apiDir,
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(port),
      SESSION_SECRET: testSecret,
      DATABASE_URL: "postgresql://healthcheck:invalid@127.0.0.1:1/frogtown",
    },
    stdio: "ignore",
  });

  try {
    const deadline = Date.now() + 8_000;
    let response;
    while (Date.now() < deadline) {
      if (unhealthyChild.exitCode !== null) {
        throw new Error("Health-check API exited before serving the simulated database outage.");
      }
      try {
        response = await fetch(`http://127.0.0.1:${port}/api/healthz`);
        if (response.status === 503) break;
      } catch {
        // The child API has not started listening yet.
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    assert.ok(response, "health-check API should respond during the simulated database outage");
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      status: "unavailable",
      database: "unavailable",
    });
  } finally {
    unhealthyChild.kill("SIGTERM");
  }
});

test("only current conversation members can fetch messages and keys, and message envelopes exclude outsiders", async () => {
  const sender = randomWalletAddress();
  const recipient = randomWalletAddress();
  const outsider = randomWalletAddress();
  const conversationResponse = await request("/api/conversations", {
    method: "POST",
    cookie: sessionCookie(sender),
    body: { walletAddress: recipient, fromWalletAddress: sender },
  });
  assert.equal(conversationResponse.status, 201);
  const conversation = await conversationResponse.json();

  const messageId = randomUUID();
  const encryptedBody = recipientEnvelope([sender, recipient]);
  const sent = await request(`/api/conversations/${conversation.id}/messages`, {
    method: "POST",
    cookie: sessionCookie(sender),
    body: { senderAddress: sender, messageId, body: encryptedBody },
  });
  assert.equal(sent.status, 201);

  const recipientMessages = await request(
    `/api/conversations/${conversation.id}/messages?walletAddress=${recipient}`,
    { cookie: sessionCookie(recipient) },
  );
  assert.equal(recipientMessages.status, 200);
  const received = await recipientMessages.json();
  assert.equal(received.find((message) => message.id === messageId)?.body, encryptedBody);

  const recipientKeys = await request(`/api/conversations/${conversation.id}/keys`, {
    cookie: sessionCookie(recipient),
  });
  assert.equal(recipientKeys.status, 200);
  assert.deepEqual(
    (await recipientKeys.json()).map((key) => key.walletAddress).sort(),
    [sender, recipient].sort(),
  );

  const outsiderRequests = [
    [`/api/conversations/${conversation.id}/messages?walletAddress=${outsider}`, "GET"],
    [`/api/conversations/${conversation.id}/keys`, "GET"],
    [`/api/conversations/${conversation.id}/read`, "POST", { messageId }],
    [`/api/conversations/${conversation.id}/messages`, "POST", {
      senderAddress: outsider,
      messageId: randomUUID(),
      body: recipientEnvelope([outsider]),
    }],
  ];
  for (const [pathname, method, body] of outsiderRequests) {
    const response = await request(pathname, { method, cookie: sessionCookie(outsider), body });
    assert.equal(response.status, 403, `${method} ${pathname} should require conversation membership`);
  }

  const leakedEnvelope = await request(`/api/conversations/${conversation.id}/messages`, {
    method: "POST",
    cookie: sessionCookie(sender),
    body: {
      senderAddress: sender,
      messageId: randomUUID(),
      body: recipientEnvelope([sender, recipient, outsider]),
    },
  });
  assert.equal(leakedEnvelope.status, 400, "the API must reject envelopes addressed to non-members");
});

test("starting a private chat never reuses a shared group conversation", async () => {
  const sender = randomWalletAddress();
  const recipient = randomWalletAddress();
  const groupObserver = randomWalletAddress();
  await Promise.all([sender, recipient, groupObserver].map(registerWalletKey));

  const groupResponse = await request("/api/groups", {
    method: "POST",
    cookie: sessionCookie(sender),
    body: { name: `Private chat isolation ${randomUUID()}`, description: "", creatorAddress: sender },
  });
  assert.equal(groupResponse.status, 201);
  const group = await groupResponse.json();

  for (const walletAddress of [recipient, groupObserver]) {
    const joined = await request(`/api/groups/${group.id}/join`, {
      method: "POST",
      cookie: sessionCookie(walletAddress),
      body: { walletAddress },
    });
    assert.equal(joined.status, 200);
  }

  const directResponse = await request("/api/conversations", {
    method: "POST",
    cookie: sessionCookie(sender),
    body: { walletAddress: recipient, fromWalletAddress: sender },
  });
  assert.equal(directResponse.status, 201);
  const directConversation = await directResponse.json();
  assert.equal(directConversation.type, "direct");
  assert.notEqual(directConversation.id, group.conversationId);

  const messageId = randomUUID();
  const send = await request(`/api/conversations/${directConversation.id}/messages`, {
    method: "POST",
    cookie: sessionCookie(sender),
    body: {
      senderAddress: sender,
      messageId,
      body: recipientEnvelope([sender, recipient]),
    },
  });
  assert.equal(send.status, 201);

  const recipientMessages = await request(
    `/api/conversations/${directConversation.id}/messages?walletAddress=${recipient}`,
    { cookie: sessionCookie(recipient) },
  );
  assert.equal(recipientMessages.status, 200);
  assert.ok((await recipientMessages.json()).some((message) => message.id === messageId));

  const groupObserverMessages = await request(
    `/api/conversations/${directConversation.id}/messages?walletAddress=${groupObserver}`,
    { cookie: sessionCookie(groupObserver) },
  );
  assert.equal(groupObserverMessages.status, 403);
});

test("simultaneous private-chat starts converge on one pending conversation", async () => {
  const walletA = randomWalletAddress();
  const walletB = randomWalletAddress();
  const start = (fromWalletAddress, walletAddress) => request("/api/conversations", {
    method: "POST",
    cookie: sessionCookie(fromWalletAddress),
    body: { walletAddress, fromWalletAddress },
  });
  const [first, second] = await Promise.all([
    start(walletA, walletB),
    start(walletB, walletA),
  ]);
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  const [conversationA, conversationB] = await Promise.all([first.json(), second.json()]);
  assert.equal(conversationA.id, conversationB.id);
  assert.equal(conversationA.type, "direct");
  assert.equal(conversationA.directStatus, "pending");
  assert.ok([walletA, walletB].includes(conversationA.requesterAddress));

  const [listA, listB] = await Promise.all([
    request(`/api/conversations?walletAddress=${walletA}`, { cookie: sessionCookie(walletA) }),
    request(`/api/conversations?walletAddress=${walletB}`, { cookie: sessionCookie(walletB) }),
  ]);
  assert.equal(listA.status, 200);
  assert.equal(listB.status, 200);
  assert.equal((await listA.json()).filter((item) => item.id === conversationA.id).length, 1);
  assert.equal((await listB.json()).filter((item) => item.id === conversationA.id).length, 1);
});

test("private-message requests are screened and only recipients can accept or decline", async () => {
  const sender = randomWalletAddress();
  const recipient = randomWalletAddress();
  const outsider = randomWalletAddress();
  const created = await request("/api/conversations", {
    method: "POST",
    cookie: sessionCookie(sender),
    body: { walletAddress: recipient, fromWalletAddress: sender },
  });
  assert.equal(created.status, 201);
  const conversation = await created.json();
  assert.equal(conversation.directStatus, "pending");
  assert.equal(conversation.requesterAddress, sender);

  const messageId = randomUUID();
  const introduction = await request(`/api/conversations/${conversation.id}/messages`, {
    method: "POST",
    cookie: sessionCookie(sender),
    body: { senderAddress: sender, messageId, body: recipientEnvelope([sender, recipient]) },
  });
  assert.equal(introduction.status, 201);

  const inbox = await request(`/api/conversations?walletAddress=${recipient}`, {
    cookie: sessionCookie(recipient),
  });
  const requestItem = (await inbox.json()).find((item) => item.id === conversation.id);
  assert.equal(requestItem.directStatus, "pending");
  assert.equal(requestItem.requesterAddress, sender);
  assert.equal(requestItem.otherWalletAddress, sender);
  assert.equal(requestItem.unreadCount, 1);

  const recipientCanReadIntro = await request(
    `/api/conversations/${conversation.id}/messages?walletAddress=${recipient}`,
    { cookie: sessionCookie(recipient) },
  );
  assert.equal(recipientCanReadIntro.status, 200);
  assert.equal((await recipientCanReadIntro.json()).find((message) => message.id === messageId).body, recipientEnvelope([sender, recipient]));

  const prematureReply = await request(`/api/conversations/${conversation.id}/messages`, {
    method: "POST",
    cookie: sessionCookie(recipient),
    body: { senderAddress: recipient, messageId: randomUUID(), body: recipientEnvelope([sender, recipient]) },
  });
  assert.equal(prematureReply.status, 403);
  const extraIntroduction = await request(`/api/conversations/${conversation.id}/messages`, {
    method: "POST",
    cookie: sessionCookie(sender),
    body: { senderAddress: sender, messageId: randomUUID(), body: recipientEnvelope([sender, recipient]) },
  });
  assert.equal(extraIntroduction.status, 409);

  for (const action of ["accept", "decline"]) {
    const outsiderAction = await request(`/api/conversations/${conversation.id}/request/${action}`, {
      method: "POST",
      cookie: sessionCookie(outsider),
    });
    assert.equal(outsiderAction.status, 403);
    const senderAction = await request(`/api/conversations/${conversation.id}/request/${action}`, {
      method: "POST",
      cookie: sessionCookie(sender),
    });
    assert.equal(senderAction.status, 403);
  }
  const accepted = await request(`/api/conversations/${conversation.id}/request/accept`, {
    method: "POST",
    cookie: sessionCookie(recipient),
  });
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).directStatus, "accepted");
  const reply = await request(`/api/conversations/${conversation.id}/messages`, {
    method: "POST",
    cookie: sessionCookie(recipient),
    body: { senderAddress: recipient, messageId: randomUUID(), body: recipientEnvelope([sender, recipient]) },
  });
  assert.equal(reply.status, 201);
});

test("declining and blocking stop direct messages without deleting old history or affecting groups", async () => {
  const sender = randomWalletAddress();
  const recipient = randomWalletAddress();
  await Promise.all([registerWalletKey(sender), registerWalletKey(recipient)]);

  const pendingResponse = await request("/api/conversations", {
    method: "POST",
    cookie: sessionCookie(sender),
    body: { walletAddress: recipient, fromWalletAddress: sender },
  });
  const pending = await pendingResponse.json();
  const declined = await request(`/api/conversations/${pending.id}/request/decline`, {
    method: "POST",
    cookie: sessionCookie(recipient),
  });
  assert.equal(declined.status, 200);
  assert.equal((await declined.json()).directStatus, "declined");
  const noRetryFromDeclinedSender = await request("/api/conversations", {
    method: "POST",
    cookie: sessionCookie(sender),
    body: { walletAddress: recipient, fromWalletAddress: sender },
  });
  assert.equal(noRetryFromDeclinedSender.status, 403);

  const renewed = await request("/api/conversations", {
    method: "POST",
    cookie: sessionCookie(recipient),
    body: { walletAddress: sender, fromWalletAddress: recipient },
  });
  assert.equal(renewed.status, 201);
  const acceptedConversation = await renewed.json();
  const accepted = await request(`/api/conversations/${acceptedConversation.id}/request/accept`, {
    method: "POST",
    cookie: sessionCookie(sender),
  });
  assert.equal(accepted.status, 200);
  const messageId = randomUUID();
  const historyMessage = await request(`/api/conversations/${acceptedConversation.id}/messages`, {
    method: "POST",
    cookie: sessionCookie(recipient),
    body: { senderAddress: recipient, messageId, body: recipientEnvelope([sender, recipient]) },
  });
  assert.equal(historyMessage.status, 201);

  const blocked = await request("/api/wallet/blocks", {
    method: "POST",
    cookie: sessionCookie(sender),
    body: { blockedWalletAddress: recipient },
  });
  assert.equal(blocked.status, 201);
  const blockedList = await request("/api/wallet/blocks", { cookie: sessionCookie(sender) });
  assert.equal((await blockedList.json()).some((item) => item.blockedWalletAddress === recipient), true);

  const senderConversations = await request(`/api/conversations?walletAddress=${sender}`, {
    cookie: sessionCookie(sender),
  });
  const blockedConversation = (await senderConversations.json()).find((item) => item.id === acceptedConversation.id);
  assert.equal(blockedConversation.directMessagingBlocked, true);

  const preservedHistory = await request(
    `/api/conversations/${acceptedConversation.id}/messages?walletAddress=${sender}`,
    { cookie: sessionCookie(sender) },
  );
  assert.equal(preservedHistory.status, 200);
  assert.ok((await preservedHistory.json()).some((message) => message.id === messageId));
  const blockedSend = await request(`/api/conversations/${acceptedConversation.id}/messages`, {
    method: "POST",
    cookie: sessionCookie(recipient),
    body: { senderAddress: recipient, messageId: randomUUID(), body: recipientEnvelope([sender, recipient]) },
  });
  assert.equal(blockedSend.status, 403);

  const groupResponse = await request("/api/groups", {
    method: "POST",
    cookie: sessionCookie(sender),
    body: { name: `Block isolation ${randomUUID()}`, description: "", creatorAddress: sender },
  });
  const group = await groupResponse.json();
  const joined = await request(`/api/groups/${group.id}/join`, {
    method: "POST",
    cookie: sessionCookie(recipient),
    body: { walletAddress: recipient },
  });
  assert.equal(joined.status, 200);
  const groupMessage = await request(`/api/conversations/${group.conversationId}/messages`, {
    method: "POST",
    cookie: sessionCookie(sender),
    body: { senderAddress: sender, messageId: randomUUID(), body: recipientEnvelope([sender, recipient]) },
  });
  assert.equal(groupMessage.status, 201, "a direct-message block must not restrict shared groups");

  const unblocked = await request(`/api/wallet/blocks/${recipient}`, {
    method: "DELETE",
    cookie: sessionCookie(sender),
  });
  assert.equal(unblocked.status, 204);
  const sendAfterUnblock = await request(`/api/conversations/${acceptedConversation.id}/messages`, {
    method: "POST",
    cookie: sessionCookie(sender),
    body: { senderAddress: sender, messageId: randomUUID(), body: recipientEnvelope([sender, recipient]) },
  });
  assert.equal(sendAfterUnblock.status, 201);
});

test("group messages reach registered-key members without waiting for keyless members", async () => {
  const sender = randomWalletAddress();
  const keylessMember = randomWalletAddress();
  await registerWalletKey(sender);
  const groupResponse = await request("/api/groups", {
    method: "POST",
    cookie: sessionCookie(sender),
    body: { name: `Key-ready room ${randomUUID()}`, description: "", creatorAddress: sender },
  });
  assert.equal(groupResponse.status, 201);
  const group = await groupResponse.json();
  const joinResponse = await request(`/api/groups/${group.id}/join`, {
    method: "POST",
    cookie: sessionCookie(keylessMember),
    body: { walletAddress: keylessMember },
  });
  assert.equal(joinResponse.status, 200);

  const partialRecipientSend = await request(`/api/conversations/${group.conversationId}/messages`, {
    method: "POST",
    cookie: sessionCookie(sender),
    body: {
      senderAddress: sender,
      messageId: randomUUID(),
      body: recipientEnvelope([sender]),
    },
  });
  assert.equal(partialRecipientSend.status, 201, "a keyless group member must not block sending to key-ready recipients");

  const incorrectlyIncludedKeylessMember = await request(`/api/conversations/${group.conversationId}/messages`, {
    method: "POST",
    cookie: sessionCookie(sender),
    body: {
      senderAddress: sender,
      messageId: randomUUID(),
      body: recipientEnvelope([sender, keylessMember]),
    },
  });
  assert.equal(incorrectlyIncludedKeylessMember.status, 400, "the server must reject envelopes including unregistered keys");

  await registerWalletKey(keylessMember);
  const fullyEncryptedSend = await request(`/api/conversations/${group.conversationId}/messages`, {
    method: "POST",
    cookie: sessionCookie(sender),
    body: {
      senderAddress: sender,
      messageId: randomUUID(),
      body: recipientEnvelope([sender, keylessMember]),
    },
  });
  assert.equal(fullyEncryptedSend.status, 201, "new sends should include the member after their key is registered");
});

test("group history shares are limited to new members and remain recipient-only", async () => {
  const owner = randomWalletAddress();
  const lateJoiner = randomWalletAddress();
  const outsider = randomWalletAddress();
  await registerWalletKey(owner);
  const publicKey = JSON.stringify({
    kty: "EC",
    crv: "P-256",
    x: Buffer.alloc(32, 3).toString("base64url"),
    y: Buffer.alloc(32, 4).toString("base64url"),
  });
  const keyResponse = await request("/api/wallet/keys", {
    method: "PUT",
    cookie: sessionCookie(lateJoiner),
    body: { publicKey },
  });
  assert.equal(keyResponse.status, 201);

  const groupResponse = await request("/api/groups", {
    method: "POST",
    cookie: sessionCookie(owner),
    body: { name: `History test ${randomUUID()}`, description: "", creatorAddress: owner },
  });
  assert.equal(groupResponse.status, 201);
  const group = await groupResponse.json();
  const messageId = randomUUID();
  const sourceBody = recipientEnvelope([owner]);
  const sent = await request(`/api/conversations/${group.conversationId}/messages`, {
    method: "POST",
    cookie: sessionCookie(owner),
    body: { messageId, senderAddress: owner, body: sourceBody },
  });
  assert.equal(sent.status, 201);
  await new Promise((resolve) => setTimeout(resolve, 20));

  const joined = await request(`/api/groups/${group.id}/join`, {
    method: "POST",
    cookie: sessionCookie(lateJoiner),
    body: { walletAddress: lateJoiner },
  });
  assert.equal(joined.status, 200);

  const workResponse = await request(`/api/conversations/${group.conversationId}/history-share-work`, {
    cookie: sessionCookie(owner),
  });
  assert.equal(workResponse.status, 200);
  const work = await workResponse.json();
  assert.equal(work.length, 1);
  assert.equal(work[0].messageId, messageId);
  assert.equal(work[0].recipientAddress, lateJoiner);

  const unauthorizedShare = await request(`/api/conversations/${group.conversationId}/history-shares`, {
    method: "POST",
    cookie: sessionCookie(lateJoiner),
    body: { messageId, recipientAddress: lateJoiner, body: recipientEnvelope([lateJoiner]) },
  });
  assert.equal(unauthorizedShare.status, 403, "a new member cannot reshare history they were not present for");

  const invalidRecipients = await request(`/api/conversations/${group.conversationId}/history-shares`, {
    method: "POST",
    cookie: sessionCookie(owner),
    body: { messageId, recipientAddress: lateJoiner, body: recipientEnvelope([owner, lateJoiner]) },
  });
  assert.equal(invalidRecipients.status, 400, "a history share must be encrypted only for its named recipient");

  const encryptedShare = recipientEnvelope([lateJoiner]);
  const storedShare = await request(`/api/conversations/${group.conversationId}/history-shares`, {
    method: "POST",
    cookie: sessionCookie(owner),
    body: { messageId, recipientAddress: lateJoiner, body: encryptedShare },
  });
  assert.equal(storedShare.status, 201);

  const recipientShares = await request(`/api/conversations/${group.conversationId}/history-shares`, {
    cookie: sessionCookie(lateJoiner),
  });
  assert.equal(recipientShares.status, 200);
  assert.equal((await recipientShares.json())[0].body, encryptedShare);
  const ownerShares = await request(`/api/conversations/${group.conversationId}/history-shares`, {
    cookie: sessionCookie(owner),
  });
  assert.deepEqual(await ownerShares.json(), [], "only the named recipient can fetch the share");

  const outsiderWork = await request(`/api/conversations/${group.conversationId}/history-share-work`, {
    cookie: sessionCookie(outsider),
  });
  assert.equal(outsiderWork.status, 403);
});

test("message events reach private-chat and group recipients with sender metadata", async () => {
  const sender = randomWalletAddress();
  const recipient = randomWalletAddress();
  const directResponse = await request("/api/conversations", {
    method: "POST",
    cookie: sessionCookie(sender),
    body: { walletAddress: recipient, fromWalletAddress: sender },
  });
  assert.equal(directResponse.status, 201);
  const directConversation = await directResponse.json();

  const stream = await openMessageEvents(recipient);
  try {
    const plaintextResponse = await request(`/api/conversations/${directConversation.id}/messages`, {
      method: "POST",
      cookie: sessionCookie(sender),
      body: {
        senderAddress: sender,
        messageId: randomUUID(),
        body: "this must never be stored as readable text",
      },
    });
    assert.equal(plaintextResponse.status, 400, "the API must reject plaintext before persistence");

    const directMessageId = randomUUID();
    const directMessageResponse = await request(`/api/conversations/${directConversation.id}/messages`, {
      method: "POST",
      cookie: sessionCookie(sender),
      body: { senderAddress: sender, messageId: directMessageId, body: recipientEnvelope([sender, recipient]) },
    });
    assert.equal(directMessageResponse.status, 201);
    const directEvent = await stream.nextEvent();
    assert.equal(directEvent.type, "message.created");
    assert.equal(directEvent.conversationId, directConversation.id);
    assert.equal(directEvent.messageId, directMessageId);
    assert.equal(directEvent.senderAddress, sender);
    assert.equal(directEvent.isRequest, true);

    const groupResponse = await request("/api/groups", {
      method: "POST",
      cookie: sessionCookie(sender),
      body: { name: `Notification test ${randomUUID()}`, description: "", creatorAddress: sender },
    });
    assert.equal(groupResponse.status, 201);
    const group = await groupResponse.json();
    const joinResponse = await request(`/api/groups/${group.id}/join`, {
      method: "POST",
      cookie: sessionCookie(recipient),
      body: { walletAddress: recipient },
    });
    assert.equal(joinResponse.status, 200);

    await registerWalletKey(sender);
    await registerWalletKey(recipient);
    const groupMessageId = randomUUID();
    const groupMessageResponse = await request(`/api/conversations/${group.conversationId}/messages`, {
      method: "POST",
      cookie: sessionCookie(sender),
      body: { senderAddress: sender, messageId: groupMessageId, body: recipientEnvelope([sender, recipient]) },
    });
    assert.equal(groupMessageResponse.status, 201);
    const groupEvent = await stream.nextEvent();
    assert.equal(groupEvent.type, "message.created");
    assert.equal(groupEvent.conversationId, group.conversationId);
    assert.equal(groupEvent.messageId, groupMessageId);
    assert.equal(groupEvent.senderAddress, sender);
    assert.equal(groupEvent.isRequest, false);
  } finally {
    stream.close();
  }
});

test("timeline paging rejects invalid cursors and reports require an existing subject", async () => {
  const cookie = sessionCookie(walletA);
  const invalidLimit = await request("/api/timeline/posts?limit=51", { cookie });
  assert.equal(invalidLimit.status, 400);

  const invalidCursor = await request("/api/timeline/posts?cursor=not-a-valid-cursor", { cookie });
  assert.equal(invalidCursor.status, 400);

  const invalidReport = await request("/api/timeline/reports", {
    method: "POST",
    cookie,
    body: { subjectType: "post", subjectId: "missing-post", category: "not-a-category" },
  });
  assert.equal(invalidReport.status, 400);

  const missingSubject = await request("/api/timeline/reports", {
    method: "POST",
    cookie,
    body: { subjectType: "post", subjectId: "missing-post", category: "spam" },
  });
  assert.equal(missingSubject.status, 404);
});

test("group discovery uses persisted counts and does not invent online presence", async () => {
  const response = await request("/api/groups?walletAddress=" + walletA, {
    cookie: sessionCookie(walletA),
  });
  assert.equal(response.status, 200);
  const groups = await response.json();
  assert.ok(Array.isArray(groups));
  for (const group of groups) {
    assert.ok(Number.isInteger(group.memberCount) && group.memberCount >= 0);
    assert.equal(group.onlineCount, 0);
  }
});

test("timeline post and comment bursts are limited per wallet, including concurrent requests", async () => {
  const wallet = randomWalletAddress();
  const cookie = sessionCookie(wallet);
  const postRequests = await Promise.all(
    Array.from({ length: 6 }, (_, index) => request("/api/timeline/posts", {
      method: "POST",
      cookie,
      body: { body: `launch-test rate-limit post ${index}` },
    })),
  );
  const postStatuses = postRequests.map((response) => response.status).sort((left, right) => left - right);
  assert.deepEqual(postStatuses, [201, 201, 201, 201, 201, 429]);
  const limitedPost = postRequests.find((response) => response.status === 429);
  assert.ok(Number(limitedPost.headers.get("retry-after")) > 0);
  await Promise.all(postRequests.map((response) => response.arrayBuffer()));

  const commentWallet = randomWalletAddress();
  const commentCookie = sessionCookie(commentWallet);
  const seedPostResponse = await request("/api/timeline/posts", {
    method: "POST",
    cookie: commentCookie,
    body: { body: "launch-test comment rate-limit seed" },
  });
  assert.equal(seedPostResponse.status, 201);
  const seedPost = await seedPostResponse.json();
  const commentRequests = await Promise.all(
    Array.from({ length: 16 }, (_, index) => request(`/api/timeline/posts/${seedPost.id}/comments`, {
      method: "POST",
      cookie: commentCookie,
      body: { body: `launch-test rate-limit comment ${index}` },
    })),
  );
  const commentStatuses = commentRequests.map((response) => response.status).sort((left, right) => left - right);
  assert.deepEqual(commentStatuses, [...Array(15).fill(201), 429]);
  const limitedComment = commentRequests.find((response) => response.status === 429);
  assert.ok(Number(limitedComment.headers.get("retry-after")) > 0);
  await Promise.all(commentRequests.map((response) => response.arrayBuffer()));
});

test("timeline owners can edit and remove their content but cannot change another wallet's content", async () => {
  const ownerCookie = sessionCookie(walletA);
  const otherCookie = sessionCookie(walletB);
  const postResponse = await request("/api/timeline/posts", {
    method: "POST",
    cookie: ownerCookie,
    body: { body: "launch-test original post" },
  });
  assert.equal(postResponse.status, 201);
  const post = await postResponse.json();

  const forbiddenPostEdit = await request(`/api/timeline/posts/${post.id}`, {
    method: "PATCH",
    cookie: otherCookie,
    body: { body: "not the owner" },
  });
  assert.equal(forbiddenPostEdit.status, 403);

  const editedPost = await request(`/api/timeline/posts/${post.id}`, {
    method: "PATCH",
    cookie: ownerCookie,
    body: { body: "launch-test edited post" },
  });
  assert.equal(editedPost.status, 200);
  assert.equal((await editedPost.json()).body, "launch-test edited post");

  const commentResponse = await request(`/api/timeline/posts/${post.id}/comments`, {
    method: "POST",
    cookie: ownerCookie,
    body: { body: "launch-test original comment" },
  });
  assert.equal(commentResponse.status, 201);
  const comment = await commentResponse.json();

  const forbiddenCommentEdit = await request(`/api/timeline/posts/${post.id}/comments/${comment.id}`, {
    method: "PATCH",
    cookie: otherCookie,
    body: { body: "not the owner" },
  });
  assert.equal(forbiddenCommentEdit.status, 403);

  const editedComment = await request(`/api/timeline/posts/${post.id}/comments/${comment.id}`, {
    method: "PATCH",
    cookie: ownerCookie,
    body: { body: "launch-test edited comment" },
  });
  assert.equal(editedComment.status, 200);
  assert.equal((await editedComment.json()).body, "launch-test edited comment");

  const forbiddenCommentDelete = await request(`/api/timeline/posts/${post.id}/comments/${comment.id}`, {
    method: "DELETE",
    cookie: otherCookie,
  });
  assert.equal(forbiddenCommentDelete.status, 403);

  const deletedComment = await request(`/api/timeline/posts/${post.id}/comments/${comment.id}`, {
    method: "DELETE",
    cookie: ownerCookie,
  });
  assert.equal(deletedComment.status, 204);

  const forbiddenDelete = await request(`/api/timeline/posts/${post.id}`, {
    method: "DELETE",
    cookie: otherCookie,
  });
  assert.equal(forbiddenDelete.status, 403);

  const deletedPost = await request(`/api/timeline/posts/${post.id}`, {
    method: "DELETE",
    cookie: ownerCookie,
  });
  assert.equal(deletedPost.status, 204);
});

test("only configured moderators can review reports and dismiss or remove reported content", async () => {
  const memberCookie = sessionCookie(walletA);
  const moderatorCookie = sessionCookie(walletB);
  const memberAccess = await request("/api/timeline/moderation/access", { cookie: memberCookie });
  assert.equal(memberAccess.status, 200);
  assert.equal((await memberAccess.json()).isModerator, false);
  const access = await request("/api/timeline/moderation/access", { cookie: moderatorCookie });
  assert.equal(access.status, 200);
  assert.equal((await access.json()).isModerator, true);

  const memberQueue = await request("/api/timeline/moderation/reports", { cookie: memberCookie });
  assert.equal(memberQueue.status, 403);
  const memberHistory = await request("/api/timeline/moderation/history", { cookie: memberCookie });
  assert.equal(memberHistory.status, 403);
  const memberModerationAction = await request("/api/timeline/moderation/reports/post/unknown", {
    method: "POST",
    cookie: memberCookie,
    body: { action: "remove" },
  });
  assert.equal(memberModerationAction.status, 403);

  const postResponse = await request("/api/timeline/posts", {
    method: "POST",
    cookie: memberCookie,
    body: { body: "launch-test reported post" },
  });
  assert.equal(postResponse.status, 201);
  const post = await postResponse.json();
  const report = await request("/api/timeline/reports", {
    method: "POST",
    cookie: memberCookie,
    body: { subjectType: "post", subjectId: post.id, category: "spam", details: "test fixture" },
  });
  assert.equal(report.status, 201);

  const queue = await request("/api/timeline/moderation/reports", { cookie: moderatorCookie });
  assert.equal(queue.status, 200);
  const queueBody = await queue.json();
  assert.ok(queueBody.items.some((item) => item.subjectId === post.id));

  const dismissed = await request(`/api/timeline/moderation/reports/post/${post.id}`, {
    method: "POST",
    cookie: moderatorCookie,
    body: { action: "dismiss" },
  });
  assert.equal(dismissed.status, 200);

  const reportedAgain = await request("/api/timeline/reports", {
    method: "POST",
    cookie: memberCookie,
    body: { subjectType: "post", subjectId: post.id, category: "spam" },
  });
  assert.equal(reportedAgain.status, 201);
  const removed = await request(`/api/timeline/moderation/reports/post/${post.id}`, {
    method: "POST",
    cookie: moderatorCookie,
    body: { action: "remove" },
  });
  assert.equal(removed.status, 200);
  assert.equal((await removed.json()).action, "remove");

  const removedOwnerPost = await request(`/api/timeline/posts/${post.id}`, {
    method: "DELETE",
    cookie: memberCookie,
  });
  assert.equal(removedOwnerPost.status, 404);

  const historyResponse = await request("/api/timeline/moderation/history?limit=50", {
    cookie: moderatorCookie,
  });
  assert.equal(historyResponse.status, 200);
  const history = (await historyResponse.json()).items.filter((item) => item.subjectId === post.id);
  assert.deepEqual(history.map((item) => item.action).sort(), ["dismiss", "remove"]);
  assert.ok(history.every((item) => item.moderatorAddress === walletB));
  assert.ok(history.every((item) => item.contentSnapshot === "launch-test reported post"));
  assert.ok(history.every((item) => item.reportCount === 1));
});

test("daily quests, points, and coin flips are authenticated, idempotent, and server-awarded", async () => {
  const wallet = randomWalletAddress();
  const otherWallet = randomWalletAddress();
  const cookie = sessionCookie(wallet);
  const otherCookie = sessionCookie(otherWallet);
  const getSummary = async () => {
    const response = await request("/api/gamification/summary", { cookie });
    assert.equal(response.status, 200);
    return response.json();
  };
  const task = (summary, id) => summary.tasks.find((entry) => entry.id === id);

  const initial = await getSummary();
  const checkedIn = await request("/api/gamification/check-in", { method: "POST", cookie });
  assert.equal(checkedIn.status, 200);
  const afterCheckIn = await checkedIn.json();
  assert.equal(afterCheckIn.points, initial.points + 1);
  assert.equal(task(afterCheckIn, "check_in").completed, true);
  const repeatedCheckIn = await request("/api/gamification/check-in", { method: "POST", cookie });
  assert.equal((await repeatedCheckIn.json()).points, afterCheckIn.points, "same-day check-in must not award twice");

  const ownPostResponse = await request("/api/timeline/posts", {
    method: "POST",
    cookie,
    body: { body: `Quest test post ${randomUUID()}` },
  });
  assert.equal(ownPostResponse.status, 201);
  const ownPost = await ownPostResponse.json();
  const ownLike = await request(`/api/timeline/posts/${ownPost.id}/likes`, { method: "POST", cookie });
  assert.equal(ownLike.status, 200);
  const ownComment = await request(`/api/timeline/posts/${ownPost.id}/comments`, {
    method: "POST",
    cookie,
    body: { body: "A self-comment does not complete the engagement quest." },
  });
  assert.equal(ownComment.status, 201);
  const afterOwnActions = await getSummary();
  assert.equal(afterOwnActions.points, afterCheckIn.points + 1, "one original timeline post earns one point, but self-actions do not");
  assert.equal(task(afterOwnActions, "ledger_minute").completed, true);
  assert.equal(task(afterOwnActions, "community_engagement").progress, 0);

  const otherPostResponse = await request("/api/timeline/posts", {
    method: "POST",
    cookie: otherCookie,
    body: { body: `Community quest post ${randomUUID()}` },
  });
  assert.equal(otherPostResponse.status, 201);
  const otherPost = await otherPostResponse.json();
  const like = await request(`/api/timeline/posts/${otherPost.id}/likes`, { method: "POST", cookie });
  assert.equal(like.status, 200);
  const afterLike = await getSummary();
  assert.equal(task(afterLike, "community_engagement").progress, 1);
  assert.equal(afterLike.points, afterOwnActions.points);
  const comment = await request(`/api/timeline/posts/${otherPost.id}/comments`, {
    method: "POST",
    cookie,
    body: { body: "An eligible comment completes the pair." },
  });
  assert.equal(comment.status, 201);
  const afterEngagement = await getSummary();
  assert.equal(task(afterEngagement, "community_engagement").completed, true);
  assert.equal(afterEngagement.points, afterLike.points + 1);

  const groupResponse = await request("/api/groups", {
    method: "POST",
    cookie,
    body: { name: `Quest room ${randomUUID()}`, description: "", creatorAddress: wallet },
  });
  assert.equal(groupResponse.status, 201);
  const group = await groupResponse.json();
  await registerWalletKey(wallet);
  const messageId = randomUUID();
  const groupMessage = await request(`/api/conversations/${group.conversationId}/messages`, {
    method: "POST",
    cookie,
    body: { senderAddress: wallet, messageId, body: recipientEnvelope([wallet]) },
  });
  assert.equal(groupMessage.status, 201);
  const repeatedGroupMessage = await request(`/api/conversations/${group.conversationId}/messages`, {
    method: "POST",
    cookie,
    body: { senderAddress: wallet, messageId, body: recipientEnvelope([wallet]) },
  });
  assert.equal(repeatedGroupMessage.status, 200);
  const allQuests = await getSummary();
  assert.equal(task(allQuests, "room_spotlight").completed, true);
  assert.equal(allQuests.points, afterEngagement.points + 1, "duplicate message retries must not award twice");

  const leaderboardResponse = await request("/api/gamification/leaderboard", { cookie });
  assert.equal(leaderboardResponse.status, 200);
  const leaderboard = await leaderboardResponse.json();
  assert.ok(leaderboard.items.length <= 10);
  assert.deepEqual(leaderboard.items.map((entry) => entry.rank), leaderboard.items.map((_, index) => index + 1));
  assert.ok(leaderboard.items.every((entry, index) => index === 0 || leaderboard.items[index - 1].points >= entry.points));

  const requestId = randomUUID();
  const flipInput = { requestId, choice: "heads" };
  const balanceBeforeFlip = allQuests.points;
  const flipResponse = await request("/api/gamification/coin-flips", { method: "POST", cookie, body: flipInput });
  assert.equal(flipResponse.status, 200);
  const flip = await flipResponse.json();
  assert.equal(flip.stakePoints, 1);
  assert.equal(flip.payoutPoints, flip.won ? 1.8 : 0);
  assert.equal(flip.netChangePoints, flip.won ? 0.8 : -1);
  assert.equal(flip.points, balanceBeforeFlip + flip.netChangePoints);
  const replay = await request("/api/gamification/coin-flips", { method: "POST", cookie, body: flipInput });
  const replayedFlip = await replay.json();
  assert.equal(replay.status, 200);
  assert.equal(replayedFlip.id, flip.id);
  assert.equal(replayedFlip.points, flip.points, "a retried flip must not charge or pay a second time");
  const conflictingReplay = await request("/api/gamification/coin-flips", {
    method: "POST",
    cookie,
    body: { requestId, choice: "tails" },
  });
  assert.equal(conflictingReplay.status, 409);

  const emptyWalletCookie = sessionCookie(randomWalletAddress());
  const insufficient = await request("/api/gamification/coin-flips", {
    method: "POST",
    cookie: emptyWalletCookie,
    body: { requestId: randomUUID(), choice: "tails" },
  });
  assert.equal(insufficient.status, 409);
});

test("concurrent check-ins and coin-flip retries cannot duplicate points or overspend", async () => {
  const wallet = randomWalletAddress();
  const cookie = sessionCookie(wallet);
  const checkIns = await Promise.all([
    request("/api/gamification/check-in", { method: "POST", cookie }),
    request("/api/gamification/check-in", { method: "POST", cookie }),
  ]);
  assert.ok(checkIns.every((response) => response.status === 200));
  await Promise.all(checkIns.map((response) => response.arrayBuffer()));

  const checkInSummary = await request("/api/gamification/summary", { cookie }).then((response) => response.json());
  assert.equal(checkInSummary.points, 1, "simultaneous check-ins should award one point only");

  const repeatedRequest = { requestId: randomUUID(), choice: "heads" };
  const repeatedFlips = await Promise.all([
    request("/api/gamification/coin-flips", { method: "POST", cookie, body: repeatedRequest }),
    request("/api/gamification/coin-flips", { method: "POST", cookie, body: repeatedRequest }),
  ]);
  assert.ok(repeatedFlips.every((response) => response.status === 200));
  const repeatedResults = await Promise.all(repeatedFlips.map((response) => response.json()));
  assert.equal(repeatedResults[0].id, repeatedResults[1].id);
  assert.equal(repeatedResults[0].points, repeatedResults[1].points);
  assert.equal(
    repeatedResults[0].points,
    checkInSummary.points + repeatedResults[0].netChangePoints,
    "the same concurrent flip request must change the balance once",
  );

  const balanceBeforeRace = repeatedResults[0].points;
  const racingResponses = await Promise.all([
    request("/api/gamification/coin-flips", {
      method: "POST",
      cookie,
      body: { requestId: randomUUID(), choice: "heads" },
    }),
    request("/api/gamification/coin-flips", {
      method: "POST",
      cookie,
      body: { requestId: randomUUID(), choice: "tails" },
    }),
  ]);
  const racingResults = await Promise.all(racingResponses.map(async (response) => ({
    status: response.status,
    body: await response.json(),
  })));
  assert.ok(racingResults.every((result) => result.status === 200 || result.status === 409));
  const successfulFlips = racingResults.filter((result) => result.status === 200).map((result) => result.body);
  const expectedBalance = balanceBeforeRace
    + successfulFlips.reduce((total, flip) => total + flip.netChangePoints, 0);
  const finalSummary = await request("/api/gamification/summary", { cookie }).then((response) => response.json());
  assert.ok(finalSummary.points >= 0, "a concurrent wager must never overdraw the wallet");
  assert.ok(Math.abs(finalSummary.points - expectedBalance) < 1e-9);
});

test("points history is private to the signed-in wallet and paginates quest awards", async () => {
  const unauthorized = await request("/api/gamification/history");
  assert.equal(unauthorized.status, 401);

  const wallet = randomWalletAddress();
  const cookie = sessionCookie(wallet);
  const checkIn = await request("/api/gamification/check-in", { method: "POST", cookie });
  assert.equal(checkIn.status, 200);
  await checkIn.arrayBuffer();
  const post = await request("/api/timeline/posts", {
    method: "POST",
    cookie,
    body: { body: "launch-test points history post" },
  });
  assert.equal(post.status, 201);
  await post.arrayBuffer();

  const firstPageResponse = await request("/api/gamification/history?limit=1", { cookie });
  assert.equal(firstPageResponse.status, 200);
  const firstPage = await firstPageResponse.json();
  assert.equal(firstPage.items.length, 1);
  assert.ok(firstPage.nextCursor);

  const secondPageResponse = await request(
    `/api/gamification/history?limit=1&cursor=${encodeURIComponent(firstPage.nextCursor)}`,
    { cookie },
  );
  assert.equal(secondPageResponse.status, 200);
  const secondPage = await secondPageResponse.json();
  assert.equal(secondPage.items.length, 1);
  assert.equal(secondPage.nextCursor, null);
  assert.notEqual(firstPage.items[0].id, secondPage.items[0].id);
  assert.deepEqual(
    new Set([firstPage.items[0].description, secondPage.items[0].description]),
    new Set(["Daily check-in", "Timeline post"]),
  );

  const otherWalletHistory = await request("/api/gamification/history", {
    cookie: sessionCookie(randomWalletAddress()),
  });
  assert.equal(otherWalletHistory.status, 200);
  assert.deepEqual((await otherWalletHistory.json()).items, []);

  const invalidCursor = await request("/api/gamification/history?cursor=not-a-valid-cursor", { cookie });
  assert.equal(invalidCursor.status, 400);
});

test("the first 100-point balance earns the permanent Frog badge", async () => {
  const wallet = randomWalletAddress();
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      "INSERT INTO frogtown_gamification_profiles (wallet_address, points_hundredths) VALUES ($1, $2)",
      [wallet, 9900],
    );
  } finally {
    await client.end();
  }

  const checkIn = await request("/api/gamification/check-in", {
    method: "POST",
    cookie: sessionCookie(wallet),
  });
  assert.equal(checkIn.status, 200);
  const summary = await checkIn.json();
  assert.equal(summary.points, 100);
  assert.equal(summary.frogBadgeEarned, true);
  assert.ok(summary.frogBadgeEarnedAt);

  const flip = await request("/api/gamification/coin-flips", {
    method: "POST",
    cookie: sessionCookie(wallet),
    body: { requestId: randomUUID(), choice: "heads" },
  });
  assert.equal(flip.status, 200);
  assert.equal((await flip.json()).frogBadgeEarned, true);
});
