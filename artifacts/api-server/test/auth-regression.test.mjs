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

async function request(pathname, { method = "GET", cookie, body } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
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
