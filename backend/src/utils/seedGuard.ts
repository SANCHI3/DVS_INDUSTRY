/**
 * Test logins and "(Test)" partners are only seeded when asked for with
 * SEED_TEST_DATA=true, and never with NODE_ENV=production. Seeding the live
 * database from a laptop therefore no longer creates "Development … User"
 * accounts by accident.
 */
export function testDataWanted(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['NODE_ENV'] !== 'production' && env['SEED_TEST_DATA'] === 'true';
}
