import "server-only";

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import sharp from "sharp";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const execFileAsync = promisify(execFile);

export type PreparedUpload = {
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
  size: number;
};

function webpName(name: string) {
  return `${name.replace(/\.[^.]+$/, "") || "image"}.webp`;
}

export async function prepareUpload(file: File): Promise<PreparedUpload> {
  const original = Buffer.from(await file.arrayBuffer());
  const fallback = { bytes: new Uint8Array(original), fileName: file.name, mimeType: file.type, size: original.length };
  if (!IMAGE_TYPES.has(file.type)) return fallback;

  try {
    const optimized = await sharp(original, { limitInputPixels: 50_000_000 })
      .rotate()
      .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80, effort: 4, smartSubsample: true })
      .toBuffer();
    if (optimized.length >= original.length) return fallback;
    return { bytes: new Uint8Array(optimized), fileName: webpName(file.name), mimeType: "image/webp", size: optimized.length };
  } catch {
    return fallback;
  }
}

export async function prepareVideoUpload(file: File): Promise<PreparedUpload> {
  const original = Buffer.from(await file.arrayBuffer());
  const fallback = { bytes: new Uint8Array(original), fileName: file.name, mimeType: file.type, size: original.length };
  if (file.type !== "video/mp4" || !ffmpegPath) return fallback;

  const directory = await mkdtemp(join(tmpdir(), "bunya-video-"));
  const inputPath = join(directory, "input.mp4");
  const outputPath = join(directory, "output.mp4");
  try {
    await writeFile(inputPath, original);
    await execFileAsync(ffmpegPath, [
      "-y",
      "-i", inputPath,
      "-map_metadata", "-1",
      "-vf", "scale=min(1280\\,iw):-2",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "30",
      "-c:a", "aac",
      "-b:a", "96k",
      "-movflags", "+faststart",
      outputPath,
    ], { timeout: 60_000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
    const optimized = await readFile(outputPath);
    if (optimized.length >= original.length) return fallback;
    return { bytes: new Uint8Array(optimized), fileName: file.name, mimeType: "video/mp4", size: optimized.length };
  } catch {
    return fallback;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
