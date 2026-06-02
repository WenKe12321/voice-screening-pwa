#!/usr/bin/env python3
"""Optional GRU/BiLSTM research comparison for extracted EATD features.

Install training/requirements-deep.txt inside the isolated F: drive virtual
environment before running. This model is deliberately not exported to the PWA.
"""

from __future__ import annotations

import argparse
import csv
import json
import random
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

try:
    import torch
    from torch import nn
except ImportError as error:
    raise SystemExit("PyTorch is optional and not installed. Install training/requirements-deep.txt first.") from error

from sklearn.metrics import average_precision_score, balanced_accuracy_score, confusion_matrix, f1_score, recall_score, roc_auc_score

TASKS = ("eatd-positive", "eatd-neutral", "eatd-negative")
BASE_FEATURES = (
    "durationSeconds", "activeVoiceRatio", "pauseRatio", "rmsMean", "rmsStdDev",
    "zeroCrossingRate", "pitchMedianHz", "pitchRangeHz", "spectralCentroidHz",
    "speechRateProxy", *(f"mfccMean.{index}" for index in range(8)),
)


class GruBiLstmClassifier(nn.Module):
    def __init__(self, input_size: int, hidden_size: int = 32) -> None:
        super().__init__()
        self.gru = nn.GRU(input_size, hidden_size, batch_first=True, bidirectional=True)
        self.lstm = nn.LSTM(hidden_size * 2, hidden_size, batch_first=True, bidirectional=True)
        self.output = nn.Linear(hidden_size * 2, 1)

    def forward(self, values: torch.Tensor) -> torch.Tensor:
        values, _ = self.gru(values)
        values, _ = self.lstm(values)
        return self.output(values[:, -1]).squeeze(1)


def read_features(path: Path) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
    with path.open(encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    selected = {}
    for split in ("train", "validation"):
        split_rows = [row for row in rows if row["split"] == split]
        values = [[[float(row[f"{task}.{feature}"]) for feature in BASE_FEATURES] for task in TASKS] for row in split_rows]
        labels = [float(row["label"]) for row in split_rows]
        selected[split] = (torch.tensor(values, dtype=torch.float32), torch.tensor(labels, dtype=torch.float32))
    return *selected["train"], *selected["validation"]


def metrics(labels: np.ndarray, probability: np.ndarray) -> dict[str, object]:
    prediction = (probability >= 0.5).astype(int)
    tn, fp, fn, tp = confusion_matrix(labels, prediction, labels=[0, 1]).ravel()
    return {
        "rocAuc": round(float(roc_auc_score(labels, probability)), 4),
        "prAuc": round(float(average_precision_score(labels, probability)), 4),
        "recall": round(float(recall_score(labels, prediction, zero_division=0)), 4),
        "specificity": round(float(tn / max(tn + fp, 1)), 4),
        "f1": round(float(f1_score(labels, prediction, zero_division=0)), 4),
        "balancedAccuracy": round(float(balanced_accuracy_score(labels, prediction)), 4),
        "confusionMatrix": {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)},
    }


def synthetic() -> tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
    values = torch.randn(18, 3, len(BASE_FEATURES))
    labels = (values[:, :, 2].mean(dim=1) > 0).float()
    return values[:12], labels[:12], values[12:], labels[12:]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--smoke", action="store_true", help="Run a one-epoch synthetic architecture check")
    parser.add_argument("--epochs", type=int, default=40)
    parser.add_argument("--features", type=Path, default=Path(r"F:\Datasets\voice-screening\processed\eatd-features.local.csv"))
    parser.add_argument("--output", type=Path)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    if args.output is None:
        args.output = Path(r"F:\Datasets\voice-screening\artifacts\deep-reference-smoke.local.pt" if args.smoke else r"F:\Datasets\voice-screening\artifacts\deep-reference.local.pt")
    if args.report is None:
        args.report = Path(r"F:\Datasets\voice-screening\reports\deep-reference-smoke.local.json" if args.smoke else r"F:\Datasets\voice-screening\reports\deep-reference-summary.local.json")
    random.seed(20260601)
    np.random.seed(20260601)
    torch.manual_seed(20260601)
    train_x, train_y, validation_x, validation_y = synthetic() if args.smoke else read_features(args.features)
    mean = train_x.mean(dim=(0, 1), keepdim=True)
    scale = train_x.std(dim=(0, 1), keepdim=True).clamp_min(1e-6)
    train_x, validation_x = (train_x - mean) / scale, (validation_x - mean) / scale
    epochs = 1 if args.smoke else args.epochs
    model = GruBiLstmClassifier(input_size=len(BASE_FEATURES))
    optimizer = torch.optim.Adam(model.parameters(), lr=1e-3)
    criterion = nn.BCEWithLogitsLoss()
    best, stale = float("inf"), 0
    for epoch in range(epochs):
        model.train()
        optimizer.zero_grad()
        loss = criterion(model(train_x), train_y)
        loss.backward()
        optimizer.step()
        model.eval()
        with torch.no_grad():
            validation_loss = float(criterion(model(validation_x), validation_y))
        print(f"epoch={epoch + 1} train_loss={float(loss.detach()):.6f} validation_loss={validation_loss:.6f}")
        if validation_loss < best - 1e-5:
            best, stale = validation_loss, 0
            args.output.parent.mkdir(parents=True, exist_ok=True)
            torch.save(model.state_dict(), args.output)
        else:
            stale += 1
            if stale >= 5:
                print("early stopping")
                break
    model.load_state_dict(torch.load(args.output, weights_only=True))
    model.eval()
    with torch.no_grad():
        probability = torch.sigmoid(model(validation_x)).numpy()
    report = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "smokeOnly": args.smoke,
        "model": "GRU/BiLSTM extracted-feature research comparison",
        "validation": metrics(validation_y.numpy().astype(int), probability),
        "note": "Offline research comparison only. This artifact is never exported to the PWA.",
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
