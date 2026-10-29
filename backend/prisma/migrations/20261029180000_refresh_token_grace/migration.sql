-- Rotated refresh tokens are kept for a short grace period (see
-- REFRESH_ROTATION_GRACE_MS) instead of being deleted at once.
ALTER TABLE "RefreshToken" ADD COLUMN "replacedAt" TIMESTAMP(3);
