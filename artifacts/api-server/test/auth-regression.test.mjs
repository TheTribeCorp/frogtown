import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { createServer } from "node:net";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

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

function sessionCookie(walletAddress, expiresAt = Date.now() + 60_000) {
  const payload = Buffer.from(JSON.stringify({ walletAddress, expiresAt })).toString("base64url");
  const signature = createHmac("sha256", testSecret).update(payload).digest("base64url");
  return `swamp_session=${payload}.${signature}`;
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

before(async () => {
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [path.join(apiDir, "dist/index.mjs")], {
    cwd: apiDir,
    env: { ...process.env, NODE_ENV: "test", PORT: String(port), SESSION_SECRET: testSecret },
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
    ["/api/conversations/wallet-test/read", "POST", { messageId: "message-test" }],
    ["/api/conversations/wallet-test/messages", "POST", { senderAddress: walletA, messageId: "11111111-1111-4111-8111-111111111111", body: "e2ee:v1:test" }],
    ["/api/conversations/wallet-test/keys", "GET"],
    ["/api/events", "GET"],
    ["/api/wallet/keys/" + walletA, "GET"],
    ["/api/wallet/keys", "PUT", { publicKey: "not-a-key" }],
    ["/api/groups?walletAddress=" + walletA, "GET"],
    ["/api/groups", "POST", { name: "test", description: "", creatorAddress: walletA }],
    ["/api/groups/group-test/join", "POST", { walletAddress: walletA }],
    ["/api/timeline/posts", "GET"],
    ["/api/timeline/posts", "POST", { body: "public post" }],
    ["/api/timeline/posts/post-test/likes", "POST"],
    ["/api/timeline/posts/post-test/likes", "DELETE"],
    ["/api/timeline/posts/post-test/comments", "GET"],
    ["/api/timeline/posts/post-test/comments", "POST", { body: "comment" }],
    ["/api/timeline/reports", "POST", { subjectType: "post", subjectId: "post-test", category: "spam" }],
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
  ];

  for (const [pathname, method, body] of authenticatedMismatches) {
    const response = await request(pathname, { method, cookie: validCookie, body });
    assert.equal(response.status, 403, `${method} ${pathname} should reject a wallet different from the session`);
  }
});

test("authenticated non-members cannot fetch, decrypt, send, or mark another conversation read", async () => {
  const cookie = sessionCookie(walletA);
  const conversationId = "non-member-authorization-check";
  const requests = [
    ["/api/conversations/" + conversationId + "/messages?walletAddress=" + walletA, "GET"],
    ["/api/conversations/" + conversationId + "/keys", "GET"],
    ["/api/conversations/" + conversationId + "/read", "POST", { messageId: "33333333-3333-4333-8333-333333333333" }],
    ["/api/conversations/" + conversationId + "/messages", "POST", {
      senderAddress: walletA,
      messageId: "44444444-4444-4444-8444-444444444444",
      body: "e2ee:v1:recipient-encrypted-payload",
    }],
  ];

  for (const [pathname, method, body] of requests) {
    const response = await request(pathname, { method, cookie, body });
    assert.equal(response.status, 403, `${method} ${pathname} should require conversation membership`);
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
