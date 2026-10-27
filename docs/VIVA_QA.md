# Viva questions and answers

Short answers based on this codebase. Numbers come from [RESULTS.md](RESULTS.md).
File paths are given so you can open the code if asked.

## Problem and design

**1. What problem does the project solve?**
Plants record CCTV that nobody watches continuously, and their operational
data lives in a different system. We combine an ERP with a CCTV AI that
detects fights, falls, fire/smoke, crowding and unusual activity, and turns
each one into a single incident with evidence. The
incident appears live on the dashboard.

**2. Why not just use YOLO for everything?**
YOLO detects objects in one frame. A fight, a fall and real fire are defined
by change over time: punching motion, the speed of a collapse, flame flicker.
YOLO is our first stage for finding and tracking people. Each incident type
then has a model suited to it (R3D-18, pose + BiGRU, verifier, autoencoder).

**3. Walk through the pipeline.**
Frame (10 fps, 640×480) → YOLOv8n → ByteTrack → 30-s temporal buffer → rules
and four detectors → event confirmation (N-of-M, PROBABLE/CONFIRMED) →
severity rules → de-duplication → reporter (save, evidence, POST to the ERP)
→ SSE to the browser → LLM summary. See `perception-service/main.py`.

**4. Why a separate Python service instead of doing AI in Node?**
The models need PyTorch, Ultralytics and OpenCV, which are Python. The
service talks to the ERP over its REST API like any other client. It uses its
own least-privilege role (`PERCEPTION_SERVICE`), which can only create
incidents and attach summaries.

**5. How do alerts reach the browser in real time?**
Server-Sent Events on `/api/v1/security/stream`. The backend publishes
`incident.created/updated/deleted`, and the browser keeps one connection and
reconnects with backoff. SSE is simpler than WebSockets because the traffic is
one-way (server to client).

## Models

**6. How does the fight model work?**
R3D-18, a 3D ResNet with 18 layers whose convolutions span space and time,
pretrained on Kinetics. It scores 16-frame clips sampled at 10 fps of real
time, and an alert needs 2 of 3 consecutive clips ≥ 0.55. Test F1 0.96, AUC
0.99 on 344 videos.

**7. What changed between fight v1 and v2?**
v1 trained on every 2nd frame of videos recorded at 11–37 fps, so a training
clip covered 0.8–2.7 s, while live clips cover 1.6 s. v2 samples by real time
(10 fps), matching the live pipeline. It also adds a cosine LR schedule and
lighting augmentation. Recall rose from 0.78 to 0.97 at the same 10 false
alarms.

**8. Why the interaction check if the model is already accurate?**
On our own test camera the classifier, trained on other footage, scored
ordinary activity high (a domain gap). A fight is therefore CONFIRMED (with a
pop-up) only with track evidence: two distinct people, close (≤ 1.2 body
heights) for ≥ 1 s, moving in an agitated way. See `temporal/interaction.py`.
Without that evidence the fight is still reported, as "Possible fight —
please check" without a pop-up. As a hard veto the check lost a quarter of
real fights in the ablation (recall 0.73 → 0.48), so it became a review
signal (report section 6.8).

**9. How does fall detection work?**
YOLOv8-Pose gives 17 keypoints. From them and the box we compute 15 features
per frame (torso tilt, hip/head drop, velocities). A temporal CNN + BiGRU
scores 4-s windows. If the person is still down after 20 s, the incident
escalates to CRITICAL. F1 0.90, AUC 0.96, with 5-fold cross-validation grouped
by event.

**10. Why grouped cross-validation for falls?**
Files like `01.mp4` and `01 (2).mp4` show the same fall from different
cameras. If they were split across train and test, the test would contain
events seen in training. Grouping by event prevents that leakage. With only
48 events, cross-validation is more reliable than one split.

**11. What was the fall baseline?**
The original rule: aspect ratio flips, then 5 s of stillness. As deployed it
reached F1 0.11, because most clips end before 5 s of stillness. Even a
generous 1-s version reached 0.81. A Random Forest on 16 biomechanical
features also reached F1 0.90; it is kept as an alternative (`mode: model`).

**12. How do you avoid fire false alarms?**
Three stages:
1. YOLO must fire in 3 of 5 evaluated frames.
2. A static-region check: change inside the box must be ≥ 2× the scene
   median, which rejects posters, lamps and exposure changes.
3. A learned verifier (gradient boosting on 19 flicker, colour and texture
   features) must accept 2 windows.

On FIRESENSE fire: F1 0.87 → 0.95, false alarms 2 → 0.

**13. How does the unusual-activity detector work without labels?**
A denoising autoencoder (38→16→4→16→38, written in NumPy) learns to
reconstruct the motion features of *normal* 2-s windows: optical-flow speed,
direction and area, plus foreground shape. A window it cannot reconstruct is
unusual. F1 0.79 on 23 normal + 79 fall videos it never saw.

