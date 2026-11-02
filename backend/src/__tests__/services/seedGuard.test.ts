import { describe, it, expect } from 'vitest';
import { testDataWanted } from '../../utils/seedGuard';

describe('testDataWanted', () => {
  it('needs SEED_TEST_DATA=true outside production', () => {
    expect(testDataWanted({ NODE_ENV: 'development', SEED_TEST_DATA: 'true' })).toBe(true);
    expect(testDataWanted({ NODE_ENV: 'development' })).toBe(false);
  });

  it('never seeds test data in production', () => {
    expect(testDataWanted({ NODE_ENV: 'production', SEED_TEST_DATA: 'true' })).toBe(false);
  });
});
