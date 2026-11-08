/**
 * The last answers to the plant's video server, kept in memory only.
 *
 * Shown to admins in the Live view check, to tell whether MediaMTX on the plant
 * PC is calling the website at all, and why a viewer was refused. Nothing
 * secret is kept: no pass, no address, only the stream path and the outcome.
 */
export type StreamAuthReason =
  'allowed' | 'no-pass' | 'expired' | 'invalid' | 'wrong-path' | 'not-viewing';

export interface StreamAuthEntry {
  at: string;
  path: string;
  protocol: string;
  action: string;
  allowed: boolean;
  reason: StreamAuthReason;
}

/** Enough for a few minutes of viewers; the route is open, so the list must stay small. */
const KEEP = 50;

export class StreamAuthLog {
  private entries: StreamAuthEntry[] = [];

  add(entry: Omit<StreamAuthEntry, 'at'>, now: Date = new Date()): void {
    this.entries.unshift({ ...entry, at: now.toISOString() });
    this.entries.length = Math.min(this.entries.length, KEEP);
  }

  /** Newest first. */
  latest(count = 10): StreamAuthEntry[] {
    return this.entries.slice(0, count);
  }

  clear(): void {
    this.entries = [];
  }
}

/** One per process, like the camera state. */
export const streamAuthLog = new StreamAuthLog();
