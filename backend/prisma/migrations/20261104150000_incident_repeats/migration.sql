-- AlterTable
ALTER TABLE "SecurityIncident" ADD COLUMN     "lastSeenAt" TIMESTAMP(3),
ADD COLUMN     "repeatCount" INTEGER NOT NULL DEFAULT 0;

