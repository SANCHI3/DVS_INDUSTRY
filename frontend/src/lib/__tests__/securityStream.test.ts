import { describe, expect, it } from 'vitest';
import { parseSseFrame, splitSseFrames } from '../securityStream';

const frame = (event: object) => `event: x\ndata: ${JSON.stringify(event)}`;

describe('parseSseFrame', () => {
  it('decodes an incident event', () => {
    const parsed = parseSseFrame(frame({ type: 'incident.deleted', incidentId: 7 }));
    expect(parsed).toEqual({ type: 'incident.deleted', incidentId: 7 });
  });

  it('ignores heartbeats, retry hints and malformed data', () => {
    expect(parseSseFrame(': ping')).toBeNull();
    expect(parseSseFrame('retry: 3000')).toBeNull();
    expect(parseSseFrame('data: {not json')).toBeNull();
  });
});

describe('splitSseFrames', () => {
  it('returns complete frames and keeps the partial remainder', () => {
    const a = frame({ type: 'incident.deleted', incidentId: 1 });
    const { frames, rest } = splitSseFrames(`${a}\n\n: ping\n\ndata: {"type":"incid`);
    expect(frames).toEqual([a, ': ping']);
    expect(rest).toBe('data: {"type":"incid');
  });

  it('reassembles a frame cut mid-JSON across network chunks', () => {
    const first = splitSseFrames('data: {"type":"incident.del');
    expect(first.frames).toEqual([]);
    const second = splitSseFrames(`${first.rest}eted","incidentId":3}\n\n`);
    expect(second.frames).toHaveLength(1);
    expect(parseSseFrame(second.frames[0]!)).toEqual({ type: 'incident.deleted', incidentId: 3 });
  });

  it('handles CRLF line endings split between chunks', () => {
    const first = splitSseFrames('data: {"type":"incident.deleted","incidentId":4}\r');
    const second = splitSseFrames(`${first.rest}\n\r\n`);
    expect(second.frames).toHaveLength(1);
    expect(parseSseFrame(second.frames[0]!)).toEqual({ type: 'incident.deleted', incidentId: 4 });
  });
});
