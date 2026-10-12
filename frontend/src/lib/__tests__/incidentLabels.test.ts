import { describe, expect, it } from 'vitest';
import { alertText, confidenceLabel, eventTypeLabel, incidentHeadline, priorityLabel } from '../incidentLabels';

describe('incident labels', () => {
  it('uses everyday names instead of internal types', () => {
    expect(eventTypeLabel('OTHER')).toBe('Unusual activity');
    expect(eventTypeLabel('FIRE_SMOKE')).toBe('Fire or smoke seen');
    expect(eventTypeLabel('NEAR_MISS')).toBe('Near Miss');
  });

  it('says a critical fall means the person is not getting up', () => {
    expect(incidentHeadline({ type: 'FALL', severity: 'MEDIUM' })).toBe('Person has fallen');
    expect(incidentHeadline({ type: 'FALL', severity: 'CRITICAL' })).toBe('Fallen person not getting up');
  });

  it('puts confidence and priority into words', () => {
    expect(confidenceLabel(0.99)).toBe('Very likely (99%)');
    expect(confidenceLabel(0.75)).toBe('Likely (75%)');
    expect(confidenceLabel(0.4)).toBe('Possible (40%)');
    expect(confidenceLabel(null)).toBe('Unknown');
    expect(priorityLabel('CRITICAL')).toBe('Urgent: act now');
  });
});

describe('alertText', () => {
  const description =
    'Someone appears to have fallen down in Test Room. What to do: Send someone to check on the person right away.';

  it('splits the plain description into summary and action', () => {
    expect(alertText({ aiSummary: null, description })).toEqual({
      summary: 'Someone appears to have fallen down in Test Room.',
      action: 'Send someone to check on the person right away.',
    });
  });

  it('prefers the AI summary, which already includes the advice', () => {
    expect(alertText({ aiSummary: 'AI text.', description })).toEqual({ summary: 'AI text.', action: null });
  });

  it('copes with older descriptions that have no advice', () => {
    expect(alertText({ aiSummary: null, description: 'An event was detected.' })).toEqual({
      summary: 'An event was detected.',
      action: null,
    });
  });
});
