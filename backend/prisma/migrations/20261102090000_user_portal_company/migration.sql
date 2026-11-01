-- Link supplier and client portal logins to their company by id.
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "clientId" INTEGER,
ADD COLUMN     "supplierId" INTEGER;

-- CreateIndex
CREATE INDEX "User_supplierId_idx" ON "User"("supplierId");

-- CreateIndex
CREATE INDEX "User_clientId_idx" ON "User"("clientId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: existing portal logins were matched to their company by email.
-- If several companies share an email, the oldest (lowest id) wins.
UPDATE "User" u
SET "supplierId" = (
  SELECT MIN(s."id") FROM "Supplier" s
  WHERE s."deletedAt" IS NULL AND s."email" IS NOT NULL AND LOWER(s."email") = LOWER(u."email")
)
FROM "Role" r
WHERE r."id" = u."roleId" AND r."name" = 'SUPPLIER' AND u."supplierId" IS NULL;

UPDATE "User" u
SET "clientId" = (
  SELECT MIN(c."id") FROM "Client" c
  WHERE c."deletedAt" IS NULL AND c."email" IS NOT NULL AND LOWER(c."email") = LOWER(u."email")
)
FROM "Role" r
WHERE r."id" = u."roleId" AND r."name" = 'CLIENT' AND u."clientId" IS NULL;
