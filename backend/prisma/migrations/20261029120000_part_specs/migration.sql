-- Part master (raw-material grade, strip size and sheet yield per part), and
-- a third decimal on Material.costPerUnit so per-kg rates from supplier
-- invoices (e.g. 62.862) are kept exactly. The validator already accepts
-- three decimals; the column used to round them to two.

-- AlterTable
ALTER TABLE "Material" ALTER COLUMN "costPerUnit" SET DATA TYPE DECIMAL(12,3);

-- CreateTable
CREATE TABLE "PartSpec" (
    "id" SERIAL NOT NULL,
    "partNumber" TEXT NOT NULL,
    "rmGrade" TEXT NOT NULL,
    "thicknessMm" DECIMAL(6,2) NOT NULL,
    "stripSize" TEXT NOT NULL,
    "piecesPerStrip" INTEGER,
    "piecesPerSheet" INTEGER,
    "sheetSize" TEXT NOT NULL,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartSpec_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PartSpec_partNumber_key" ON "PartSpec"("partNumber");

-- CreateIndex
CREATE INDEX "PartSpec_rmGrade_idx" ON "PartSpec"("rmGrade");
