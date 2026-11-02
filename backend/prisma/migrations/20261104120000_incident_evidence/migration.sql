-- CreateEnum
CREATE TYPE "EvidenceKind" AS ENUM ('KEYFRAME', 'GRADCAM');

-- AlterTable
ALTER TABLE "SecurityIncident" ADD COLUMN     "evidenceMeta" JSONB;

-- CreateTable
CREATE TABLE "IncidentEvidence" (
    "id" SERIAL NOT NULL,
    "incidentId" INTEGER NOT NULL,
    "kind" "EvidenceKind" NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storage" TEXT NOT NULL,
    "storageKey" TEXT,
    "data" BYTEA,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IncidentEvidence_createdAt_idx" ON "IncidentEvidence"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IncidentEvidence_incidentId_kind_position_key" ON "IncidentEvidence"("incidentId", "kind", "position");

-- AddForeignKey
ALTER TABLE "IncidentEvidence" ADD CONSTRAINT "IncidentEvidence_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "SecurityIncident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

