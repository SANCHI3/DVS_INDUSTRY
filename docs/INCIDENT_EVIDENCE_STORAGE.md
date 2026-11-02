# Design note: storing incident evidence

Status: **proposal, not built.** It waits for the real CCTV details: number of
cameras, where the perception PC sits, and how long footage may be kept.

## Today

- The perception service writes keyframes, Grad-CAM images and before/after
  clips to its own disk (`PERCEPTION_OUTPUT_DIR`). It also writes
  `incidents.jsonl` and `evidence_updates.jsonl`.
- The API reads those files directly
  (`backend/src/services/perceptionEvidence.service.ts`). This works only
  when the API runs on the same machine as the perception service.
- The hosted API on Render cannot see that disk, and Render wipes its own
  disk on every deploy. So on the live site the evidence dialog shows
  "Camera snapshots are not available for this incident."

## Proposal

1. **Object storage for the files.** Use an S3-compatible bucket
   (Cloudflare R2, Backblaze B2 or AWS S3). After an incident is confirmed,
   the perception service uploads its files to keys like
   `incidents/<incidentNumber>/<kind>-<n>.<ext>`.
   - Uploads go through the existing outbox, so a network drop only delays
     them.
   - The files are not stored in Postgres: one clip is several MB, and Neon's
     free storage is small. Profile photos are a different case because
     they are tiny.
2. **One table for the index.** `IncidentEvidenceFile` would hold:
   `incidentId`, `kind` (keyframe / gradcam / clip_before / clip_after),
   `storageKey`, `sizeBytes`, `sha256` and `capturedAt`.
   - The perception service registers each file through a new endpoint,
     using its service account.
   - The `sha256` shows the file was not changed afterwards.
3. **Viewing.** The evidence endpoint returns short-lived signed URLs (about
   5 minutes), only to roles that can open Security. The bucket itself stays
   private. Each view is written to the audit log.
4. **Retention.** Delete with a daily job. Proposed periods, for the owner to
   confirm:
   - false alarms: after 7 days
   - closed incidents: after 90 days
   - incidents still open or under investigation: kept
5. **Fallback.** While storage is not configured, keep today's behaviour:
   read from local disk if present, otherwise show the plain "not available"
   message.

## Sizing (to check with real cameras)

| Item | Rough size |
|---|---|
| Keyframes + Grad-CAM per incident | ~0.5 MB |
| Two 5-second clips per incident | ~4 MB |

At 10 confirmed incidents a day with 90-day retention, that is about 4 GB.
This fits the free tiers of R2 and B2.

## Owner decisions needed

- Which storage provider and account to use.
  New environment variables: `EVIDENCE_BUCKET`, `EVIDENCE_ENDPOINT`,
  `EVIDENCE_ACCESS_KEY_ID`, `EVIDENCE_SECRET_ACCESS_KEY`.
- The retention periods above, and whether company policy on CCTV of
  employees needs any of them shorter.
- Who may view clips. The proposal is Admin and Manager, matching who can
  manage incidents.
