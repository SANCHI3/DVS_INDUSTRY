# 9. Ethics, privacy and responsible use

The perception service watches people at work. This chapter sets out what the
system records, who can see it, how the law in India applies, and where the
system could harm or wrong the people it watches. It describes the code as it
is. Where the code does not yet do what responsible use needs, this is stated
as a gap.

**This chapter is not legal advice.** The statements about the Digital
Personal Data Protection Act, 2023 are a student's reading of the Act and are
marked **[verify]** where a section number or detail should be checked with
the official text (indiacode.nic.in) or a lawyer before the system is used on
real workers.

## 9.1 What the system records

| Data | Where it is stored | Contents | Identifies a person? |
|---|---|---|---|
| Live frames | Memory only: a rolling buffer of `raw_buffer_window_seconds` (15 s) | Full camera frames | Yes (faces, bodies, clothing) |
| Evidence of an incident | Perception machine's disk, `output/evidence/<camera>/` | 5 s before-clip, 5 s after-clip, 3 keyframes, Grad-CAM heatmaps for fights | Yes |
| Incident record | `output/incidents.jsonl` and the ERP database | Event type, time, camera, location, confidence tier, severity, track IDs, detector evidence (e.g. interaction values) | Indirectly (time + place + evidence link) |
| Plain-language summary | ERP database | Two sentences generated from the record | No names; may describe a person's situation |
| Calibration file | `output/calibration/` | One number per camera (anomaly threshold scale) | No |

What the system does **not** do: it has no face recognition, does not try to
name anyone, and keeps no identity across cameras or days. Track IDs are
ByteTrack numbers that are reset when a person leaves the view. Frames that do
not lead to an incident are never written to disk; they leave the 15-second
buffer and are gone.

What leaves the premises: if an LLM key is configured, the summariser sends
the LLM provider **only** the location name, the event type, the urgency and
the built-in plain-language description (`llm/summarizer.py`, `_facts`). No
image, clip, track ID or score is sent. Without a key nothing is sent and the
built-in description is used.

## 9.2 Monitoring workers: the ethical question

Safety monitoring and worker surveillance use the same camera. The system is
designed for the first:

- it raises **safety events** (fall, fight, fire/smoke, crowding, a person
  in a restricted area, unusual activity), not productivity measures. It does
  not measure time at a workstation, breaks or speed of work;
- the unusual-activity detector is capped at MEDIUM severity and described to
  staff as "something unusual, please look", because it cannot name what it
  saw (`severity.hard_cap.anomaly`);
- every alert goes to a person, who decides what to do (9.5).

The same data could be misused, for example by using loitering alerts to
discipline workers who take breaks, or by keeping clips to build a case
against an individual. The technical design cannot prevent this on its own.
A deploying company should therefore adopt a written policy stating the
purposes (safety and security only), and tell the workers and their
representatives about it before the cameras are switched on.

## 9.3 India: Digital Personal Data Protection Act, 2023

The DPDP Act 2023 governs the processing of digital personal data in India.
CCTV footage of identifiable people, and incident records linked to it, are
personal data. The plant operator decides why and how they are processed, so
it is the **Data Fiduciary**. The workers and visitors filmed are **Data
Principals**. A cloud LLM provider or a hosting company acting on the
operator's instructions would be a **Data Processor**.

How the Act's main duties map onto this system:

| Duty under the Act | What it means here | Status in the code |
|---|---|---|
| Lawful ground: consent (s. 6) or a "legitimate use" (s. 7). s. 7 includes processing for employment purposes and to safeguard the employer from loss or liability **[verify exact clause]** | Safety monitoring of employees can likely rely on the employment legitimate use; visitors and contractors need notice signage, and possibly consent | Outside the code: an organisational decision |
| Notice (s. 5): what data, for what purpose, how to exercise rights and complain | Signs at camera locations; a written notice to workers naming the purposes in 9.2 | Not provided by the software |
| Purpose limitation: data used only for the stated purpose | Use incidents only for safety/security, not performance appraisal | Not enforced technically; the ERP's analytics module counts incidents per department, not per person |
| Accuracy (s. 8(3)) when data is used to make a decision about a person | A false alarm must not be held against anyone; alerts must be reviewable (9.5) | Every incident starts with `review_status: pending`; confidence tier and evidence are shown |
| Security safeguards (s. 8(5)) | Evidence on the perception machine's disk; access through the ERP is role-limited | ERP evidence routes need ADMIN, MANAGER or PRODUCTION role (`security.routes.ts`); files on the perception disk are not encrypted |
| Breach notification to the Data Protection Board and to affected people (s. 8(6)) | A leak of evidence clips is a personal data breach | Process needed outside the code |
| Erasure when the purpose is served (s. 8(7)) | Delete evidence that is no longer needed (9.4) | **Not implemented:** nothing deletes evidence automatically |
| Rights of Data Principals (ss. 11-13): access, correction and erasure, grievance redressal | A worker can ask what was recorded about them and ask for a wrong incident to be corrected | Possible manually (find incident by time and place); no workflow in the ERP |
| Children (s. 9): no tracking or behavioural monitoring of children | Not expected in a factory; if minors may be present (visits, apprentices), cameras in those areas need review | Not addressed |

