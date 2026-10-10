from __future__ import annotations

import argparse
import json
import random
import time
from pathlib import Path

import numpy as np
import torch
from torch import nn
from torch.utils.data import DataLoader

try:
    from .dataset import RgbFightDataset, load_manifest
    from .model import build_r3d18, set_backbone_trainable
except ImportError:
    from dataset import RgbFightDataset, load_manifest
    from model import build_r3d18, set_backbone_trainable


def metrics(labels, scores, threshold):
    pred, truth = scores >= threshold, labels == 1
    tp = int(np.sum(pred & truth)); fp = int(np.sum(pred & ~truth))
    fn = int(np.sum(~pred & truth)); tn = int(np.sum(~pred & ~truth))
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {"threshold": float(threshold), "precision": precision, "recall": recall,
            "f1": f1, "tp": tp, "fp": fp, "fn": fn, "tn": tn}


def roc_auc(labels, scores) -> float:
    """Threshold-free ranking quality (Mann-Whitney U), robust to class balance."""
    pos, neg = scores[labels == 1], scores[labels == 0]
    if len(pos) == 0 or len(neg) == 0:
        return float("nan")
    order = np.argsort(np.concatenate([pos, neg]), kind="mergesort")
    ranks = np.empty(len(order)); ranks[order] = np.arange(1, len(order) + 1)
    # average ranks for ties
    combined = np.concatenate([pos, neg])
    for value in np.unique(combined):
        tied = combined == value
        ranks[tied] = ranks[tied].mean()
    return float((ranks[:len(pos)].sum() - len(pos) * (len(pos) + 1) / 2) / (len(pos) * len(neg)))


def choose_threshold(labels, scores, min_precision):
    candidates = [metrics(labels, scores, t) for t in np.linspace(0.05, 0.95, 181)]
    feasible = [m for m in candidates if m["precision"] >= min_precision and m["tp"] + m["fp"]]
    if feasible:
        return max(feasible, key=lambda m: (m["recall"], m["f1"], m["precision"], m["threshold"]))
    return max(candidates, key=lambda m: (m["f1"], m["precision"]))


def evaluate(model, loader, device):
    """Video-level scores. Batches may carry several clips per video
    ([B, K, C, T, H, W]); their probabilities are averaged."""
    model.eval(); labels = []; scores = []
    with torch.inference_mode():
        for clips, targets, _ in loader:
            clips = clips.to(device, non_blocking=True)
            if clips.dim() == 6:
                batch, k = clips.shape[:2]
                probs = torch.sigmoid(model(clips.flatten(0, 1)).flatten()).view(batch, k).mean(1)
            else:
                probs = torch.sigmoid(model(clips).flatten())
            scores.extend(probs.cpu().numpy().tolist())
            labels.extend(targets.numpy().astype(int).tolist())
    return np.asarray(labels), np.asarray(scores)


