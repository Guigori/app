/** Draws the receipt of a lançamento as a PNG, in FINNOS colours, to share or save. */
export async function receiptImage({ title, amount, tone, rows }: { title: string; amount: string; tone: string; rows: [string, string][] }): Promise<Blob> {
  const W = 1080; const pad = 72; const rowH = 92; const H = 520 + rows.length * rowH + 140;
  const canvas = document.createElement("canvas"); canvas.width = W; canvas.height = H;
  const g = canvas.getContext("2d")!;
  const font = (w: number, s: number) => `${w} ${s}px "DM Sans", system-ui, sans-serif`;
  g.fillStyle = "#05050a"; g.fillRect(0, 0, W, H);
  // Card
  const r = 56; const x = 36, y = 36, w = W - 72, h = H - 72;
  g.fillStyle = "#0b0b16"; g.strokeStyle = "#23244a"; g.lineWidth = 3;
  g.beginPath(); g.roundRect(x, y, w, h, r); g.fill(); g.stroke();
  g.fillStyle = "#a78bfa"; g.font = font(700, 34); g.fillText("FINNOS · COMPROVANTE", pad + 24, 140);
  g.fillStyle = "#ffffff"; g.font = font(700, 56); g.fillText(title.slice(0, 28), pad + 24, 240);
  g.fillStyle = tone; g.font = font(700, 120); g.fillText(amount, pad + 24, 380);
  let top = 470;
  g.setLineDash([10, 10]);
  rows.forEach(([label, value]) => {
    g.strokeStyle = "#23244a"; g.lineWidth = 2; g.beginPath(); g.moveTo(pad + 24, top); g.lineTo(W - pad - 24, top); g.stroke();
    g.fillStyle = "#9a9ab8"; g.font = font(500, 38); g.fillText(label, pad + 24, top + 60);
    g.fillStyle = "#ffffff"; g.font = font(700, 38); const vw = g.measureText(value).width; g.fillText(value, W - pad - 24 - vw, top + 60);
    top += rowH;
  });
  g.setLineDash([]);
  g.fillStyle = "#5d5d75"; g.font = font(500, 28); g.fillText(`Gerado em ${new Date().toLocaleString("pt-BR")}`, pad + 24, H - 90);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Falha ao gerar imagem."))), "image/png"));
}

/** Opens the phone's share sheet with the image; without it, downloads the file. */
export async function shareImage(blob: Blob, filename: string, text: string): Promise<"shared" | "downloaded"> {
  const file = new File([blob], filename, { type: "image/png" });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) { await nav.share({ files: [file], text }); return "shared"; }
  const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  return "downloaded";
}