The DPDP Rules, 2025 add operational detail, including timelines and minimum
log retention. They should be read before deployment **[verify: notification
date and which provisions are in force on the deployment date]**. Penalties
under the Act's schedule are large, up to ₹250 crore for failing to take
reasonable security safeguards **[verify]**, so the gaps marked above are not
paperwork.

## 9.4 Retention of evidence clips

Today, evidence clips and keyframes stay on disk until someone deletes them,
and incident rows stay in the database indefinitely. That conflicts with
erasure once the purpose is served. A defensible policy, to be implemented
before production use:

| Item | Proposed retention | Reason |
|---|---|---|
| Live frame buffer | 15 s (as now) | Needed only to cut the before-clip |
| Evidence of an incident reviewed as a **false alarm** | Delete clips and keyframes within 7 days; keep the incident row without media for statistics | No safety purpose remains |
| Evidence of a **genuine** incident | 90 days, or until any investigation, insurance claim or legal proceeding is closed | Investigation and legal-hold needs **[verify against company policy and any sector rules]** |
| Incident rows (no media) | Aggregated after 1 year (counts per camera and type) | Trend analysis without per-event personal data |
| Anomaly calibration file | Kept | Contains no personal data |

This needs a review label that the system does not have yet. Incidents can be
acknowledged and resolved in the ERP, but not marked "false alarm". Adding that
label, plus a scheduled job that applies the table above, is listed in 8.2.
Face blurring of stored clips, applied after review, would reduce what a
leaked clip reveals.

## 9.5 Human in the loop

The system recommends; people decide.

- **Confidence tiers:** PROBABLE fights and crowds are shown as signals
  "awaiting confirmation" and are not persisted as incidents. Only CONFIRMED
  events (or PROBABLE ones escalated to CONFIRMED) reach the dashboard pop-up.
- **Evidence with every alert:** keyframes, before/after clips and, for
  fights, Grad-CAM heatmaps let the reviewer check what the model reacted to
  instead of trusting a score.
- **No automatic action against a person:** no alert locks a door, notifies
  the police or records a disciplinary event. The prescribed action in each
  summary is for a person to go and look.
- **Plain language with honest uncertainty:** summaries keep the built-in
  description's uncertainty words ("appears to", "may"). The LLM output is
  rejected if it adds facts or numbers (`_summary_preserves_required_facts`).
- **Gap:** the review outcome (genuine / false alarm) is not recorded, so
  false-alarm rates in production cannot yet be measured from reviews. It is
  also needed for retention (9.4) and for retraining.

## 9.6 Bias and limits of the training data

All models were trained on public datasets, not on the plant's workers
(chapter 2, chapter 6 and `docs/RESULTS.md`).

- **Who is in the data.** The fight data (surveillance-camera fight clips
  and the "Real Life Violence Situations" set **[verify]**) and the fall data
  mostly show adults in public places, homes and staged scenes. The share of
  people who look like the plant's workforce (skin tone, clothing such as
  uniforms, sarees, helmets or PPE, body shape) is unknown. Detection rates
  for groups under-represented in the data may be lower, and nobody has
  measured this. No dataset used here records demographic attributes, so
  per-group error rates cannot be computed from the existing data.
- **What counts as a fight.** The fight data includes rough play, sport
  and staged scenes. Vigorous but harmless work (lifting, hammering, two
  people carrying a load) can look like a fight to the clip classifier. The
  interaction check reduces this, but it is tuned on public clips (RESULTS.md
  section 5), not on factory work.
- **Falls are staged.** The fall clips are staged by actors. Real falls,
  especially of older or heavier workers, or falls from height partly out of
  view, may look different. The deployed fall model was also trained on all
  160 clips, so its field recall is unmeasured.
- **Fire look-alikes.** The fire verifier was trained on FIRESENSE. The
  plant's own look-alikes (welding arcs, furnace glow, sodium lamps, orange
  PPE) are not in it.
- **Unusual ≠ wrong.** The anomaly detector flags what is rare on that
  camera. Workers whose normal behaviour differs from the majority (a person
  using a wheelchair or crutches, someone who works alone at night) could be
  flagged more often. It is capped at MEDIUM and phrased as "please look" for
  this reason.

Each of these needs measurement on site before the system's alerts are trusted
for anything beyond prompting a person to look. With consent and a retention
policy, site footage could support such an audit: alerts per hour per camera
and shift, and reviewed false-alarm rates per incident type.

## 9.7 Summary of obligations before real deployment

1. Written purpose policy (safety and security only), shared with workers.
2. Notices at camera locations; DPDP notice to employees and visitors.
3. Redraw zones around the real restricted areas (placeholder zones flag
   ordinary work).
4. Implement a false-alarm review label and the retention job (9.4).
5. Encrypt the evidence folder; keep evidence access role-limited and logged.
6. Breach-response and grievance contacts.
7. Measure false alarms and misses on the plant's own footage, including per
   shift and camera, before relying on the alerts.
