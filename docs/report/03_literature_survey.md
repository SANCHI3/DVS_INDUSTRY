# 2. Literature survey

The table lists the approaches the system builds on and how each is used.
Check every reference against Google Scholar or the publisher before citing
it. Entries marked **[verify]** are ones where the venue, year or exact title
should be checked.

| # | Work | Approach | Relevance to this project |
|---|---|---|---|
| 1 | J. Redmon, S. Divvala, R. Girshick, A. Farhadi, "You Only Look Once: Unified, Real-Time Object Detection," *CVPR*, 2016. | Single-stage CNN detector: one network predicts boxes and classes in one pass. | Basis of the YOLO family. The project uses Ultralytics **YOLOv8n** for people/objects and a fine-tuned YOLOv8n for fire/smoke. |
| 2 | G. Jocher, A. Chaurasia, J. Qiu, *Ultralytics YOLOv8*, software, 2023. https://github.com/ultralytics/ultralytics | Anchor-free YOLO with detection and pose-estimation heads. | `yolov8n.pt` (people), `yolov8n-pose.pt` (17-keypoint skeletons for fall detection), fine-tuning for fire/smoke. |
| 3 | Y. Zhang et al., "ByteTrack: Multi-Object Tracking by Associating Every Detection Box," *ECCV*, 2022. | Tracking-by-detection that also associates low-confidence boxes, reducing ID switches under occlusion. | Gives each person a stable track ID (via the `supervision` library), which the rules, the fight interaction check and the fall model need. |
| 4 | D. Tran, H. Wang, L. Torresani, J. Ray, Y. LeCun, M. Paluri, "A Closer Look at Spatiotemporal Convolutions for Action Recognition," *CVPR*, 2018. | 3D ResNets (R3D) and (2+1)D factorised convolutions for video classification. | The fight classifier is **R3D-18** (torchvision implementation of this work), pretrained on Kinetics and fine-tuned on fight/non-fight clips. |
| 5 | W. Kay et al., "The Kinetics Human Action Video Dataset," arXiv:1705.06950, 2017. | Large-scale human action dataset. | Source of the pretrained R3D-18 weights (transfer learning for the small fight dataset). |
| 6 | M. Cheng, K. Cai, M. Li, "RWF-2000: An Open Large Scale Video Database for Violence Detection," *ICPR*, 2021. **[verify year: arXiv 2019, ICPR 2020 published 2021]** | 2,000 real-world surveillance clips; 3D-CNN/flow baselines. | Shows violence detection works best with spatio-temporal models on surveillance footage; motivates clip-level classification over per-frame detection. |
| 7 | Ş. Aktı, G. A. Tataroğlu, H. K. Ekenel, "Vision-based Fight Detection from Surveillance Cameras," *IPTA*, 2019. | Surveillance Camera Fight Dataset (300 clips) with CNN+LSTM baselines. | Fight training data. **[verify]** The `fi###`/`nofi###` clips in the training set match this dataset's naming. Together with `V_`/`NV_` clips that match the Kaggle "Real Life Violence Situations" dataset **[verify]**, they make up the 2,300 fight/non-fight videos. |
| 8 | R. R. Selvaraju et al., "Grad-CAM: Visual Explanations from Deep Networks via Gradient-based Localization," *ICCV*, 2017. | Class-specific heatmaps from gradients of the last convolutional layer. | Implemented for the 3D fight network (`explain/gradcam.py`); 3 heatmaps are saved with every confirmed fight and shown in the dashboard. |
| 9 | M. Hasan, J. Choi, J. Neumann, A. K. Roy-Chowdhury, L. S. Davis, "Learning Temporal Regularity in Video Sequences," *CVPR*, 2016. | Autoencoder trained on normal video; high reconstruction error marks anomalies. | Same principle as the unsupervised unusual-activity detector, which uses a compact denoising autoencoder on 38 hand-crafted motion features instead of raw frames. |
| 10 | W. Sultani, C. Chen, M. Shah, "Real-world Anomaly Detection in Surveillance Videos," *CVPR*, 2018. | UCF-Crime dataset; weakly supervised multiple-instance ranking. | Context for anomaly detection in CCTV; shows the difficulty and the false-alarm problem that motivated per-camera calibration here. |
| 11 | T. Çelik, H. Demirel, "Fire detection in video sequences using a generic color model," *Fire Safety Journal*, vol. 44, no. 2, 2009. | YCbCr colour rules for flame pixels. | Used (with Chen et al., ICIP 2004) in the training-free fire verifier (`temporal/fire_verifier.py`). |
| 12 | K. Dimitropoulos, P. Barmpoutis, N. Grammalidis, "Spatio-Temporal Flame Modeling and Dynamic Texture Analysis for Video-Based Fire Detection," *IEEE Trans. Circuits Syst. Video Technol.*, 2015. **[verify]** | Flame flicker and dynamic texture features. The FIRESENSE video set comes from the same group. | Fire evaluation videos (FIRESENSE); flicker/dynamics idea behind the learned verifier and the static-region check. |
| 13 | D. Maji, S. Nagori, M. Mathew, D. Poddar, "YOLO-Pose: Enhancing YOLO for Multi Person Pose Estimation Using Object Keypoint Similarity Loss," *CVPR Workshops*, 2022. | Single-stage multi-person pose estimation in a YOLO detector. | Pose approach used by `yolov8n-pose.pt`; skeleton features (torso tilt, hip/head drop) feed the fall model. |
| 14 | K. Cho et al., "Learning Phrase Representations using RNN Encoder–Decoder for Statistical Machine Translation," *EMNLP*, 2014. | Gated Recurrent Unit (GRU). | The fall model is a temporal CNN followed by a bidirectional GRU over 4-second pose sequences. |

## Summary of the gap

Most published work studies one incident type on curated datasets. Deployed
systems must also:

- combine several incident types on the same stream;
- confirm detections over time before alerting;
- suppress duplicates;
- explain alerts to people who are not technical;
- connect incidents to operational records.

This project combines established models (rows 1–5, 13–14) with temporal
confirmation, verification stages, unsupervised anomaly detection (row 9),
explainability (row 8) and an ERP. It evaluates each model against a simpler
baseline (chapter 7).
