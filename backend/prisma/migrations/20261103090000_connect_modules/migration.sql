-- Connect the modules: PO -> stock material, client order -> part,
-- work order -> part/material with optional raw-material deduction.
-- AlterTable
ALTER TABLE "ClientOrder" ADD COLUMN     "partSpecId" INTEGER;

-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "materialId" INTEGER,
ADD COLUMN     "quantityValue" DECIMAL(12,3),
ADD COLUMN     "receivedQty" DECIMAL(12,3) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "WorkOrder" ADD COLUMN     "deductMaterial" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "materialId" INTEGER,
ADD COLUMN     "partSpecId" INTEGER;

-- AlterTable
ALTER TABLE "WorkOrderOutput" ADD COLUMN     "materialIssued" DECIMAL(12,3) NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "PurchaseOrder_materialId_idx" ON "PurchaseOrder"("materialId");

-- AddForeignKey
ALTER TABLE "ClientOrder" ADD CONSTRAINT "ClientOrder_partSpecId_fkey" FOREIGN KEY ("partSpecId") REFERENCES "PartSpec"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_partSpecId_fkey" FOREIGN KEY ("partSpecId") REFERENCES "PartSpec"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: link existing POs to the stock material with the same name
UPDATE "PurchaseOrder" po
SET "materialId" = (
  SELECT MIN(m."id") FROM "Material" m
  WHERE m."deletedAt" IS NULL AND LOWER(TRIM(m."name")) = LOWER(TRIM(po."material"))
)
WHERE po."materialId" IS NULL;

-- Backfill: numeric quantities ("500" or "500.5"); free text stays as is
UPDATE "PurchaseOrder"
SET "quantityValue" = CAST(TRIM("quantity") AS DECIMAL(12, 3))
WHERE "quantityValue" IS NULL AND TRIM("quantity") ~ '^[0-9]+(\.[0-9]+)?$';

-- Delivered POs count as fully received (stock was entered by hand before)
UPDATE "PurchaseOrder"
SET "receivedQty" = COALESCE("quantityValue", 0)
WHERE "status" = 'DELIVERED';
