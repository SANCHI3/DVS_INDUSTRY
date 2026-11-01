-- Messages between DVS and a supplier or client portal account.
CREATE TABLE "PortalMessage" (
    "id" SERIAL NOT NULL,
    "supplierId" INTEGER,
    "clientId" INTEGER,
    "fromDvs" BOOLEAN NOT NULL,
    "senderId" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortalMessage_pkey" PRIMARY KEY ("id"),
    -- Each message belongs to exactly one conversation
    CONSTRAINT "PortalMessage_one_party" CHECK (("supplierId" IS NULL) <> ("clientId" IS NULL))
);

CREATE INDEX "PortalMessage_supplierId_createdAt_idx" ON "PortalMessage"("supplierId", "createdAt");
CREATE INDEX "PortalMessage_clientId_createdAt_idx" ON "PortalMessage"("clientId", "createdAt");

ALTER TABLE "PortalMessage" ADD CONSTRAINT "PortalMessage_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PortalMessage" ADD CONSTRAINT "PortalMessage_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PortalMessage" ADD CONSTRAINT "PortalMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
