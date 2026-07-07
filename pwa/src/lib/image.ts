export async function resizeImage(file: Blob, maxDim: number, quality: number, rotation = 0): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const sw = Math.max(1, Math.round(bitmap.width * scale));
  const sh = Math.max(1, Math.round(bitmap.height * scale));

  const rot = (((rotation % 360) + 360) % 360);
  const swap = rot === 90 || rot === 270;
  const w = swap ? sh : sw;
  const h = swap ? sw : sh;

  const canvas = typeof OffscreenCanvas !== "undefined"
    ? new OffscreenCanvas(w, h)
    : Object.assign(document.createElement("canvas"), { width: w, height: h });
  const ctx = (canvas as OffscreenCanvas | HTMLCanvasElement).getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.translate(w / 2, h / 2);
  if (rot) ctx.rotate((rot * Math.PI) / 180);
  ctx.drawImage(bitmap, -sw / 2, -sh / 2, sw, sh);

  if (canvas instanceof OffscreenCanvas) {
    return await canvas.convertToBlob({ type: "image/jpeg", quality });
  }
  return await new Promise<Blob>((resolve, reject) =>
    (canvas as HTMLCanvasElement).toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/jpeg", quality)
  );
}
