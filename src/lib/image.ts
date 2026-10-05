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

/** Length of a video and a still frame from it (JPEG, at most `max` px), for the AI check and thumbnails. */
export function videoStill(file: Blob, max = 1280): Promise<{ duration: number; frame: Blob }> {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = url;
    const fail = () => { URL.revokeObjectURL(url); rej(new Error("video")); };
    const timer = setTimeout(fail, 15000);
    v.onerror = () => { clearTimeout(timer); fail(); };
    v.onloadedmetadata = () => { v.currentTime = Math.min(1, (v.duration || 0) / 2); };
    v.onseeked = () => {
      clearTimeout(timer);
      const s = Math.min(1, max / Math.max(v.videoWidth || 1, v.videoHeight || 1));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round((v.videoWidth || 640) * s)); c.height = Math.max(1, Math.round((v.videoHeight || 480) * s));
      c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
      c.toBlob((b) => { URL.revokeObjectURL(url); if (b) res({ duration: v.duration || 0, frame: b }); else rej(new Error("frame")); }, "image/jpeg", 0.82);
    };
  });
}
