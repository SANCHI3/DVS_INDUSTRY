import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import multer, { type FileFilterCallback } from 'multer';
import type { Request } from 'express';
import { BadRequestError } from '../errors';

// ── Constants ─────────────────────────────────────────────────────────────────

const UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads');
const PROFILES_DIR = path.join(UPLOAD_ROOT, 'profiles');
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);

// Ensure the directory exists at startup
if (!fs.existsSync(PROFILES_DIR)) {
  fs.mkdirSync(PROFILES_DIR, { recursive: true });
}

// ── Storage engine ─────────────────────────────────────────────────────────────

const profileStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, PROFILES_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeName = `${Date.now()}-${crypto.randomBytes(12).toString('hex')}${ext}`;
    cb(null, safeName);
  },
});

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
  storage: profileStorage,
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
    if (!/^[\w.-]+$/.test(filename) || !ALLOWED_EXT.has(path.extname(filename).toLowerCase())) {
      return;
    }
    if (fs.existsSync(fsPath)) fs.unlinkSync(fsPath);
  } catch {
    // swallow — non-critical
  }
}
