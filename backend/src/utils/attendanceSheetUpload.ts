import path from 'path';
import multer, { type FileFilterCallback } from 'multer';
import type { Request } from 'express';
import { BadRequestError } from '../errors';

export const MAX_SHEET_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_EXT = new Set(['.xlsx', '.xls']);

function sheetFileFilter(_req: Request, file: Express.Multer.File, cb: FileFilterCallback): void {
  // The extension is only a claim; the parser checks the file's first bytes
  if (!ALLOWED_EXT.has(path.extname(file.originalname).toLowerCase())) {
    cb(new BadRequestError('Only Excel workbooks (.xlsx or .xls) can be uploaded'));
    return;
  }
  cb(null, true);
}

/** Single Excel attendance sheet, kept in memory — field name: "file" */
export const uploadAttendanceSheet = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SHEET_BYTES, files: 1 },
  fileFilter: sheetFileFilter,
}).single('file');
