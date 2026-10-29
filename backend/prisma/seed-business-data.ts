/**
 * Real business records taken from paper documents:
 *
 *  - Purchase: Mahindra Accelo Limited GST invoice IN05272700034368
 *    (13-10-2026) against DVS PO 96 — two SPCC sheet lines, received into
 *    stock the same day.
 *  - Sale: DVS tax invoice 26-27/2113 (26-10-2026) to Chitnis Engineering
 *    Systems Pvt Ltd. against buyer's order 2021000329.
 *  - Part master: RM grade, strip size and sheet yield per part.
 *
 * Idempotent: records are upserted on their unique keys and each stock
 * receipt is booked once (matched on material + invoice number).
 */

import type { PrismaClient } from '@prisma/client';

const PURCHASE_INVOICE = 'IN05272700034368';
const PURCHASE_DATE = new Date('2026-10-13');

const partSpecs = [
  { partNumber: '600N/610N', rmGrade: 'CR D', thicknessMm: '1', stripSize: '1X108X1250', piecesPerStrip: 24, piecesPerSheet: 552, sheetSize: '1250x2500' },
  { partNumber: '010N', rmGrade: 'CR D', thicknessMm: '1.2', stripSize: '1.2X218.5X1250', piecesPerStrip: 33, piecesPerSheet: 363, sheetSize: '1250x2500' },
  { partNumber: '1160', rmGrade: 'E 34', thicknessMm: '2', stripSize: '2X251X1250', piecesPerStrip: 15, piecesPerSheet: 135, sheetSize: '1250x2500' },
  { partNumber: '1491/92', rmGrade: 'CR D', thicknessMm: '1.5', stripSize: '1.5X430X1250', piecesPerStrip: 39, piecesPerSheet: 195, sheetSize: '1250x2500' },
  { partNumber: '440N', rmGrade: 'CR D', thicknessMm: '1', stripSize: '1X120X1250', piecesPerStrip: 16, piecesPerSheet: 320, sheetSize: '1250x2500' },
  { partNumber: '1510/1520', rmGrade: 'CR D', thicknessMm: '1', stripSize: '1X155X1250', piecesPerStrip: 37, piecesPerSheet: 592, sheetSize: '1250x2500' },
  {
    partNumber: '427/435', rmGrade: 'HRPO', thicknessMm: '1.6', stripSize: '1X191X1250', piecesPerStrip: 20, piecesPerSheet: 260, sheetSize: '1250x2500',
    notes: 'Strip size is as written on the part sheet (1X191X1250) although the thickness is 1.6 mm.',
  },
  { partNumber: '1740/1750', rmGrade: 'CR D', thicknessMm: '0.8', stripSize: '0.8X116-117X510', piecesPerStrip: 13, piecesPerSheet: 130, sheetSize: '510x1250' },
  {
    partNumber: '080N', rmGrade: 'CR D', thicknessMm: '0.9', stripSize: '0.9X230X1250', piecesPerStrip: null, piecesPerSheet: null, sheetSize: '1250x2000',
    notes: 'Per-strip and per-sheet quantities not yet recorded.',
  },
  { partNumber: '20029-GX BKT', rmGrade: 'HR E34', thicknessMm: '4', stripSize: '4X40.5X-40.8X1250', piecesPerStrip: 10, piecesPerSheet: 610, sheetSize: '1250x2500' },
];

async function seedPartSpecs(prisma: PrismaClient): Promise<void> {
  console.log('\n🌱  Seeding part master…');
  for (const part of partSpecs) {
    const data = { notes: null, ...part, isActive: true };
    await prisma.partSpec.upsert({ where: { partNumber: part.partNumber }, update: data, create: data });
  }
  console.log(`   ✓ Parts: ${partSpecs.length}`);
}

