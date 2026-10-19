import {
  ensureLadyChainNetwork,
  normalizeEvmAddress,
  normalizeEvmChainId,
  type Eip1193Provider,
  LADYCHAIN_CHAIN_ID,
} from './ladychain-wallet.ts';

type Challenge = {
  message: string;
  nonce: string;
};

type Session = {
  walletAddress: string;
};

type CreateChallenge = (input: { data: { address: string } }) => Promise<Challenge>;
type CreateSession = (input: {
  data: { address: string; nonce: string; signature: string };
}) => Promise<Session>;

/**
 * Completes the wallet-owned part of login after an injected or WalletConnect
 * provider becomes available in the Frogtown tab.
 */
export async function authenticateLadyChainProvider(
  provider: Eip1193Provider,
  requestedAddress: string,
  createChallenge: CreateChallenge,
  createSession: CreateSession,
) {
  const address = normalizeEvmAddress(requestedAddress);
  if (!address) throw new Error('This wallet did not return a valid EVM address.');

  await ensureLadyChainNetwork(provider);
  const accountsBefore = await provider.request({ method: 'eth_accounts' });
  if (!Array.isArray(accountsBefore) || !accountsBefore.some((account) => normalizeEvmAddress(account) === address)) {
    throw new Error('Your selected wallet account changed. Connect it again to continue.');
  }

  const challenge = await createChallenge({ data: { address } });
  const signature = await provider.request({
    method: 'personal_sign',
    params: [challenge.message, address],
  });
  if (typeof signature !== 'string' || !/^0x[a-fA-F0-9]{130}$/.test(signature)) {
    throw new Error('The wallet did not return a valid sign-in signature.');
  }

  const accountsBeforeSession = await provider.request({ method: 'eth_accounts' });
  const chainBeforeSession = await provider.request({ method: 'eth_chainId' });
  if (
    !Array.isArray(accountsBeforeSession) ||
    !accountsBeforeSession.some((account) => normalizeEvmAddress(account) === address) ||
    normalizeEvmChainId(chainBeforeSession) !== LADYCHAIN_CHAIN_ID
  ) {
    throw new Error('Your wallet account or network changed during sign-in. Please try again.');
  }

  const session = await createSession({
    data: { address, nonce: challenge.nonce, signature },
  });

  const accountsAfterSession = await provider.request({ method: 'eth_accounts' });
  const chainAfterSession = await provider.request({ method: 'eth_chainId' });
  if (
    !Array.isArray(accountsAfterSession) ||
    !accountsAfterSession.some((account) => normalizeEvmAddress(account) === address) ||
    normalizeEvmChainId(chainAfterSession) !== LADYCHAIN_CHAIN_ID ||
    normalizeEvmAddress(session.walletAddress) !== address
  ) {
    throw new Error('Your wallet changed during sign-in. Frogtown will reconnect to the current account.');
  }
  return session.walletAddress;
}
