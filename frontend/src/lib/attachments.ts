import { apiDelete, apiGet, apiPut } from "@/lib/api";
import { isLocalMode } from "@/lib/mode";

export const ATTACHMENT_MARKER = "finnos:attachment";
const localKey = (id: string) => `finnos:attachment:${id}`;

/** Shrinks a photo to at most 1280 px and ~600 KB as JPEG, so it fits next to the lançamento. */
export async function compressImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Escolha uma foto ou imagem.");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error("Não foi possível ler a imagem.")); i.src = url; });
    let size = 1280;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const scale = Math.min(1, size / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.naturalWidth * scale); canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL("image/jpeg", 0.72 - attempt * 0.08);
      if (data.length < 820_000) return data;
      size = Math.round(size * 0.8);
    }
    throw new Error("A imagem é grande demais.");
  } finally { URL.revokeObjectURL(url); }
}

export async function saveAttachment(txId: string, dataUrl: string, name = "comprovante.jpg"): Promise<void> {
  if (isLocalMode()) {
    try { localStorage.setItem(localKey(txId), dataUrl); } catch { throw new Error("Sem espaço no aparelho para a foto."); }
    return;
  }
  await apiPut(`/transactions/${encodeURIComponent(txId)}/attachment`, { data_url: dataUrl, name });
}

export async function fetchAttachment(txId: string): Promise<string | null> {
  if (isLocalMode()) return localStorage.getItem(localKey(txId));
  try { return (await apiGet<{ data_url: string }>(`/transactions/${encodeURIComponent(txId)}/attachment`)).data_url; } catch { return null; }
}

export async function removeAttachment(txId: string): Promise<void> {
  if (isLocalMode()) { localStorage.removeItem(localKey(txId)); return; }
  await apiDelete(`/transactions/${encodeURIComponent(txId)}/attachment`);
}

/** Compresses and stores a receipt photo for a saved lançamento; returns it with the photo marked. */
export async function attachPhoto(tx: { id: string }, file: File): Promise<void> {
  const data = await compressImage(file);
  await saveAttachment(tx.id, data, file.name.slice(0, 120) || "comprovante.jpg");
}
