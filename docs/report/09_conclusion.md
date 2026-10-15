# 8. Conclusion

The project delivers a working ERP for a manufacturing plant with an
integrated, multi-model CCTV safety AI. Operational modules (workforce,
inventory, orders, production, reports, audit, analytics) and security share
one database, one role-based API and one dashboard.

The main technical lesson is that a single object detector is not enough for
safety monitoring. YOLO finds and tracks people well, but each incident type
needs a model that matches how it shows up:

- fights are spatio-temporal: an R3D-18 3D CNN, F1 0.96;
- falls are fast changes of body pose: a pose-sequence BiGRU, F1 0.90;
- fire look-alikes are static, real fire flickers: a YOLO detector plus a
  dynamics check and a learned verifier, F1 0.95 with zero false alarms on
  the test videos;
- unlabelled events differ from normal motion: an unsupervised autoencoder,
  F1 0.79.

Each model is evaluated on held-out videos and beats the simpler baseline it
replaced or was compared with.

Equally important are the stages around the models:

- temporal confirmation, severity rules with hard caps, and de-duplication,
  so that one real event gives one incident;
- evidence and explanations (keyframes, clips, Grad-CAM, plain-language
  reasons and the basis of every confidence value);
- a validated LLM summary that cannot add facts;
- real-time delivery to every open dashboard.

When false alarms appeared on a real camera, they were traced to concrete
causes (ghost tracks, made-up confidence formulas, a threshold calibrated on
another site) and fixed with regression tests.

The system runs end to end, including on a laptop without a camera (demo
mode). Its main open points are adapting the models to the target cameras and
measuring false alarms per hour on site; the tooling for both is in place.
