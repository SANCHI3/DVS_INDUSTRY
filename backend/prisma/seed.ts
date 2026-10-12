/**
 * Prisma seed script — run once to populate reference data.
 *
 *   npm run db:seed
 *
 * Safe to run multiple times (upsert on unique fields).
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { seedPerceptionServiceAccount } from './seed-perception-service';

const prisma = new PrismaClient();

// ── Seed data ───────────────────────────────────────────────────────────────

const roles = [
  {
    name: 'ADMIN',
    description: 'Full system access. Manages users, roles, and all modules.',
  },
  {
    name: 'MANAGER',
    description: 'Cross-department oversight. Can view reports and manage teams.',
  },
  {
    name: 'HR',
    description: 'Human Resources — manages employee records and workforce data.',
  },
  {
    name: 'STORE',
    description: 'Inventory and warehouse management.',
  },
  {
    name: 'PRODUCTION',
    description: 'Production floor — manages work orders and manufacturing.',
  },
  {
    name: 'SALES',
    description: 'Sales team — manages orders, clients, and quotations.',
  },
  {
    name: 'SUPPLIER',
    description: 'Development supplier portal access for supplier-linked users.',
  },
  {
    name: 'CLIENT',
    description: 'Client portal access for client-linked users.',
  },
  {
    name: 'PERCEPTION_SERVICE',
    description: 'Machine account for the perception service security write flow.',
  },
] as const;

async function seedRoles(): Promise<Map<string, number>> {
  console.log('🌱  Seeding roles…');
  const roleMap = new Map<string, number>();

  for (const role of roles) {
    const upserted = await prisma.role.upsert({
      where: { name: role.name },
      update: { description: role.description },
      create: { name: role.name, description: role.description },
    });
    roleMap.set(upserted.name, upserted.id);
    console.log(`   ✓ Role: ${upserted.name} (id: ${upserted.id})`);
  }

  return roleMap;
}

async function seedAdminUser(adminRoleId: number): Promise<void> {
  console.log('\n🌱  Seeding admin user…');

  const adminEmail = process.env['SEED_ADMIN_EMAIL'] ?? 'admin@dvsindustry.com';
  const adminPassword = process.env['SEED_ADMIN_PASSWORD'];

  if (process.env['NODE_ENV'] === 'production' && adminPassword === undefined) {
    throw new Error('SEED_ADMIN_PASSWORD is required when seeding production.');
  }

  const password = adminPassword ?? 'DvsDevOnly!ChangeMe2026';

  const existing = await prisma.user.findUnique({ where: { email: adminEmail } });

  if (existing !== null) {
    console.log(`   ⚠  Admin user already exists: ${adminEmail} — skipping`);
    return;
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  const admin = await prisma.user.create({
    data: {
      fullName: 'DVS Administrator',
      email: adminEmail,
      password: hashedPassword,
      roleId: adminRoleId,
      isActive: true,
    },
  });

  console.log(`   ✓ Admin user created: ${admin.email} (id: ${admin.id})`);
  console.log(
    `   ⚠  IMPORTANT: Change the admin password immediately after first login!`,
  );
}

async function seedSupplierData(supplierRoleId: number): Promise<void> {
  if (process.env['NODE_ENV'] === 'production') {
    console.log('\n⚠  Skipping development supplier test data in production.');
    return;
  }

  const supplierEmail = process.env['SEED_SUPPLIER_EMAIL'] ?? 'supplier.test@dvsindustry.local';
  const supplierPassword = process.env['SEED_SUPPLIER_PASSWORD'];
  if (!supplierPassword) {
    console.log('\n⚠  SEED_SUPPLIER_PASSWORD not set — skipping supplier test data.');
    return;
  }

  console.log('\n🌱  Seeding development supplier test data…');
  const supplier = await prisma.supplier.upsert({
    where: { code: 'SUP-TEST-001' },
    update: {
      name: 'Maharashtra Precision Metals (Test)',
      email: supplierEmail,
      isActive: true,
      deletedAt: null,
    },
    create: {
      name: 'Maharashtra Precision Metals (Test)',
      code: 'SUP-TEST-001',
      contactName: 'Test Supplier Contact',
      email: supplierEmail,
      phone: '+91 90000 00001',
      address: 'Development Test Facility',
      city: 'Nashik',
      state: 'Maharashtra',
      country: 'India',
      rating: '4.6',
      leadTimeDays: 4,
      reliability: '96%',
      materials: 'Steel Sheet, Aluminium Strip',
    },
  });

  const hashedPassword = await bcrypt.hash(supplierPassword, 12);
  await prisma.user.upsert({
    where: { email: supplierEmail },
    update: { fullName: 'Development Supplier User', password: hashedPassword, roleId: supplierRoleId, isActive: true },
    create: {
      fullName: 'Development Supplier User',
      email: supplierEmail,
      password: hashedPassword,
      roleId: supplierRoleId,
      isActive: true,
    },
  });

  const purchaseOrders = [
    { poNumber: 'PO-TEST-001', material: 'Steel Sheet 2mm', quantity: '500', unit: 'kg', totalCost: '36000', status: 'DELIVERED' as const, expectedDelivery: new Date('2026-09-15'), actualDelivery: new Date('2026-09-15') },
    { poNumber: 'PO-TEST-002', material: 'Aluminium Strip', quantity: '200', unit: 'kg', totalCost: '37000', status: 'IN_TRANSIT' as const, expectedDelivery: new Date('2026-09-25'), actualDelivery: null },
    { poNumber: 'PO-TEST-003', material: 'Steel Sheet 2mm', quantity: '750', unit: 'kg', totalCost: '54000', status: 'PENDING' as const, expectedDelivery: new Date('2026-10-02'), actualDelivery: null },
  ];

  for (const order of purchaseOrders) {
    await prisma.purchaseOrder.upsert({
      where: { poNumber: order.poNumber },
      update: { supplierId: supplier.id, ...order },
      create: { supplierId: supplier.id, currency: 'INR', notes: 'Development/test seed record', ...order },
    });
  }

  console.log(`   ✓ Test supplier: ${supplier.code} (${supplier.email})`);
  console.log(`   ✓ Test supplier user: ${supplierEmail} (password from SEED_SUPPLIER_PASSWORD)`);
  console.log(`   ✓ Test purchase orders: ${purchaseOrders.length}`);
}

async function seedClientData(clientRoleId: number): Promise<void> {
  if (process.env['NODE_ENV'] === 'production') {
    console.log('\n⚠  Skipping development client test data in production.');
    return;
  }

  const clientEmail = process.env['SEED_CLIENT_EMAIL'] ?? 'client.test@dvsindustry.local';
  const clientPassword = process.env['SEED_CLIENT_PASSWORD'];
  if (!clientPassword) {
    console.log('\n⚠  SEED_CLIENT_PASSWORD not set — skipping client test data.');
    return;
  }

  console.log('\n🌱  Seeding development client test data…');
  const client = await prisma.client.upsert({
    where: { code: 'CLT-TEST-001' },
    update: {
      name: 'Western Automotive Components (Test)',
      email: clientEmail,
      isActive: true,
      deletedAt: null,
    },
    create: {
      name: 'Western Automotive Components (Test)',
      code: 'CLT-TEST-001',
      contactName: 'Test Client Contact',
      email: clientEmail,
      phone: '+91 90000 00002',
      address: 'Development Test Office',
      city: 'Pune',
      state: 'Maharashtra',
      country: 'India',
      gstin: '27TESTCLIENT001Z1',
    },
  });

  const hashedPassword = await bcrypt.hash(clientPassword, 12);
  await prisma.user.upsert({
    where: { email: clientEmail },
    update: { fullName: 'Development Client User', password: hashedPassword, roleId: clientRoleId, isActive: true },
    create: {
      fullName: 'Development Client User',
      email: clientEmail,
      password: hashedPassword,
      roleId: clientRoleId,
      isActive: true,
    },
  });

  const clientOrders = [
    { orderNumber: 'ORD-TEST-001', product: 'Steel Frame Assembly', quantity: 500, unit: 'pcs', value: '182000', status: 'IN_PRODUCTION' as const, orderDate: new Date('2026-09-10'), requiredDate: new Date('2026-09-30') },
    { orderNumber: 'ORD-TEST-002', product: 'Pressed Aluminium Panel', quantity: 200, unit: 'pcs', value: '104000', status: 'DISPATCHED' as const, orderDate: new Date('2026-09-05'), requiredDate: new Date('2026-09-25'), dispatchDate: new Date('2026-09-18'), dispatchNote: 'Development dispatch record', challanNumber: 'DC-TEST-002', invoiceNumber: 'INV-TEST-002' },
    { orderNumber: 'ORD-TEST-003', product: 'Sheet Metal Bracket', quantity: 800, unit: 'pcs', value: '148000', status: 'DELIVERED' as const, orderDate: new Date('2026-08-20'), requiredDate: new Date('2026-09-10'), dispatchDate: new Date('2026-09-05'), deliveryDate: new Date('2026-09-09'), dispatchNote: 'Development delivered record', challanNumber: 'DC-TEST-003', invoiceNumber: 'INV-TEST-003' },
  ];

  for (const order of clientOrders) {
    await prisma.clientOrder.upsert({
      where: { orderNumber: order.orderNumber },
      update: { clientId: client.id, ...order },
      create: { clientId: client.id, currency: 'INR', notes: 'Development/test seed record', ...order },
    });
  }

  console.log(`   ✓ Test client: ${client.code} (${client.email})`);
  console.log(`   ✓ Test client user: ${clientEmail} (password from SEED_CLIENT_PASSWORD)`);
  console.log(`   ✓ Test client orders: ${clientOrders.length}`);
}

/**
 * Development staff logins for the role-restricted portals (Production,
 * Store). Each is created/updated only when its SEED_<ROLE>_PASSWORD is set.
 */
