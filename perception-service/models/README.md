# Model checkpoints

The trained models used by the live pipeline (`config/thresholds.yaml`):

| File | Used for |
|---|---|
| `fight_r3d18_v2.pt` | Fight detection (R3D-18 video classifier). Stored with Git LFS: run `git lfs pull`. |
| `fall_gru_v1.pt` | Fall detection (pose + BiGRU) |
| `fall_rf_v1.joblib` | Fall detection backup, used only if `fall_gru_v1.pt` is missing |
| `fire_smoke_yolov8n_v1.pt` | Fire / smoke detection (fine-tuned YOLOv8n) |
| `fire_smoke_verifier_v1.pkl` | Fire / smoke look-alike verifier |
| `scene_anomaly_ae_v2.npz` | Unusual-activity autoencoder |
| `scene_anomaly_ae_v3_factory.npz` | Unusual-activity autoencoder trained on the factory's own footage (`anomaly/train_factory.py`). Not live yet: see `docs/RESULTS.md` section 7. |

`fight_r3d18_v1.pt` and `scene_anomaly_ae_v1.npz` are the earlier versions kept
for the baseline comparisons in `docs/RESULTS.md`. The `*.metrics.json` files
hold the evaluation results that `evaluation/run_all.py` turns into the results
table.
