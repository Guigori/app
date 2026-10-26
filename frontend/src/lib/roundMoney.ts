/** BRL cent rounding for the browser-only engine.
 *
 * Matches Python Decimal(ROUND_HALF_UP) for valid FINNOS currency inputs,
 * including negative amounts (Math.round(-12.5) would round toward +infinity).
 *
 * JavaScript floating point is still an approximation: all stored/payment
 * amounts must have at most two decimals, and backend cent integers remain
 * authoritative. Cross-language fixture tests protect known edge cases.
 */
export function moneyCents(value: number): number {
  if (!Number.isFinite(value) || Math.abs(value) > 9_000_000_000_000) {
    throw new Error("Valor monetário inválido.");
  }
  const absCents = Math.round((Math.abs(value) + Number.EPSILON) * 100);
  if (!Number.isSafeInteger(absCents)) throw new Error("Valor monetário fora do limite.");
  return value < 0 ? -absCents : absCents;
}

export function roundBRL(value: number): number {
  return moneyCents(value) / 100;
}
