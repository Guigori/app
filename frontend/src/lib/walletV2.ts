/** FINNOS_WALLET_V2: turns on the new Carteira (etapa 6). On by default in this package;
 * a build with VITE_FINNOS_WALLET_V2=0 keeps the previous screen, and one device can
 * switch it with localStorage "finnos:wallet-v2" = "0" | "1" (support / rollback check). */
export function walletV2Enabled(): boolean {
  try {
    const local = window.localStorage.getItem("finnos:wallet-v2");
    if (local === "0" || local === "1") return local === "1";
  } catch { /* storage blocked: fall back to the build setting */ }
  return (import.meta.env.VITE_FINNOS_WALLET_V2 as string | undefined) !== "0";
}
