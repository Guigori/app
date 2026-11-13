/** Card gradient from the bank colour, like the prototype (no chip, no card network). */
export function cardGradient(color: string): string {
  const base = /^#[0-9a-f]{6}$/i.test(color) ? color : "#4B2CFF";
  return `linear-gradient(135deg, ${base}E6 0%, ${base} 45%, color-mix(in srgb, ${base} 45%, #070F52) 100%)`;
}
