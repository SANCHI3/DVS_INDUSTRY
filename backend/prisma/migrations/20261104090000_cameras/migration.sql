-- CreateEnum
CREATE TYPE "IncidentSource" AS ENUM ('LIVE', 'DEV');

-- CreateEnum
CREATE TYPE "CameraStatus" AS ENUM ('CONNECTING', 'ONLINE', 'OFFLINE', 'VIDEO_LOSS');

-- AlterTable
ALTER TABLE "SecurityIncident" ADD COLUMN     "cameraId" TEXT,
ADD COLUMN     "instanceId" TEXT,
ADD COLUMN     "source" "IncidentSource" NOT NULL DEFAULT 'LIVE';

-- CreateTable
CREATE TABLE "Camera" (
    "id" TEXT NOT NULL,
    "channel" INTEGER,
    "name" TEXT NOT NULL,
    "zone" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "status" "CameraStatus" NOT NULL DEFAULT 'CONNECTING',
    "statusDetail" TEXT,
    "statusSince" TIMESTAMP(3),
    "lastHeartbeatAt" TIMESTAMP(3),
    "lastFrameAt" TIMESTAMP(3),
    "achievedFps" DOUBLE PRECISION,
    "inferMs" DOUBLE PRECISION,
    "lastSnapshot" BYTEA,
    "snapshotAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Camera_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerceptionInstance" (
    "id" TEXT NOT NULL,
    "source" "IncidentSource" NOT NULL DEFAULT 'LIVE',
    "lastHeartbeatAt" TIMESTAMP(3) NOT NULL,
    "cameraIds" TEXT[],
    "info" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PerceptionInstance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SecurityIncident_cameraId_idx" ON "SecurityIncident"("cameraId");

-- CreateIndex
CREATE INDEX "SecurityIncident_source_idx" ON "SecurityIncident"("source");

-- AddForeignKey
ALTER TABLE "SecurityIncident" ADD CONSTRAINT "SecurityIncident_cameraId_fkey" FOREIGN KEY ("cameraId") REFERENCES "Camera"("id") ON DELETE SET NULL ON UPDATE CASCADE;

