// Keep autocomplete requests within the server's username/address contract.
// Searching existing chats may still use arbitrary text without making an API call.
export function memberSearchTerm(input: string): string | null {
  const term = input.trim().replace(/^@/, '');
  return /^(?:[a-zA-Z0-9_]{4,17}|r[1-9A-HJ-NP-Za-km-z]{24,34}|0x[a-fA-F0-9]{40})$/.test(term)
    ? term
    : null;
}
