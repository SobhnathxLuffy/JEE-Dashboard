// ─── Image helpers — file → downscaled JPEG dataURL ─────────────────────────
// Used for question figures (max 800px) and Results solution photos (max
// 1000px). Output is a dataURL that lives inside IndexedDB records, so there
// is nothing to revoke afterwards; only the temporary object URL used to
// decode the file is released.

/**
 * Read an image File and return a JPEG dataURL whose longest edge is ≤ maxDim
 * (upscale never happens — smaller images pass through at their own size).
 * Quality 0.75 keeps a full-paper solution photo well under a few hundred KB.
 */
export async function fileToDataUrl(file: File, maxDim: number): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Not an image file");
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Could not decode image"));
      el.src = objectUrl;
    });
    const longest = Math.max(img.naturalWidth, img.naturalHeight) || 1;
    const scale = Math.min(1, maxDim / longest);
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.75);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
