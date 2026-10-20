import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import multer, { type FileFilterCallback } from 'multer';
import type { NextFunction, Request, Response } from 'express';
import { BadRequestError } from '../errors';
import { StoredFileRepository } from '../repositories/storedFile.repository';

// ── Constants ─────────────────────────────────────────────────────────────────

const UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads');
const PROFILES_DIR = path.join(UPLOAD_ROOT, 'profiles');
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);

const SAFE_FILENAME = /^[\w.-]+$/;

const storedFiles = new StoredFileRepository();

// Files uploaded before images moved to the database are still served from
// this folder.
if (!fs.existsSync(PROFILES_DIR)) {
  fs.mkdirSync(PROFILES_DIR, { recursive: true });
}

/**
 * The image type from the file's first bytes. The browser-supplied MIME type
 * and extension are only claims; this is what the file really is.
 */
export function detectImageType(data: Buffer): { mime: string; ext: string } | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return { mime: 'image/jpeg', ext: '.jpg' };
  }
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: 'image/png', ext: '.png' };
  }
  if (
    data.subarray(0, 4).toString('latin1') === 'RIFF' &&
    data.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return { mime: 'image/webp', ext: '.webp' };
  }
  return null;
}

// ── File filter ────────────────────────────────────────────────────────────────

function profileFileFilter(_req: Request, file: Express.Multer.File, cb: FileFilterCallback): void {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_MIME.has(file.mimetype) || !ALLOWED_EXT.has(ext)) {
    cb(new BadRequestError('Only JPEG, PNG and WebP images are allowed'));
    return;
  }
  cb(null, true);
}

// ── Multer instances ───────────────────────────────────────────────────────────

/** Single-file profile image upload — field name: "image" */
export const uploadProfileImage = multer({
  // Kept in memory (max 5 MB) and then written to the database: the server's
  // disk is temporary on hosts such as Render.
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE_BYTES },
  fileFilter: profileFileFilter,
}).single('image');

/**
 * Derive the public URL path from a stored filename.
 *   filename  → /uploads/profiles/<filename>
 */
export function profileImageUrl(filename: string): string {
  return `/uploads/profiles/${filename}`;
}

/** Stores an uploaded profile image and returns its public URL path. */
export async function saveProfileImage(file: Express.Multer.File): Promise<string> {
  const type = detectImageType(file.buffer);
  if (type === null) {
    throw new BadRequestError('The file is not a valid JPEG, PNG or WebP image');
  }
  const filename = `${Date.now()}-${crypto.randomBytes(12).toString('hex')}${type.ext}`;
  await storedFiles.create(filename, type.mime, file.buffer);
  return profileImageUrl(filename);
}

/**
 * GET /uploads/profiles/:name — serves images stored in the database. Names
 * not found there fall through to the static folder (older uploads).
 */
export async function serveStoredProfileImage(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const name = String(req.params['name'] ?? '');
  if (!SAFE_FILENAME.test(name)) {
    next();
    return;
  }
  try {
    const file = await storedFiles.find(name);
    if (file === null) {
      next();
      return;
    }
    res.set({
      'Content-Type': file.mimeType,
      'Content-Length': String(file.size),
      // Every upload gets a new random name, so the content never changes.
      'Cache-Control': 'public, max-age=604800, immutable',
    });
    res.end(Buffer.from(file.data));
  } catch (err) {
    next(err);
  }
}

/** Removes a profile image, wherever it is stored. Never throws. */
export async function deleteProfileImage(storedPath: string): Promise<void> {
  const filename = path.basename(storedPath);
  if (SAFE_FILENAME.test(filename)) {
    await storedFiles.delete(filename).catch(() => undefined);
  }
  deleteUploadedFile(storedPath);
}

/**
 * Delete a previously uploaded profile image by its stored URL path.
 *
 * Only files directly inside the profiles upload folder can be removed. The
 * stored value is user-editable, so a path such as "/uploads/../.env" or an
 * absolute path must never reach unlink(). Silently ignores missing files.
 */
export function deleteUploadedFile(storedPath: string): void {
  try {
    const filename = path.basename(storedPath);
    const fsPath = path.resolve(PROFILES_DIR, filename);
    if (path.dirname(fsPath) !== PROFILES_DIR) return;
    if (!SAFE_FILENAME.test(filename) || !ALLOWED_EXT.has(path.extname(filename).toLowerCase())) {
      return;
    }
    if (fs.existsSync(fsPath)) fs.unlinkSync(fsPath);
  } catch {
    // swallow — non-critical
  }
}