async function seedMahindraPurchase(prisma: PrismaClient): Promise<void> {
  console.log('\n🌱  Seeding Mahindra Accelo purchase (invoice IN05272700034368)…');

  const supplierData = {
    name: 'Mahindra Accelo Limited',
    contactName: null,
    phone: '+91 2114 255348',
    address: 'At & Post-Kanhe, Taluka-Maval',
    city: 'Pune',
    state: 'Maharashtra',
    country: 'India',
    gstin: '27AAACM4745P1ZZ',
    materials: 'SPCC Sheet, SPCC GA Sheet',
    isActive: true,
    deletedAt: null,
  };
  const supplier = await prisma.supplier.upsert({
    where: { code: 'SUP-MAL' },
    update: supplierData,
    create: { code: 'SUP-MAL', ...supplierData },
  });

  // Invoice quantities are in tonnes (TO) and rates per tonne; the ERP keeps
  // sheet stock in kg, so 11.031 TO @ ₹62,862/TO = 11,031 kg @ ₹62.862/kg.
  const lines = [
    {
      poNumber: 'PO-MAL-96-1',
      materialCode: 'FR20110004000744',
      materialName: 'SPCC Sheet 1 x 400 x 744',
      hsn: '72091620',
      tonnes: '11.031',
      kg: '11031',
      ratePerTonne: '62,862',
      ratePerKg: '62.862',
      taxable: '6,93,430.75',
      gstEach: '62,408.74',
      total: '818248.23',
    },
    {
      poNumber: 'PO-MAL-96-2',
      materialCode: 'FR50108012500558',
      materialName: 'SPCC GA Sheet 0.8 x 1250 x 558',
      hsn: '72104900',
      tonnes: '4.980',
      kg: '4980',
      ratePerTonne: '75,739',
      ratePerKg: '75.739',
      taxable: '3,77,180.22',
      gstEach: '33,946.23',
      total: '445072.68',
    },
  ];

  for (const line of lines) {
    const materialData = {
      name: line.materialName,
      description: `Mahindra Accelo material ${line.materialCode} · HSN ${line.hsn}`,
      unit: 'kg',
      category: 'Steel',
      costPerUnit: line.ratePerKg,
      currency: 'INR',
    };
    const material = await prisma.material.upsert({
      where: { code: line.materialCode },
      update: materialData,
      create: { code: line.materialCode, ...materialData },
    });

    await prisma.$transaction(async (tx) => {
      const booked = await tx.stockTransaction.findFirst({
        where: { materialId: material.id, referenceNo: PURCHASE_INVOICE },
      });
      if (booked !== null) return;
      const updated = await tx.material.update({
        where: { id: material.id },
        data: { currentStock: { increment: line.kg } },
      });
      await tx.stockTransaction.create({
        data: {
          materialId: material.id,
          type: 'IN',
          quantity: line.kg,
          balanceAfter: updated.currentStock,
          referenceNo: PURCHASE_INVOICE,
          reason: `Received from Mahindra Accelo Limited against PO 96 (${line.tonnes} TO)`,
          performedByName: 'Stores',
          createdAt: PURCHASE_DATE,
        },
      });
    });

    const poData = {
      supplierId: supplier.id,
      material: line.materialName,
      quantity: line.kg,
      unit: 'kg',
      totalCost: line.total,
      currency: 'INR',
      orderDate: new Date('2026-09-15'),
      expectedDelivery: null,
      actualDelivery: PURCHASE_DATE,
      status: 'DELIVERED' as const,
      notes:
        `PO 96 dt 15-09-2026 · SO 505322138 dt 08-10-2026 · GST invoice ${PURCHASE_INVOICE} dt 13-10-2026 · ` +
        `${line.materialCode}, HSN ${line.hsn} · ${line.tonnes} TO @ ₹${line.ratePerTonne}/TO · ` +
        `taxable ₹${line.taxable} + CGST 9% ₹${line.gstEach} + SGST 9% ₹${line.gstEach} · ` +
        `e-way bill 252307602061 · vehicle MH15FV5101 (Rejos Transport Services) · payment in advance`,
    };
    await prisma.purchaseOrder.upsert({
      where: { poNumber: line.poNumber },
      update: poData,
      create: { poNumber: line.poNumber, ...poData },
    });
  }

  console.log(`   ✓ Supplier: ${supplier.name} (${supplier.code})`);
  console.log(`   ✓ Materials received into stock: ${lines.length}`);
  console.log(`   ✓ Purchase orders: ${lines.map((l) => l.poNumber).join(', ')}`);
}

async function seedChitnisSale(prisma: PrismaClient): Promise<void> {
  console.log('\n🌱  Seeding sale to Chitnis Engineering (invoice 26-27/2113)…');

  const clientData = {
    name: 'Chitnis Engineering Systems Pvt Ltd.',
    address: 'Mfg Plant: Plot No H101/102, MIDC Ambad',
    city: 'Nashik',
    state: 'Maharashtra',
    country: 'India',
    gstin: '27AANCC3110B1Z8',
    isActive: true,
    deletedAt: null,
  };
  const client = await prisma.client.upsert({
    where: { code: 'CLT-CHITNIS' },
    update: clientData,
    create: { code: 'CLT-CHITNIS', ...clientData },
  });

  const orderData = {
    clientId: client.id,
    product: '00100 0B01401BA0010N Assembly Clamp Battery',
    quantity: 800,
    unit: 'nos',
    value: '17521.00',
    currency: 'INR',
    orderDate: new Date('2026-10-26'),
    dispatchDate: new Date('2026-10-26'),
    status: 'DISPATCHED' as const,
    challanNumber: '2113',
    invoiceNumber: '26-27/2113',
    dispatchNote: '4 trays · dispatched through self · vehicle MH17BD4579 · destination MIDC Ambad · e-way bill 232317382467',
    notes:
      "Buyer's order 2021000329 dt 26-10-2026 · HSN 87089900 · 800 NOS @ ₹18.560 · " +
      'taxable ₹14,848.00 + CGST 9% ₹1,336.32 + SGST 9% ₹1,336.32 + round-off ₹0.36 · ' +
      'payment 30 days · e-invoice ack 122635348824192',
  };
  const order = await prisma.clientOrder.upsert({
    where: { orderNumber: 'ORD-CES-2021000329' },
    update: orderData,
    create: { orderNumber: 'ORD-CES-2021000329', ...orderData },
  });

  console.log(`   ✓ Client: ${client.name} (${client.code})`);
  console.log(`   ✓ Client order: ${order.orderNumber} (invoice ${order.invoiceNumber})`);
}

export async function seedBusinessData(prisma: PrismaClient): Promise<void> {
  await seedPartSpecs(prisma);
  await seedMahindraPurchase(prisma);
  await seedChitnisSale(prisma);
}
