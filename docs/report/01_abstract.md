# Abstract

Manufacturing plants record CCTV continuously, but the footage is rarely
watched as it is recorded, so fights, falls and fires are often noticed late. Plant data
(workforce, inventory, orders, production) usually lives in a separate system
from security, so incidents are not linked to operations.

This project builds **DVS Industries**, a web-based ERP with an integrated
**multi-model CCTV safety AI**. The ERP (Node.js/Express, PostgreSQL via Prisma,
React) covers workforce, inventory, orders, production, reporting, audit and a
Smart Analytics module. The perception service (Python) reads a camera or a
video file at 10 frames per second. It detects and tracks people with YOLOv8n
and ByteTrack, then passes the tracks and frames to task-specific models:

- an R3D-18 3D convolutional network for fights, with a track-based
  interaction check;
- a YOLOv8-Pose skeleton sequence model (temporal CNN + BiGRU) for falls;
- a fine-tuned YOLOv8n with a learned verifier for fire and smoke;
- an unsupervised optical-flow autoencoder for unusual activity;
- geometric rules for loitering, intrusion and crowding.

An event-confirmation stage (N-of-M persistence with PROBABLE and CONFIRMED
tiers), rule-based severity and de-duplication turn detections into one
incident per event. Confirmed incidents are posted to the ERP and pushed to every open browser over
Server-Sent Events, with a priority pop-up. They include evidence (keyframes,
before/after clips, Grad-CAM heatmaps for fights) and a plain-language summary.
An LLM may write the summary, but it is validated so that it cannot add
facts, and a built-in description is used when no LLM is available.

On held-out data the deployed models reach:

- **fight:** F1 0.96 (344 test videos);
- **fall:** F1 0.90 (160 videos, grouped cross-validation);
- **fire:** F1 0.95 with zero false alarms on 27 FIRESENSE videos;
- **smoke:** F1 0.92;
- **unusual activity:** F1 0.79, without any labelled incident in training.

Each model is compared with a simpler baseline. The fight model improves on
its first version (F1 0.85), the fall model on the box rule it replaced (F1
0.81 even in a generous version), and the fire verifier on YOLO alone (F1 0.87,
2 false alarms). On a laptop RTX 3050 GPU the full pipeline sustains 9.2 of the
10 target frames per second, with capacity for 19.3. False alarms seen on a
real test camera were traced to five root causes and fixed. A false-alarms-per-hour
measurement on the deployment camera is still outstanding; an ablation on held-out
and public clips is reported in chapter 6.8.
