import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyMessage } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  createLadyChainSignInMessage,
  LADYCHAIN_CHAIN_ID,
} from "../src/lib/ladychain-auth.ts";
import {
  isEvmWalletAddress,
  isWalletIdentity,
  isXrplWalletAddress,
  normalizeWalletIdentity,
} from "../src/lib/wallet-identity.ts";

test("wallet identities distinguish XRPL and normalized EVM address formats", () => {
  const xrplAddress = "r123456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const evmAddress = "0xAabbccDDeeFF0011223344556677889900aAbBcC";

  assert.equal(isXrplWalletAddress(xrplAddress), true);
  assert.equal(isEvmWalletAddress(evmAddress), true);
  assert.equal(isWalletIdentity(xrplAddress), true);
  assert.equal(isWalletIdentity(evmAddress), true);
  assert.equal(normalizeWalletIdentity(evmAddress), evmAddress.toLowerCase());
  assert.equal(normalizeWalletIdentity(xrplAddress), xrplAddress);
  assert.equal(isWalletIdentity("0xnot-an-address"), false);
});

test("LadyChain sign-in message binds the wallet, origin, chain and expiry", async () => {
  const account = privateKeyToAccount(`0x${"01".repeat(32)}`);
  const address = account.address.toLowerCase();
  const origin = "https://frogtown.online";
  const issuedAt = new Date("2026-10-19T12:00:00.000Z");
  const expiresAt = new Date("2026-10-19T12:05:00.000Z");
  const message = createLadyChainSignInMessage(
    origin,
    address,
    "a".repeat(64),
    issuedAt,
    expiresAt,
  );
  const signature = await account.signMessage({ message });

  assert.match(message, /Chain ID: 589/);
  assert.match(message, /URI: https:\/\/frogtown\.online/);
  assert.match(message, new RegExp(address));
  assert.equal(LADYCHAIN_CHAIN_ID, 589);
  assert.equal(await verifyMessage({ address: account.address, message, signature }), true);
  assert.equal(await verifyMessage({
    address: account.address,
    message: message.replace("Chain ID: 589", "Chain ID: 1"),
    signature,
  }), false);
});
