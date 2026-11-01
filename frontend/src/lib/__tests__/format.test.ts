import { describe, expect, it } from 'vitest';
import { formatINR, formatINRCompact, formatMoney } from '../format';

describe('formatINR', () => {
  it('uses Indian digit grouping', () => {
    expect(formatINR(1106610.94)).toBe('₹11,06,610.94');
    expect(formatINR('1106610.94')).toBe('₹11,06,610.94');
    expect(formatINR(36000)).toBe('₹36,000');
  });

  it('can fix the paise', () => {
    expect(formatINR(650, 2)).toBe('₹650.00');
    expect(formatINR(1106610.94, 0)).toBe('₹11,06,611');
  });

  it('shows a dash for missing values', () => {
    expect(formatINR(null)).toBe('—');
    expect(formatINR('')).toBe('—');
    expect(formatINR('abc')).toBe('—');
  });
});

describe('formatINRCompact', () => {
  it('labels lakh as L (the dashboard once showed ₹11.1L as ₹1.1L)', () => {
    expect(formatINRCompact(1106610.94)).toBe('₹11.1L');
    expect(formatINRCompact(100000)).toBe('₹1L');
  });

  it('uses K below a lakh and Cr from a crore', () => {
    expect(formatINRCompact(45230)).toBe('₹45.2K');
    expect(formatINRCompact(25400000)).toBe('₹2.54Cr');
    expect(formatINRCompact(950)).toBe('₹950');
    expect(formatINRCompact(-2500)).toBe('-₹2.5K');
  });
});

describe('formatMoney', () => {
  it('formats INR and labels other currencies', () => {
    expect(formatMoney('182000')).toBe('₹1,82,000');
    expect(formatMoney('1500.5', 'EUR')).toBe('EUR 1,500.5');
    expect(formatMoney(null)).toBe('—');
  });
});
