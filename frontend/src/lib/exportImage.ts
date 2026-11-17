/**
 * Saves a piece of the screen as a PNG image, made on this device (nothing is sent anywhere): shares it where the
 * phone can (WhatsApp, Fotos…) or downloads it.
 */
export async function exportNodeImage(node: HTMLElement, fileName: string, title: string): Promise<"shared" | "downloaded"> {
  const { toBlob } = await import("html-to-image");
  const bg = getComputedStyle(document.body).backgroundColor || "#ffffff";
  const blob = await toBlob(node, { pixelRatio: 2, backgroundColor: bg, cacheBust: true, filter: (el) => !(el instanceof HTMLElement && el.dataset.exportSkip === "true") });
  if (!blob) throw new Error("Não deu para gerar a imagem.");
  const file = new File([blob], `${fileName}.png`, { type: "image/png" });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try { await nav.share({ files: [file], title }); return "shared"; } catch { /* cancelled: fall back to download */ }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return "downloaded";
}
