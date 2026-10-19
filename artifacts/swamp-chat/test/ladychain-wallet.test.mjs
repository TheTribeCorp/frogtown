import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ensureLadyChainNetwork,
  findConnectedEvmProvider,
  normalizeEvmAddress,
  normalizeEvmChainId,
} from '../src/lib/ladychain-wallet.ts';

test('normalizes EVM addresses and LadyChain chain identifiers', () => {
  assert.equal(normalizeEvmAddress('0xAbCd000000000000000000000000000000000000'), '0xabcd000000000000000000000000000000000000');
  assert.equal(normalizeEvmAddress('rAddressIsNotEvm'), null);
  assert.equal(normalizeEvmChainId('0x24d'), 589);
  assert.equal(normalizeEvmChainId(589), 589);
});

test('chooses the provider that owns the signed-in account when several wallets are injected', async () => {
  const first = {
    request: async ({ method }) => method === 'eth_accounts'
      ? ['0x1111111111111111111111111111111111111111']
      : null,
  };
  const second = {
    request: async ({ method }) => method === 'eth_accounts'
      ? ['0x2222222222222222222222222222222222222222']
      : null,
  };
  const previousWindow = globalThis.window;
  globalThis.window = { ethereum: { providers: [first, second] } };

  try {
    assert.equal(
      await findConnectedEvmProvider(null, '0x2222222222222222222222222222222222222222'),
      second,
    );
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('does not request a network switch when already connected to LadyChain', async () => {
  const calls = [];
  const provider = {
    request: async ({ method }) => {
      calls.push(method);
      return method === 'eth_chainId' ? '0x24d' : null;
    },
  };

  await ensureLadyChainNetwork(provider);
  assert.deepEqual(calls, ['eth_chainId']);
});

test('adds and switches to LadyChain when the wallet does not know chain 589', async () => {
  const calls = [];
  let chainId = '0x1';
  let chainAdded = false;
  const provider = {
    request: async ({ method, params }) => {
      calls.push({ method, params });
      if (method === 'eth_chainId') return chainId;
      if (method === 'wallet_switchEthereumChain' && !chainAdded) {
        const error = new Error('unknown chain');
        error.code = 4902;
        throw error;
      }
      if (method === 'wallet_addEthereumChain') {
        chainAdded = true;
        return null;
      }
      if (method === 'wallet_switchEthereumChain') {
        chainId = '0x24d';
        return null;
      }
      return null;
    },
  };

  await ensureLadyChainNetwork(provider);
  assert.deepEqual(calls.map((call) => call.method), [
    'eth_chainId',
    'wallet_switchEthereumChain',
    'wallet_addEthereumChain',
    'wallet_switchEthereumChain',
    'eth_chainId',
  ]);
  assert.deepEqual(calls[2].params[0], {
    chainId: '0x24d',
    chainName: 'LadyChain',
    nativeCurrency: { name: 'LADY', symbol: 'LADY', decimals: 18 },
    rpcUrls: ['https://ladyrpc.us'],
    blockExplorerUrls: ['https://ladyscan.us'],
  });
});

test('rejects the network if the wallet remains on the wrong chain', async () => {
  const provider = {
    request: async ({ method }) => method === 'eth_chainId' ? '0x1' : null,
  };
  await assert.rejects(ensureLadyChainNetwork(provider), /Switch your wallet to LadyChain/);
});
