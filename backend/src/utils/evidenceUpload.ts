import multer from 'multer';
import { EVIDENCE_FIELDS, EVIDENCE_MAX_BYTES } from '../services/incidentEvidence.service';

/**
 * Multipart parser for incident pictures: memory only (nothing on Render's
 * disk), known field names, at most 6 files of 250 KB. The service checks
 * each file really is a JPEG.
 */
export const evidenceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: EVIDENCE_MAX_BYTES, files: 6, fields: 2, fieldSize: 16_384 },
  fileFilter: (_req, file, cb) => cb(null, file.fieldname in EVIDENCE_FIELDS),
}).any();
