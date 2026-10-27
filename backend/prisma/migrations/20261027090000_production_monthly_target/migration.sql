-- Additive only: a new table for monthly production targets and KPI
-- thresholds. No existing table or row is changed.

-- CreateTable
CREATE TABLE "ProductionMonthlyTarget" (
    "id" SERIAL NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "outputTarget" DECIMAL(14,3) NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'pcs',
    "targetCompletionRate" DECIMAL(5,2),
    "maxRejectionRate" DECIMAL(5,2),
    "targetEmployeeEfficiency" DECIMAL(5,2),
    "notes" TEXT,
    "updatedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionMonthlyTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductionMonthlyTarget_periodStart_key" ON "ProductionMonthlyTarget"("periodStart");