**14. Why calibrate the anomaly threshold per camera?**
The threshold from training footage was below the normal motion level of our
test room, which gave an "unusual activity" alert after every cooldown. Each
camera now observes for 5 minutes and uses the 99th percentile of its own
normal error, never below the model's own threshold.

**15. What is Grad-CAM and why use it?**
It weights the last convolutional block's channels by the gradient of the
"fight" score, giving a heatmap of where the model looked. We save 3 heatmaps
with every confirmed fight and show them in the incident view. That way a
reviewer can check that the model reacted to the people, not the background.

## Reliability and evaluation

**16. What do PROBABLE and CONFIRMED mean?**
Confirmation tiers. An event needs N positive windows out of the last M
(per type, in `config/thresholds.yaml`) to become PROBABLE, and more to
become CONFIRMED. Only CONFIRMED incidents go to the dashboard.

**17. How do you prevent duplicate incidents?**
`IncidentDeduper`: while an event is ongoing (same camera and event type),
repeats update the existing incident. A new incident needs 45–120
s of quiet. The backend also ignores a resent `incident_id`, so retries are
safe.

**18. How is the confidence value computed? Is it a probability?**
It comes from the detector, and each record stores `confidence_basis`
explaining how. For example, fight = mean R3D-18 probability over the
high-scoring clips; crowd = mean person-detector confidence of the group.
The anomaly value is a score (`ratio/(ratio+1)`), not a
probability, and it is labelled as such.

**19. Tell us about the false positives you found.**
Normal activity in the test room produced lingering, fight, smoke and anomaly
incidents. The causes were:
- ghost tracks kept 15 s after people left;
- made-up confidence formulas instead of detector outputs;
- a motion gate that paired one person's two track IDs;
- static look-alikes passing frame persistence;
- an anomaly threshold calibrated on another site.

Each has a fix and a regression test (18 scenarios in
`test_false_positives.py`).

**20. Have you measured false alarms per hour after the fix?**
Not yet: that needs a 10–15-minute normal recording from the camera. The
script `python -m evaluation.false_alarms --video <file>` is ready. It runs
the same video through the code before and after the fix and writes the
table into RESULTS.md.

**21. How did you make sure the reported numbers are real?**
`evaluation/run_all.py` reads only the metrics JSON saved at training time.
It checks precision and recall against the stored confusion counts, and it
fails if any metrics file is neither used nor explicitly excluded. Thresholds
were chosen on validation data, never on test data.

**22. How fast is it?**
On an RTX 3050 laptop GPU the pipeline takes 51.9 ms per frame and sustains
9.2 of the 10 target frames/s (capacity 19.3). YOLO is the largest stage at
19.8 ms. On CPU it reaches 6.1 frames/s.

## ERP, security, LLM

**23. What can the LLM change?**
Only the wording of the summary. It receives plain facts (location, event,
urgency, built-in description) and no scores. Its text is rejected if it
drops the location, uses jargon, or contains a number not in the facts, and
then the built-in description is used. It cannot change the type, severity
or confidence.

**24. What happens without an LLM key, a GPU, or the fight weights?**
- No LLM key: the built-in description is shown.
- No GPU: everything runs on the CPU, more slowly.
- Fight weights missing (a Git LFS pointer): only fight detection is
  disabled, with a message explaining how to fix it; the other detectors keep
  running.

**25. How is the API secured?**
- JWT access tokens plus refresh tokens stored server-side (HttpOnly cookie);
- bcrypt password hashes;
- role checks on every route;
- Zod validation of bodies, queries and parameters;
- Helmet headers and rate limiting;
- an audit log of every write.

**26. Who can see what in the incident evidence?**
Roles that can read security data (ADMIN, MANAGER, PRODUCTION) see
snapshots, clips and the plain explanation. Only ADMIN sees the confidence
basis and raw model output; the API leaves raw output out for other roles.

**27. How is evidence stored and shown?**
A 15-s full-resolution ring buffer. On confirmation it saves a 5-s
before-clip, 3 keyframes, and a 5-s after-clip under
`perception-service/output/evidence`. The backend joins them to the database
incident on `incidentNumber` (no schema change) and serves only the files
that belong to that incident.

**28. Why rule-based severity instead of a learned one?**
Severity is a policy decision. Rules are auditable, and some events have hard
caps; for example, an unsupervised anomaly can never exceed MEDIUM, because
the AI cannot say what it is. A human always makes the final call.

**29. How would you deploy this in a real factory?**
1. Calibrate the anomaly detector on normal footage.
2. Measure false alarms per camera-hour.
3. Fine-tune the fight and fall models on site footage.
4. Run the backend with PM2 behind Nginx with TLS, with daily database
   backups (templates in `ops/`).

**30. What are the main limitations?**
- Domain gap: trained on public datasets, not on our cameras.
- False alarms per hour not yet measured on site.
- Small fire and smoke test sets.
- The anomaly detector is silent for 5 minutes while it calibrates.
- The single-process SSE bus means several backend workers need a shared bus.