async function seedStaffUsers(roleMap: Map<string, number>): Promise<void> {
  if (process.env['NODE_ENV'] === 'production') {
    console.log('\n⚠  Skipping development staff accounts in production.');
    return;
  }

  const staff = [
    { role: 'PRODUCTION', envPrefix: 'SEED_PRODUCTION', defaultEmail: 'production.test@dvsindustry.local', fullName: 'Development Production User' },
    { role: 'STORE', envPrefix: 'SEED_STORE', defaultEmail: 'store.test@dvsindustry.local', fullName: 'Development Store User' },
  ] as const;

  console.log('\n🌱  Seeding development staff accounts…');
  for (const member of staff) {
    const password = process.env[`${member.envPrefix}_PASSWORD`];
    if (!password) {
      console.log(`   ⚠  ${member.envPrefix}_PASSWORD not set — skipping ${member.role} account`);
      continue;
    }
    const roleId = roleMap.get(member.role);
    if (roleId === undefined) throw new Error(`${member.role} role was not created`);
    const email = process.env[`${member.envPrefix}_EMAIL`] ?? member.defaultEmail;
    const hashedPassword = await bcrypt.hash(password, 12);
    await prisma.user.upsert({
      where: { email },
      update: { fullName: member.fullName, password: hashedPassword, roleId, isActive: true },
      create: { fullName: member.fullName, email, password: hashedPassword, roleId, isActive: true },
    });
    console.log(`   ✓ ${member.role} user: ${email} (password from ${member.envPrefix}_PASSWORD)`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('─'.repeat(50));
  console.log('DVS Industry — Database Seed');
  console.log('─'.repeat(50));

  const roleMap = await seedRoles();

  const adminId = roleMap.get('ADMIN');
  if (adminId === undefined) {
    throw new Error('ADMIN role was not created — cannot seed admin user');
  }

  await seedAdminUser(adminId);

  const perceptionServiceRoleId = roleMap.get('PERCEPTION_SERVICE');
  if (perceptionServiceRoleId === undefined) {
    throw new Error('PERCEPTION_SERVICE role was not created — cannot seed perception service account');
  }
  await seedPerceptionServiceAccount(prisma, perceptionServiceRoleId);

  const supplierRoleId = roleMap.get('SUPPLIER');
  if (supplierRoleId === undefined) {
    throw new Error('SUPPLIER role was not created — cannot seed supplier test data');
  }
  await seedSupplierData(supplierRoleId);

  const clientRoleId = roleMap.get('CLIENT');
  if (clientRoleId === undefined) {
    throw new Error('CLIENT role was not created — cannot seed client test data');
  }
  await seedClientData(clientRoleId);

  await seedStaffUsers(roleMap);

  console.log('\n✅  Seed complete');
  console.log('─'.repeat(50));
}

main()
  .catch((err) => {
    console.error('❌  Seed failed:', err);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
