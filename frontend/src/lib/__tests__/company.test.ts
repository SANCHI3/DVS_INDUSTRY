import { describe, expect, it } from 'vitest';
import { telHref, yearsInBusiness } from '../company';
import { inquiryErrorMessage } from '../services/inquiries.service';

describe('company details', () => {
  it('counts whole years since the 2000 founding', () => {
    expect(yearsInBusiness(new Date('2026-11-01'))).toBe(26);
    expect(yearsInBusiness(new Date('2030-01-15'))).toBe(30);
  });

  it('builds a dialable tel: link from a printed number', () => {
    expect(telHref('+91 98765 43210')).toBe('tel:+919876543210');
  });
});

describe('inquiry error messages', () => {
  it('never uses technical wording', () => {
    const cases = [
      { status: 429, code: 'X', message: 'Too many' },
      { status: 503, code: 'X', message: 'Service Unavailable' },
      { status: 500, code: 'X', message: 'Internal' },
      new Error('Network Error'),
    ];
    for (const err of cases) {
      expect(inquiryErrorMessage(err)).not.toMatch(/API|backend|server error|500|503/);
    }
  });
});