def main():
    parser = argparse.ArgumentParser(description="Fine-tune R3D-18 for fight detection")
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--data-root", default=None,
                        help="folder with fight/ and not_fight/, used if manifest paths moved")
    parser.add_argument("--output", default="models/fight_r3d18_v2.pt")
    parser.add_argument("--epochs", type=int, default=15)
    parser.add_argument("--batch-size", type=int, default=2)
    parser.add_argument("--workers", type=int, default=2)
    parser.add_argument("--lr", type=float, default=1e-4)
    parser.add_argument("--patience", type=int, default=5)
    parser.add_argument("--freeze-backbone-epochs", type=int, default=2)
    parser.add_argument("--clip-frames", type=int, default=16)
    parser.add_argument("--clip-fps", type=float, default=10.0,
                        help="sample clips at this real-time rate; should equal the live "
                             "pipeline's detection_fps. 0 = legacy fixed --temporal-stride")
    parser.add_argument("--temporal-stride", type=int, default=2)
    parser.add_argument("--eval-clips", type=int, default=3,
                        help="clips averaged per video for validation/test scoring")
    parser.add_argument("--image-size", type=int, default=112)
    parser.add_argument("--min-validation-precision", type=float, default=0.85)
    parser.add_argument("--no-pretrained", action="store_true")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    random.seed(args.seed); np.random.seed(args.seed); torch.manual_seed(args.seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    clip_fps = args.clip_fps or None
    records = load_manifest(args.manifest, args.data_root)
    common = dict(clip_frames=args.clip_frames, temporal_stride=args.temporal_stride,
                  size=args.image_size, clip_fps=clip_fps)
    train_ds = RgbFightDataset(records, "train", **common)
    val_ds = RgbFightDataset(records, "val", eval_clips=args.eval_clips, **common)
    test_ds = RgbFightDataset(records, "test", eval_clips=args.eval_clips, **common)
    loader_kw = dict(num_workers=args.workers, pin_memory=device.type == "cuda")
    # Only the training loader keeps its workers alive between epochs; persistent
    # workers on every loader multiplies torch worker processes and exhausts RAM.
    train_loader = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True,
                              persistent_workers=args.workers > 0, **loader_kw)
    val_loader = DataLoader(val_ds, batch_size=args.batch_size, shuffle=False, **loader_kw)
    test_loader = DataLoader(test_ds, batch_size=args.batch_size, shuffle=False, **loader_kw)

    model = build_r3d18(pretrained=not args.no_pretrained).to(device)
    set_backbone_trainable(model, args.freeze_backbone_epochs == 0)
    positives = sum(r.label for r in train_ds.records)
    negatives = len(train_ds.records) - positives
    loss_fn = nn.BCEWithLogitsLoss(pos_weight=torch.tensor([negatives / max(positives, 1)], device=device))

    def make_optimizer(lr):
        optimizer = torch.optim.AdamW(filter(lambda p: p.requires_grad, model.parameters()),
                                      lr=lr, weight_decay=1e-4)
        # Cosine decay over the remaining epochs (stepped once per epoch)
        remaining = max(1, args.epochs - (epoch - 1))
        scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=remaining,
                                                               eta_min=lr * 0.05)
        return optimizer, scheduler

    epoch = 1
    optimizer, scheduler = make_optimizer(args.lr)
    amp = device.type == "cuda"
    scaler = torch.amp.GradScaler("cuda", enabled=amp)
    output = Path(args.output); output.parent.mkdir(parents=True, exist_ok=True)
    best_key, stale, history = None, 0, []

    for epoch in range(1, args.epochs + 1):
        if epoch == args.freeze_backbone_epochs + 1 and args.freeze_backbone_epochs > 0:
            set_backbone_trainable(model, True)
            optimizer, scheduler = make_optimizer(args.lr * 0.25)
        started = time.time()
        model.train(); losses = []
        for step, (clips, targets, _) in enumerate(train_loader, 1):
            if step % 100 == 0:
                print(json.dumps({"epoch": epoch, "step": step, "of": len(train_loader),
                                  "loss": float(np.mean(losses[-100:]))}), flush=True)
            clips = clips.to(device, non_blocking=True)
            targets = targets.to(device, non_blocking=True)
            optimizer.zero_grad(set_to_none=True)
            with torch.autocast(device_type=device.type, enabled=amp):
                logits = model(clips).flatten()
                loss = loss_fn(logits, targets)
            scaler.scale(loss).backward()
            scaler.unscale_(optimizer)
            nn.utils.clip_grad_norm_(model.parameters(), 5.0)
            scaler.step(optimizer); scaler.update()
            losses.append(float(loss.item()))
        scheduler.step()

        labels, scores = evaluate(model, val_loader, device)
        selected = choose_threshold(labels, scores, args.min_validation_precision)
        auc = roc_auc(labels, scores)
        row = {"epoch": epoch, "train_loss": float(np.mean(losses)), "val_auc": auc,
               "lr": optimizer.param_groups[0]["lr"], "seconds": round(time.time() - started, 1),
               **selected}
        history.append(row); print(json.dumps(row), flush=True)
        # Select on F1 at the precision floor; AUC breaks ties and rescues the
        # early frozen-backbone epochs where F1 is degenerate.
        key = (round(selected["f1"], 4), auc)
        if best_key is None or key > best_key:
            best_key, stale = key, 0
            torch.save({"state_dict": model.state_dict(), "threshold": selected["threshold"],
                        "validation_metrics": {**selected, "auc": auc},
                        "clip_frames": args.clip_frames,
                        "clip_fps": clip_fps,
                        "temporal_stride": args.temporal_stride, "image_size": args.image_size,
                        "eval_clips": args.eval_clips,
                        "manifest": str(Path(args.manifest).resolve())}, output)
        else:
            stale += 1
            if stale >= args.patience:
                print("early stopping", flush=True)
                break

    checkpoint = torch.load(output, map_location=device, weights_only=False)
    model.load_state_dict(checkpoint["state_dict"])
    test_labels, test_scores = evaluate(model, test_loader, device)
    test_result = {**metrics(test_labels, test_scores, checkpoint["threshold"]),
                   "auc": roc_auc(test_labels, test_scores)}
    report = {"device": str(device), "config": vars(args),
              "best_validation": checkpoint["validation_metrics"],
              "test": test_result, "history": history}
    report_path = output.with_suffix(".metrics.json")
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"checkpoint": str(output), "metrics": str(report_path), **test_result}, indent=2))


if __name__ == "__main__":
    main()
