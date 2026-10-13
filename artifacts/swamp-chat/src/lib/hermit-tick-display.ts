export type HermitTickDisplayCheck = {
  tick: 'green' | 'gold' | null;
  checkStatus: 'checked' | 'unavailable';
};

export function visibleHermitTick(
  check: HermitTickDisplayCheck | undefined,
  hasError = false,
): 'green' | 'gold' | null {
  if (hasError || check?.checkStatus !== 'checked') return null;
  return check.tick;
}
