/**
 * Removes the development/test records the seed and the camera trial left
 * behind. DRY RUN BY DEFAULT: it prints what it would change and changes
 * nothing. Run it yourself against the database you mean, and read the list
 * before adding --apply.
 *
 * Usage (from backend/):
 *   npm run cleanup:test-data                          # dry run
 *   npm run cleanup:test-data -- --apply               # remove test logins, partners, orders
 *   npm run cleanup:test-data -- --incidents           # also list camera-trial incidents
 *   npm run cleanup:test-data -- --incidents --location "Test Room" --apply
 *
 * What it matches (see src/utils/testData.ts):
 *   - users: *.test@dvsindustry.local named "Development … User" (never ADMIN
 *     or PERCEPTION_SERVICE; real portal logins on @dvsindustry.local are kept)
 *   - suppliers SUP-TEST-*, clients CLT-TEST-*, POs PO-TEST-*, client orders ORD-TEST-*
 *   - with --incidents: security incidents at the given location (default
 *     "Test Room"), their updates, uploaded pictures (IncidentEvidence, deleted
 *     with the incident) and alerts linked to them
 *
 * Foreign keys: work orders pointing at a removed client order are unlinked,
 * portal messages of removed partners/users are removed, and a user that is
 * still referenced elsewhere is deactivated instead of deleted.
 * Stock history is never touched.
 */
import 'dotenv/config';
import { Prisma, PrismaClient } from '@prisma/client';
import { TEST_CODE_PREFIX, isTestUser, parseCleanupArgs } from '../src/utils/testData';

const prisma = new PrismaClient();

function list(label: string, items: string[]): void {
  console.log(`\n${label}: ${items.length}`);
  for (const item of items.slice(0, 50)) console.log(`   - ${item}`);
  if (items.length > 50) console.log(`   … and ${items.length - 50} more`);
}

async function main(): Promise<void> {
  const options = parseCleanupArgs(process.argv.slice(2));
  const host = (process.env['DATABASE_URL'] ?? '').replace(/^.*@/, '').replace(/[/?].*$/, '');
  console.log('─'.repeat(60));
  console.log(`DVS Industry — test data cleanup (${options.apply ? 'APPLY' : 'dry run'})`);
  console.log(`Database host: ${host || '(DATABASE_URL not set)'}`);
  console.log('─'.repeat(60));

  const users = (
    await prisma.user.findMany({
      select: { id: true, email: true, fullName: true, role: { select: { name: true } } },
      where: { email: { endsWith: '@dvsindustry.local' } },
    })
  ).filter((u) => isTestUser({ email: u.email, fullName: u.fullName, role: u.role.name }));
  const suppliers = await prisma.supplier.findMany({
    where: { code: { startsWith: TEST_CODE_PREFIX.supplier } },
    select: { id: true, code: true, name: true },
  });
  const clients = await prisma.client.findMany({
    where: { code: { startsWith: TEST_CODE_PREFIX.client } },
    select: { id: true, code: true, name: true },
  });
  const supplierIds = suppliers.map((s) => s.id);
  const clientIds = clients.map((c) => c.id);
  // Orders of test partners go too (they cannot exist without the partner)
  const purchaseOrders = await prisma.purchaseOrder.findMany({
    where: {
      OR: [
        { poNumber: { startsWith: TEST_CODE_PREFIX.purchaseOrder } },
        { supplierId: { in: supplierIds } },
      ],
    },
    select: { id: true, poNumber: true, status: true },
  });
  const clientOrders = await prisma.clientOrder.findMany({
    where: {
      OR: [
        { orderNumber: { startsWith: TEST_CODE_PREFIX.clientOrder } },
        { clientId: { in: clientIds } },
      ],
    },
    select: { id: true, orderNumber: true, status: true },
  });
  const clientOrderIds = clientOrders.map((o) => o.id);
  const linkedWorkOrders = await prisma.workOrder.findMany({
    where: { clientOrderId: { in: clientOrderIds } },
    select: { workOrderNumber: true },
  });
  const incidents = options.incidents
    ? await prisma.securityIncident.findMany({
        where: { location: options.incidentLocation },
        select: { id: true, incidentNumber: true, type: true, status: true },
        orderBy: { id: 'asc' },
      })
    : [];
  const incidentIds = incidents.map((i) => i.id);

  list('Test logins', users.map((u) => `${u.email} (${u.fullName}, ${u.role.name})`));
  list('Test suppliers', suppliers.map((s) => `${s.code} ${s.name}`));
  list('Test clients', clients.map((c) => `${c.code} ${c.name}`));
  list('Test purchase orders', purchaseOrders.map((p) => `${p.poNumber} (${p.status})`));
  list('Test client orders', clientOrders.map((o) => `${o.orderNumber} (${o.status})`));
  list('Work orders to unlink from those client orders (kept)', linkedWorkOrders.map((w) => w.workOrderNumber));
  if (options.incidents) {
    const byType = new Map<string, number>();
    for (const i of incidents) byType.set(`${i.type} ${i.status}`, (byType.get(`${i.type} ${i.status}`) ?? 0) + 1);
    console.log(
      `
Incidents at "${options.incidentLocation}" by type and status: ` +
        ([...byType].map(([k, n]) => `${k} ${n}`).join(', ') || 'none'),
    );
    list(
      `Incidents at "${options.incidentLocation}" (their updates and pictures go with them)`,
      incidents.map((i) => `${i.incidentNumber} ${i.type} (${i.status})`),
    );
  } else {
    console.log('\nIncidents: not included (add --incidents to list camera-trial incidents)');
  }

  if (!options.apply) {
    console.log('\nDry run: nothing was changed. Add --apply to make these changes.');
    return;
  }

  await prisma.$transaction(
    async (tx) => {
      await tx.workOrder.updateMany({
        where: { clientOrderId: { in: clientOrderIds } },
        data: { clientOrderId: null },
      });
      await tx.clientOrder.deleteMany({ where: { id: { in: clientOrderIds } } });
      await tx.purchaseOrder.deleteMany({ where: { id: { in: purchaseOrders.map((p) => p.id) } } });
      // Portal messages cascade with their partner; messages sent by test logins go too
      await tx.portalMessage.deleteMany({ where: { senderId: { in: users.map((u) => u.id) } } });
      await tx.supplier.deleteMany({ where: { id: { in: supplierIds } } });
      await tx.client.deleteMany({ where: { id: { in: clientIds } } });
      if (incidentIds.length > 0) {
        await tx.securityAlert.deleteMany({ where: { incidentId: { in: incidentIds } } });
        await tx.securityIncident.deleteMany({ where: { id: { in: incidentIds } } });
      }
    },
    { timeout: 60_000 },
  );

  // One by one, so a login still referenced elsewhere is deactivated instead
  let deactivated = 0;
  for (const user of users) {
    try {
      await prisma.user.delete({ where: { id: user.id } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
        await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
        deactivated += 1;
        console.log(`   ${user.email} is still referenced, so it was deactivated instead`);
      } else {
        throw err;
      }
    }
  }

  console.log(
    `\nDone: removed ${users.length - deactivated} logins (${deactivated} deactivated), ` +
      `${suppliers.length} suppliers, ${clients.length} clients, ${purchaseOrders.length} POs, ` +
      `${clientOrders.length} client orders, ${incidents.length} incidents.`,
  );
}

main()
  .catch((err) => {
    console.error('Cleanup failed; nothing after the failing step was changed:', err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
