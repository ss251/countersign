/**
 * Shrink a camera picture on the device: at most 800 px on its long side, re-encoded as JPEG.
 * Re-encoding through a canvas drops every metadata block, so the camera's EXIF, including any
 * GPS position it wrote, never leaves the phone. Browsers apply the EXIF orientation when they
 * decode into an <img>, so the picture keeps the way it was held.
 */

import { PHOTO_MAX_BYTES, PHOTO_MAX_SIDE } from "../runner/skills.ts";

export interface ShrunkPhoto {
  bytes: Uint8Array;
  width: number;
  height: number;
  /** A small preview for this phone's own job list. Never sent. */
  thumb: string;
}

const QUALITIES = [0.82, 0.72, 0.62, 0.5, 0.4];

export async function shrinkPhoto(file: Blob): Promise<ShrunkPhoto> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    try {
      await image.decode();
    } catch {
      throw new Error("This picture could not be read.");
    }
    const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = draw(image, width, height);

    let bytes: Uint8Array | null = null;
    for (const quality of QUALITIES) {
      const blob = await toJpeg(canvas, quality);
      if (blob.size <= PHOTO_MAX_BYTES) {
        bytes = new Uint8Array(await blob.arrayBuffer());
        break;
      }
    }
    if (bytes === null) throw new Error("The picture stays too large even at low quality.");

    const thumbScale = Math.min(1, 160 / Math.max(width, height));
    const thumb = draw(image, Math.round(width * thumbScale), Math.round(height * thumbScale)).toDataURL("image/jpeg", 0.7);
    return { bytes, width, height, thumb };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function draw(image: HTMLImageElement, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot draw the picture.");
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The picture could not be encoded."))), "image/jpeg", quality);
  });
}
