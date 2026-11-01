-- Client order timeline dates and supplier confirm/dispatch details on POs.
-- AlterTable
ALTER TABLE "ClientOrder" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "productionStartedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "dispatchDate" TIMESTAMP(3),
ADD COLUMN     "dispatchedAt" TIMESTAMP(3),
ADD COLUMN     "supplierNote" TEXT;

