function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const u = URL.createObjectURL(file); const i = new Image();
    i.onload = () => { res(i); URL.revokeObjectURL(u); };
    i.onerror = () => { rej(new Error("decode")); URL.revokeObjectURL(u); };
    i.src = u;
  });
}
/** Resize to fit `max` px and re-encode as JPEG (also strips location metadata). */
export async function downscale(file: Blob, max: number, quality: number): Promise<Blob> {
  const img = await loadImage(file);
  const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("blob"))), "image/jpeg", quality));
}
export function blobToDataURL(b: Blob): Promise<string> {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(b); });
}
export async function dataURLToBlob(u: string): Promise<Blob> { return await (await fetch(u)).blob(); }
