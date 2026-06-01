#!/usr/bin/env python3
r"""Offline research pipeline for acoustic depression-screening experiments.

This script never uploads data. Raw datasets, weights, and per-subject
predictions belong outside the Git repository under F:\Datasets\voice-screening.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import random
import re
import statistics
import wave
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

import numpy as np
from scipy.io import wavfile
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    average_precision_score,
    balanced_accuracy_score,
    brier_score_loss,
    confusion_matrix,
    f1_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import GridSearchCV, StratifiedKFold, cross_val_predict
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC

WORKSPACE_DEFAULT = Path(r"F:\Datasets\voice-screening")
EXTRACTOR_VERSION = "browser-acoustic-features/1.0.0"
EATD_TASKS = ("eatd-positive", "eatd-neutral", "eatd-negative")
EATD_FILES = ("positive_out.wav", "neutral_out.wav", "negative_out.wav")
SDS_THRESHOLD = 53.0
ACTIVATION_ROC_AUC = 0.70
ACTIVATION_RECALL = 0.70
BASE_FEATURES = (
    "durationSeconds",
    "activeVoiceRatio",
    "pauseRatio",
    "rmsMean",
    "rmsStdDev",
    "zeroCrossingRate",
    "pitchMedianHz",
    "pitchRangeHz",
    "spectralCentroidHz",
    "speechRateProxy",
    "mfccMean.0",
    "mfccMean.1",
    "mfccMean.2",
    "mfccMean.3",
    "mfccMean.4",
    "mfccMean.5",
    "mfccMean.6",
    "mfccMean.7",
)
FEATURE_ORDER = tuple(f"{task}.{feature}" for task in EATD_TASKS for feature in BASE_FEATURES)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def init_workspace(root: Path) -> None:
    for name in ("raw/eatd", "raw/androids", "raw/modma", "processed", "artifacts", "reports", "manifests"):
        (root / name).mkdir(parents=True, exist_ok=True)
    manifest = root / "manifests" / "datasets.local.json"
    if not manifest.exists():
        write_json(manifest, {
            "schemaVersion": 1,
            "createdAt": utc_now(),
            "datasets": {
                "eatd": {
                    "source": "https://github.com/speechandlanguageprocessing/ICASSP2022-Depression",
                    "download": "password-protected OneDrive link in the author README",
                    "status": "awaiting-manual-download",
                    "redistribution": "not-assumed",
                },
                "androids": {
                    "source": "https://github.com/androidscorpus/data",
                    "status": "download-after-eatd-baseline",
                    "redistribution": "prohibited",
                },
                "modma": {
                    "source": "https://modma.lzu.edu.cn/data/application/",
                    "status": "awaiting-signed-eula",
                    "requested": ["Speech Signal", "Age", "Sex", "PHQ-9", "HAMD", "MINI"],
                    "redistribution": "prohibited",
                },
            },
        })
    print(f"Workspace ready: {root}")


def discover_eatd_subjects(dataset: Path, split: str) -> list[Path]:
    candidates = [dataset / split, dataset / split.capitalize(), dataset / f"{split}_set", dataset / f"{split}ing"]
    for candidate in candidates:
        if candidate.is_dir():
            return sorted(path for path in candidate.iterdir() if path.is_dir())
    prefix = "t_" if split == "train" else "v_"
    original_layout = sorted(path for path in dataset.glob(f"{prefix}*") if path.is_dir())
    if original_layout:
        return original_layout
    raise ValueError(f"Missing EATD {split} subjects below {dataset}")


def parse_score(path: Path) -> float:
    try:
        return float(path.read_text(encoding="utf-8-sig").strip())
    except (OSError, ValueError) as error:
        raise ValueError(f"Invalid SDS score: {path}") from error


@dataclass
class EatdSubject:
    subject_id: str
    split: str
    sds_score: float
    label: int
    directory: Path


def validate_eatd(dataset: Path) -> list[EatdSubject]:
    subjects: list[EatdSubject] = []
    seen: set[str] = set()
    for split in ("train", "validation"):
        directories = discover_eatd_subjects(dataset, split)
        if not directories:
            raise ValueError(f"No EATD {split} subject directories found below {dataset}")
        for directory in directories:
            subject_id = f"{split}:{directory.name}"
            if subject_id in seen:
                raise ValueError(f"Duplicate EATD subject id: {subject_id}")
            seen.add(subject_id)
            missing = [name for name in (*EATD_FILES, "new_label.txt") if not (directory / name).is_file()]
            if missing:
                raise ValueError(f"{subject_id} is missing: {', '.join(missing)}")
            score = parse_score(directory / "new_label.txt")
            if not 0 <= score <= 100:
                raise ValueError(f"{subject_id} SDS score is outside 0..100: {score}")
            subjects.append(EatdSubject(subject_id, split, score, int(score >= SDS_THRESHOLD), directory))
    train_names = {subject.subject_id.split(":", 1)[1] for subject in subjects if subject.split == "train"}
    validation_names = {subject.subject_id.split(":", 1)[1] for subject in subjects if subject.split == "validation"}
    overlap = sorted(train_names & validation_names)
    if overlap:
        raise ValueError(f"Subject leakage across EATD splits: {', '.join(overlap[:5])}")
    print(f"EATD valid: {len(subjects)} subjects")
    return subjects


def as_float_mono(path: Path) -> tuple[np.ndarray, int]:
    sample_rate, samples = wavfile.read(path)
    if samples.ndim > 1:
        samples = samples.mean(axis=1)
    if np.issubdtype(samples.dtype, np.integer):
        limit = max(abs(np.iinfo(samples.dtype).min), np.iinfo(samples.dtype).max)
        samples = samples.astype(np.float64) / limit
    else:
        samples = samples.astype(np.float64)
    if not len(samples) or sample_rate <= 0:
        raise ValueError(f"Empty audio file: {path}")
    return samples, int(sample_rate)


def load_eatd_audio(directory: Path, preferred_filename: str) -> tuple[np.ndarray, int, str]:
    preferred = directory / preferred_filename
    try:
        samples, sample_rate = as_float_mono(preferred)
        return samples, sample_rate, preferred_filename
    except ValueError as error:
        if "Empty audio file" not in str(error) or not preferred_filename.endswith("_out.wav"):
            raise
        fallback_filename = preferred_filename.replace("_out.wav", ".wav")
        samples, sample_rate = as_float_mono(directory / fallback_filename)
        return samples, sample_rate, fallback_filename


def median(values: Iterable[float]) -> float:
    values = list(values)
    return float(statistics.median(values)) if values else 0.0


def estimate_pitch(frame: np.ndarray, sample_rate: int) -> float:
    min_lag = sample_rate // 350
    max_lag = min(sample_rate // 70, len(frame) - 1)
    best_lag, best_correlation = 0, 0.0
    for lag in range(min_lag, max_lag + 1):
        correlation = float(np.dot(frame[: len(frame) - lag : 2], frame[lag::2]))
        if correlation > best_correlation:
            best_lag, best_correlation = lag, correlation
    return sample_rate / best_lag if best_lag and best_correlation > 0.01 else 0.0


def spectral_summary(frame: np.ndarray, sample_rate: int) -> tuple[float, list[float]]:
    fft_size, bins = min(256, len(frame)), 24
    frame = frame[:fft_size]
    magnitudes = np.abs(np.fft.fft(frame))[: fft_size // 2]
    magnitude_sum = float(magnitudes.sum()) or 1.0
    centroid = sum(float(value) * index * sample_rate / fft_size for index, value in enumerate(magnitudes)) / magnitude_sum
    band_size = math.ceil(len(magnitudes) / bins)
    log_bands = []
    for index in range(bins):
        band = magnitudes[index * band_size : (index + 1) * band_size]
        log_bands.append(math.log(float(np.square(band).sum()) + 1e-8))
    mfcc = [sum(value * math.cos(math.pi * coefficient * (index + 0.5) / bins) for index, value in enumerate(log_bands)) for coefficient in range(8)]
    return centroid, mfcc


def round_to(value: float, digits: int = 4) -> float:
    return round(float(value), digits)


def analyze_samples(samples: np.ndarray, sample_rate: int) -> dict[str, object]:
    frame_size = min(1024, len(samples))
    hop = max(256, frame_size // 2)
    frames = [samples[offset : offset + frame_size] for offset in range(0, len(samples) - frame_size + 1, hop)]
    if not frames:
        frames = [samples]
    stride = max(1, math.ceil(len(frames) / 100))
    sampled = frames[::stride]
    rms = [math.sqrt(float(np.square(frame).mean())) for frame in sampled]
    floor = max(0.006, median(rms) * 0.35)
    active = [frame for frame, value in zip(sampled, rms) if value > floor]
    pitches = [value for frame in active if (value := estimate_pitch(frame, sample_rate))]
    spectra = [spectral_summary(frame, sample_rate) for frame in active[:36]]
    zcr = [float(np.not_equal(frame[:-1] >= 0, frame[1:] >= 0).sum()) / len(frame) for frame in sampled]
    duration = len(samples) / sample_rate
    mfcc = [statistics.fmean(summary[1][index] for summary in spectra) if spectra else 0.0 for index in range(8)]
    return {
        "durationSeconds": round_to(duration, 2),
        "activeVoiceRatio": round_to(len(active) / len(sampled)),
        "pauseRatio": round_to(1 - len(active) / len(sampled)),
        "rmsMean": round_to(statistics.fmean(rms)),
        "rmsStdDev": round_to(statistics.pstdev(rms) if len(rms) > 1 else 0.0),
        "zeroCrossingRate": round_to(statistics.fmean(zcr)),
        "pitchMedianHz": round_to(median(pitches), 1),
        "pitchRangeHz": round_to(max(pitches) - min(pitches) if pitches else 0.0, 1),
        "spectralCentroidHz": round_to(statistics.fmean(summary[0] for summary in spectra) if spectra else 0.0, 1),
        "speechRateProxy": round_to(len(active) / max(duration, 0.1), 2),
        "mfccMean": [round_to(value, 3) for value in mfcc],
    }


def flatten_features(tasks: dict[str, dict[str, object]]) -> list[float]:
    values: list[float] = []
    for task in EATD_TASKS:
        features = tasks[task]
        for feature in BASE_FEATURES:
            if feature.startswith("mfccMean."):
                values.append(float(features["mfccMean"][int(feature.rsplit(".", 1)[1])]))
            else:
                values.append(float(features[feature]))
    return values


def extract_eatd(dataset: Path, output: Path) -> None:
    rows = []
    fallbacks = []
    for subject in validate_eatd(dataset):
        tasks = {}
        for task, filename in zip(EATD_TASKS, EATD_FILES):
            samples, sample_rate, source_filename = load_eatd_audio(subject.directory, filename)
            if source_filename != filename:
                fallbacks.append({"subjectId": subject.subject_id, "preferred": filename, "used": source_filename})
            tasks[task] = analyze_samples(samples, sample_rate)
        rows.append({
            "subjectId": subject.subject_id,
            "split": subject.split,
            "sdsScore": subject.sds_score,
            "label": subject.label,
            **{feature: value for feature, value in zip(FEATURE_ORDER, flatten_features(tasks))},
        })
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=["subjectId", "split", "sdsScore", "label", *FEATURE_ORDER])
        writer.writeheader()
        writer.writerows(rows)
    write_json(output.with_suffix(".fallbacks.local.json"), fallbacks)
    print(f"Extracted EATD features: {output}")
    print(f"Raw-audio fallbacks: {len(fallbacks)}")


def load_feature_csv(path: Path) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, list[str], list[str]]:
    with path.open(encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    if not rows:
        raise ValueError("Feature CSV is empty")
    train = [row for row in rows if row["split"] == "train"]
    validation = [row for row in rows if row["split"] == "validation"]
    if not train or not validation:
        raise ValueError("Feature CSV must contain train and validation rows")
    matrix = lambda selected: np.array([[float(row[name]) for name in FEATURE_ORDER] for row in selected], dtype=np.float64)
    labels = lambda selected: np.array([int(row["label"]) for row in selected], dtype=np.int64)
    return matrix(train), labels(train), matrix(validation), labels(validation), [row["subjectId"] for row in train], [row["subjectId"] for row in validation]


def metrics(labels: np.ndarray, probability: np.ndarray, threshold: float) -> dict[str, object]:
    prediction = (probability >= threshold).astype(int)
    tn, fp, fn, tp = confusion_matrix(labels, prediction, labels=[0, 1]).ravel()
    return {
        "rocAuc": round_to(roc_auc_score(labels, probability), 4),
        "prAuc": round_to(average_precision_score(labels, probability), 4),
        "recall": round_to(recall_score(labels, prediction, zero_division=0), 4),
        "specificity": round_to(tn / max(tn + fp, 1), 4),
        "f1": round_to(f1_score(labels, prediction, zero_division=0), 4),
        "balancedAccuracy": round_to(balanced_accuracy_score(labels, prediction), 4),
        "brier": round_to(brier_score_loss(labels, probability), 4),
        "confusionMatrix": {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)},
    }


def choose_threshold(labels: np.ndarray, probability: np.ndarray) -> float:
    candidates = sorted(set(float(value) for value in probability))
    scored = []
    for threshold in candidates:
        result = metrics(labels, probability, threshold)
        scored.append((result["recall"] >= ACTIVATION_RECALL, result["specificity"], result["f1"], -threshold, threshold))
    return float(max(scored)[-1])


def bootstrap_ci(labels: np.ndarray, probability: np.ndarray, threshold: float, repeats: int = 400) -> dict[str, list[float]]:
    rng = np.random.default_rng(20260601)
    values = {"rocAuc": [], "recall": [], "specificity": [], "f1": []}
    for _ in range(repeats):
        indices = rng.integers(0, len(labels), len(labels))
        sample_labels, sample_probability = labels[indices], probability[indices]
        if len(set(sample_labels.tolist())) < 2:
            continue
        result = metrics(sample_labels, sample_probability, threshold)
        for name in values:
            values[name].append(result[name])
    return {name: [round_to(np.percentile(scores, 2.5), 4), round_to(np.percentile(scores, 97.5), 4)] for name, scores in values.items()}


def bootstrap_prediction_ci(labels: np.ndarray, probability: np.ndarray, prediction: np.ndarray, repeats: int = 400) -> dict[str, list[float]]:
    rng = np.random.default_rng(20260601)
    values = {"rocAuc": [], "recall": [], "specificity": [], "f1": []}
    for _ in range(repeats):
        indices = rng.integers(0, len(labels), len(labels))
        sample_labels, sample_probability, sample_prediction = labels[indices], probability[indices], prediction[indices]
        if len(set(sample_labels.tolist())) < 2:
            continue
        result = metrics_from_prediction(sample_labels, sample_probability, sample_prediction)
        for name in values:
            values[name].append(result[name])
    return {name: [round_to(np.percentile(scores, 2.5), 4), round_to(np.percentile(scores, 97.5), 4)] for name, scores in values.items()}


def train_baselines(features: Path, artifact_dir: Path, report_dir: Path) -> None:
    x_train, y_train, x_validation, y_validation, train_ids, validation_ids = load_feature_csv(features)
    folds = StratifiedKFold(n_splits=min(5, int(np.bincount(y_train).min())), shuffle=True, random_state=20260601)
    logistic = GridSearchCV(
        Pipeline([("scale", StandardScaler()), ("model", LogisticRegression(class_weight="balanced", max_iter=3000, random_state=20260601))]),
        {"model__C": [0.05, 0.2, 1.0, 5.0]},
        scoring="roc_auc",
        cv=folds,
    )
    svc = GridSearchCV(
        Pipeline([("scale", StandardScaler()), ("model", SVC(class_weight="balanced", probability=True, random_state=20260601))]),
        {"model__C": [0.2, 1.0, 5.0], "model__gamma": ["scale", 0.01, 0.1]},
        scoring="roc_auc",
        cv=folds,
    )
    forest = GridSearchCV(
        RandomForestClassifier(class_weight="balanced", random_state=20260601),
        {"n_estimators": [160, 320], "max_depth": [None, 4, 8], "min_samples_leaf": [1, 3]},
        scoring="roc_auc",
        cv=folds,
    )
    models = {"logisticRegression": logistic, "svm": svc, "randomForest": forest}
    comparison = {}
    for name, model in models.items():
        model.fit(x_train, y_train)
        probability = model.predict_proba(x_validation)[:, 1]
        comparison[name] = {"bestParams": model.best_params_, "validation": metrics(y_validation, probability, 0.5)}
    best_logistic = logistic.best_estimator_
    internal_probability = cross_val_predict(best_logistic, x_train, y_train, cv=folds, method="predict_proba")[:, 1]
    threshold = choose_threshold(y_train, internal_probability)
    validation_probability = best_logistic.predict_proba(x_validation)[:, 1]
    validation = metrics(y_validation, validation_probability, threshold)
    validation["confidenceIntervals95"] = bootstrap_ci(y_validation, validation_probability, threshold)
    eligible = validation["rocAuc"] >= ACTIVATION_ROC_AUC and validation["recall"] >= ACTIVATION_RECALL
    artifact_dir.mkdir(parents=True, exist_ok=True)
    report_dir.mkdir(parents=True, exist_ok=True)
    predictions = [{"subjectId": subject_id, "label": int(label), "probability": round_to(probability, 6)} for subject_id, label, probability in zip(validation_ids, y_validation, validation_probability)]
    write_json(report_dir / "eatd-validation-predictions.local.json", predictions)
    report = {
        "schemaVersion": 1,
        "generatedAt": utc_now(),
        "dataset": "EATD-Corpus",
        "label": f"standard SDS >= {SDS_THRESHOLD:g}",
        "extractorVersion": EXTRACTOR_VERSION,
        "subjects": {"train": len(train_ids), "validation": len(validation_ids)},
        "activationGate": {"rocAuc": ACTIVATION_ROC_AUC, "recall": ACTIVATION_RECALL, "eligible": eligible},
        "selectedThreshold": round_to(threshold, 6),
        "selectedModelValidation": validation,
        "baselineComparison": comparison,
        "limitations": [
            "Academic research only; not a medical diagnosis.",
            "EATD labels are SDS self-report labels, not PHQ-9 labels or clinical diagnoses.",
            "The portable model is valid only for the aligned positive, neutral, and negative research prompts.",
        ],
    }
    write_json(report_dir / "eatd-baseline-summary.json", report)
    scaler = best_logistic.named_steps["scale"]
    fitted = best_logistic.named_steps["model"]
    portable = {
        "format": "voice-screening-portable-model",
        "schemaVersion": 1,
        "algorithm": "standardized-logistic-regression",
        "extractorVersion": EXTRACTOR_VERSION,
        "taskIds": list(EATD_TASKS),
        "featureOrder": list(FEATURE_ORDER),
        "scaler": {"mean": scaler.mean_.tolist(), "scale": scaler.scale_.tolist()},
        "model": {"coefficients": fitted.coef_[0].tolist(), "intercept": float(fitted.intercept_[0]), "threshold": round_to(threshold, 6)},
        "validation": {name: validation[name] for name in ("rocAuc", "recall", "specificity", "f1")},
        "modelCard": {
            "source": "EATD-Corpus",
            "intendedUse": "academic-research-only",
            "limitations": report["limitations"],
        },
    }
    candidate = artifact_dir / "eatd-logistic.candidate.vmodel"
    write_json(candidate, portable)
    if eligible:
        write_json(artifact_dir / "eatd-logistic.importable.vmodel", portable)
        print("Activation gate passed: importable .vmodel generated")
    else:
        print("Activation gate not passed: candidate kept locally, no importable .vmodel generated")
    print(json.dumps(validation, ensure_ascii=False, indent=2))


def generate_synthetic(dataset: Path, train_count: int = 30, validation_count: int = 14) -> None:
    random.seed(20260601)
    for split, count in (("train", train_count), ("validation", validation_count)):
        for index in range(count):
            positive = index % 3 == 0
            directory = dataset / split / f"{split}-synthetic-{index:03d}"
            directory.mkdir(parents=True, exist_ok=True)
            (directory / "new_label.txt").write_text("66.25" if positive else "42.5", encoding="utf-8")
            for offset, filename in enumerate(EATD_FILES):
                sample_rate, seconds = 16000, 1.4
                length = int(sample_rate * seconds)
                frequency = (135 if positive else 205) + offset * 8
                amplitude = 0.10 if positive else 0.22
                samples = []
                for sample in range(length):
                    quiet = positive and (sample // 1600) % 3 == 0
                    value = 0.0 if quiet else amplitude * math.sin(2 * math.pi * frequency * sample / sample_rate)
                    samples.append(int(max(-1, min(1, value)) * 32767))
                with wave.open(str(directory / filename), "wb") as handle:
                    handle.setnchannels(1)
                    handle.setsampwidth(2)
                    handle.setframerate(sample_rate)
                    handle.writeframes(np.array(samples, dtype="<i2").tobytes())
    print(f"Synthetic smoke dataset generated: {dataset}")


def validate_androids(dataset: Path) -> None:
    reading = list((dataset / "Reading-Task" / "audio").rglob("*.wav"))
    interviews = list((dataset / "Interview-Task" / "audio").rglob("*.wav"))
    folds = android_fold_list(dataset)
    if not reading or not interviews or not folds.is_file():
        raise ValueError("Androids corpus is incomplete: expected Reading-Task/audio, Interview-Task/audio, and fold-lists.csv")
    for task, files in (("reading", reading), ("interview", interviews)):
        fold_map = parse_android_folds(folds, task)
        included = [path for path in files if parse_android_filename(path.name)["label"] is not None]
        missing_folds = sorted({path.stem for path in included if normalized_android_id(path.name) not in fold_map})
        if missing_folds:
            raise ValueError(f"Androids fold list does not cover {task}: {', '.join(missing_folds[:5])}")
    print(f"Androids valid: {len(reading)} reading files, {len(interviews)} interview files, 5 folds per task")


ANDROID_FILENAME = re.compile(
    r"(?P<number>\d{1,3})_(?P<condition>[PCX])(?P<gender>[MF])(?P<age>\d{2})_(?P<education>[1-4X])(?:\.wav)?",
    re.IGNORECASE,
)


def normalized_android_id(value: str) -> str:
    match = ANDROID_FILENAME.search(value)
    if not match:
        raise ValueError(f"Invalid Androids filename: {value}")
    return f"{int(match.group('number')):02d}_{match.group('condition').upper()}{match.group('gender').upper()}{match.group('age')}_{match.group('education')}"


def parse_android_filename(value: str) -> dict[str, object]:
    match = ANDROID_FILENAME.search(value)
    if not match:
        raise ValueError(f"Invalid Androids filename: {value}")
    condition = match.group("condition").upper()
    return {
        "subjectId": normalized_android_id(value),
        "condition": condition,
        "label": 1 if condition == "P" else 0 if condition == "C" else None,
        "sex": match.group("gender").upper(),
        "age": int(match.group("age")),
        "education": int(match.group("education")) if match.group("education").isdigit() else None,
    }


def android_fold_list(dataset: Path) -> Path:
    plural = dataset / "fold-lists.csv"
    return plural if plural.is_file() else dataset / "fold-list.csv"


def parse_android_folds(path: Path, task: str | None = None) -> dict[str, int]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.reader(handle))
    if not rows:
        raise ValueError("Androids fold-list.csv is empty")
    if rows[0] and rows[0][0].strip().lower() == "read":
        if task not in {"reading", "interview"}:
            raise ValueError("Androids fold-lists.csv requires task='reading' or task='interview'")
        start = 0 if task == "reading" else 7
        fold_map: dict[str, int] = {}
        for row in rows[2:]:
            for offset, cell in enumerate(row[start : start + 5]):
                for match in ANDROID_FILENAME.finditer(cell):
                    key = normalized_android_id(match.group(0))
                    fold = offset + 1
                    if key in fold_map and fold_map[key] != fold:
                        raise ValueError(f"Androids subject appears in multiple folds: {key}")
                    fold_map[key] = fold
        if not fold_map:
            raise ValueError(f"Androids fold-lists.csv contains no recognizable {task} filenames")
        return fold_map
    fold_map: dict[str, int] = {}
    column_folds: dict[int, int] = {}
    active_fold: int | None = None
    for row in rows:
        for index, cell in enumerate(row):
            fold_match = re.search(r"\bfold\D*([1-5])\b", cell, re.IGNORECASE)
            if fold_match:
                column_folds[index] = int(fold_match.group(1))
                active_fold = int(fold_match.group(1))
        filename_cells = [cell for cell in row if ANDROID_FILENAME.search(cell)]
        numeric_cells = [int(cell.strip()) for cell in row if cell.strip() in {"1", "2", "3", "4", "5"}]
        for index, cell in enumerate(row):
            for match in ANDROID_FILENAME.finditer(cell):
                key = normalized_android_id(match.group(0))
                fold = column_folds.get(index)
                if fold is None and len(numeric_cells) == 1:
                    fold = numeric_cells[0]
                if fold is None:
                    fold = active_fold
                if fold is None:
                    raise ValueError(f"Cannot determine Androids fold for {match.group(0)}")
                if key in fold_map and fold_map[key] != fold:
                    raise ValueError(f"Androids subject appears in multiple folds: {key}")
                fold_map[key] = fold
        if not filename_cells:
            continue
    if not fold_map:
        raise ValueError("Androids fold-list.csv contains no recognizable subject filenames")
    return fold_map


def android_task_files(dataset: Path) -> dict[str, list[Path]]:
    return {
        "reading": sorted((dataset / "Reading-Task" / "audio").rglob("*.wav")),
        "interview": sorted((dataset / "Interview-Task" / "audio").rglob("*.wav")),
    }


def extract_androids(dataset: Path, output: Path) -> None:
    validate_androids(dataset)
    folds = android_fold_list(dataset)
    rows = []
    for task, files in android_task_files(dataset).items():
        fold_map = parse_android_folds(folds, task)
        seen: set[str] = set()
        for path in files:
            subject = parse_android_filename(path.name)
            if subject["label"] is None:
                continue
            subject_id = str(subject["subjectId"])
            if subject_id in seen:
                raise ValueError(f"Duplicate Androids {task} subject: {subject_id}")
            seen.add(subject_id)
            features = analyze_samples(*as_float_mono(path))
            row = {
                "task": task,
                **subject,
                "fold": fold_map[subject_id],
                **{name: features["mfccMean"][int(name.rsplit(".", 1)[1])] if name.startswith("mfccMean.") else features[name] for name in BASE_FEATURES},
            }
            rows.append(row)
    output.parent.mkdir(parents=True, exist_ok=True)
    fields = ["task", "subjectId", "condition", "label", "sex", "age", "education", "fold", *BASE_FEATURES]
    with output.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
    print(f"Extracted Androids features: {output}")


def metrics_from_prediction(labels: np.ndarray, probability: np.ndarray, prediction: np.ndarray) -> dict[str, object]:
    tn, fp, fn, tp = confusion_matrix(labels, prediction, labels=[0, 1]).ravel()
    return {
        "rocAuc": round_to(roc_auc_score(labels, probability), 4),
        "prAuc": round_to(average_precision_score(labels, probability), 4),
        "recall": round_to(recall_score(labels, prediction, zero_division=0), 4),
        "specificity": round_to(tn / max(tn + fp, 1), 4),
        "f1": round_to(f1_score(labels, prediction, zero_division=0), 4),
        "balancedAccuracy": round_to(balanced_accuracy_score(labels, prediction), 4),
        "brier": round_to(brier_score_loss(labels, probability), 4),
        "confusionMatrix": {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)},
    }


def android_model_factories(inner_folds: StratifiedKFold) -> dict[str, GridSearchCV]:
    return {
        "logisticRegression": GridSearchCV(
            Pipeline([("scale", StandardScaler()), ("model", LogisticRegression(class_weight="balanced", max_iter=3000, random_state=20260601))]),
            {"model__C": [0.05, 0.2, 1.0, 5.0]},
            scoring="roc_auc",
            cv=inner_folds,
        ),
        "svm": GridSearchCV(
            Pipeline([("scale", StandardScaler()), ("model", SVC(class_weight="balanced", probability=True, random_state=20260601))]),
            {"model__C": [0.2, 1.0, 5.0], "model__gamma": ["scale", 0.01, 0.1]},
            scoring="roc_auc",
            cv=inner_folds,
        ),
        "randomForest": GridSearchCV(
            RandomForestClassifier(class_weight="balanced", random_state=20260601),
            {"n_estimators": [160, 320], "max_depth": [None, 4, 8], "min_samples_leaf": [1, 3]},
            scoring="roc_auc",
            cv=inner_folds,
        ),
    }


def train_androids(features: Path, report_dir: Path) -> None:
    with features.open(encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    if not rows:
        raise ValueError("Androids feature CSV is empty")
    report = {
        "schemaVersion": 1,
        "generatedAt": utc_now(),
        "dataset": "Androids Corpus",
        "protocol": "author fold-lists.csv, five-fold subject-isolated evaluation",
        "tasks": {},
        "limitations": [
            "Academic research only; not a medical diagnosis.",
            "Androids labels are patient/control conditions, not SDS or PHQ-9 labels.",
            "Reading and interview tasks are evaluated separately and are not pooled with EATD.",
            "No Androids-derived model is exported to the mobile application.",
        ],
    }
    local_predictions = []
    for task in ("reading", "interview"):
        task_rows = [row for row in rows if row["task"] == task]
        if not task_rows:
            raise ValueError(f"Missing Androids task rows: {task}")
        folds = sorted({int(row["fold"]) for row in task_rows})
        if folds != [1, 2, 3, 4, 5]:
            raise ValueError(f"Androids {task} must contain folds 1..5, found {folds}")
        probabilities = {name: np.zeros(len(task_rows), dtype=np.float64) for name in ("logisticRegression", "svm", "randomForest")}
        logistic_prediction = np.zeros(len(task_rows), dtype=np.int64)
        thresholds = []
        for fold in folds:
            train_indices = [index for index, row in enumerate(task_rows) if int(row["fold"]) != fold]
            test_indices = [index for index, row in enumerate(task_rows) if int(row["fold"]) == fold]
            x_train = np.array([[float(task_rows[index][name]) for name in BASE_FEATURES] for index in train_indices], dtype=np.float64)
            y_train = np.array([int(task_rows[index]["label"]) for index in train_indices], dtype=np.int64)
            x_test = np.array([[float(task_rows[index][name]) for name in BASE_FEATURES] for index in test_indices], dtype=np.float64)
            class_counts = np.bincount(y_train, minlength=2)
            split_count = min(5, int(class_counts.min()))
            if split_count < 2:
                raise ValueError(f"Androids {task} fold {fold} has too few training subjects per class")
            inner_folds = StratifiedKFold(n_splits=split_count, shuffle=True, random_state=20260601 + fold)
            models = android_model_factories(inner_folds)
            for name, model in models.items():
                model.fit(x_train, y_train)
                probabilities[name][test_indices] = model.predict_proba(x_test)[:, 1]
            best_logistic = models["logisticRegression"].best_estimator_
            internal_probability = cross_val_predict(best_logistic, x_train, y_train, cv=inner_folds, method="predict_proba")[:, 1]
            threshold = choose_threshold(y_train, internal_probability)
            thresholds.append({"fold": fold, "threshold": round_to(threshold, 6)})
            logistic_prediction[test_indices] = (probabilities["logisticRegression"][test_indices] >= threshold).astype(int)
        labels = np.array([int(row["label"]) for row in task_rows], dtype=np.int64)
        logistic_metrics = metrics_from_prediction(labels, probabilities["logisticRegression"], logistic_prediction)
        logistic_metrics["confidenceIntervals95"] = bootstrap_prediction_ci(labels, probabilities["logisticRegression"], logistic_prediction)
        task_report = {
            "subjects": len(task_rows),
            "foldThresholds": thresholds,
            "logisticRegression": logistic_metrics,
            "baselineComparisonAtDefaultThreshold": {
                name: metrics(labels, probability, 0.5) for name, probability in probabilities.items()
            },
        }
        report["tasks"][task] = task_report
        for index, row in enumerate(task_rows):
            local_predictions.append({
                "task": task,
                "subjectId": row["subjectId"],
                "fold": int(row["fold"]),
                "label": int(row["label"]),
                "logisticProbability": round_to(probabilities["logisticRegression"][index], 6),
                "logisticPrediction": int(logistic_prediction[index]),
                "svmProbability": round_to(probabilities["svm"][index], 6),
                "randomForestProbability": round_to(probabilities["randomForest"][index], 6),
            })
    report_dir.mkdir(parents=True, exist_ok=True)
    write_json(report_dir / "androids-baseline-summary.json", report)
    write_json(report_dir / "androids-validation-predictions.local.json", local_predictions)
    print(json.dumps(report["tasks"], ensure_ascii=False, indent=2))


def generate_synthetic_androids(dataset: Path, subjects_per_class: int = 15) -> None:
    participants = []
    for label, condition in ((0, "C"), (1, "P")):
        for index in range(subjects_per_class):
            participant = f"{index + 1:02d}_{condition}{'F' if index % 2 else 'M'}{20 + index % 20:02d}_{index % 4 + 1}"
            participants.append((participant, label, index % 5 + 1))
    for task, relative in (("reading", Path("Reading-Task") / "audio"), ("interview", Path("Interview-Task") / "audio")):
        for participant, label, _ in participants:
            output = dataset / relative / ("PT" if label else "HC") / f"{participant}.wav"
            output.parent.mkdir(parents=True, exist_ok=True)
            sample_rate, seconds = 16000, 1.2 if task == "reading" else 1.5
            frequency, amplitude = ((145, 0.11) if label else (220, 0.23))
            values = []
            for sample in range(int(sample_rate * seconds)):
                quiet = label and (sample // 1400) % 4 == 0
                value = 0.0 if quiet else amplitude * math.sin(2 * math.pi * frequency * sample / sample_rate)
                values.append(int(value * 32767))
            with wave.open(str(output), "wb") as handle:
                handle.setnchannels(1)
                handle.setsampwidth(2)
                handle.setframerate(sample_rate)
                handle.writeframes(np.array(values, dtype="<i2").tobytes())
    with (dataset / "fold-list.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["filename", "fold"])
        for participant, _, fold in participants:
            writer.writerow([f"{participant}.wav", fold])
    print(f"Synthetic Androids smoke dataset generated: {dataset}")


def register_eatd_archive(root: Path, archive: Path) -> None:
    manifest_path = root / "manifests" / "datasets.local.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["datasets"]["eatd"].update({
        "status": "downloaded-and-extracted",
        "archive": str(archive),
        "archiveBytes": archive.stat().st_size,
        "sha256": sha256(archive),
        "registeredAt": utc_now(),
    })
    write_json(manifest_path, manifest)
    print(f"EATD archive registered: {manifest['datasets']['eatd']['sha256']}")


def register_androids_archive(root: Path, archive: Path) -> None:
    manifest_path = root / "manifests" / "datasets.local.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["datasets"]["androids"].update({
        "status": "downloaded",
        "archive": str(archive),
        "archiveBytes": archive.stat().st_size,
        "sha256": sha256(archive),
        "registeredAt": utc_now(),
        "redistribution": "prohibited",
    })
    write_json(manifest_path, manifest)
    print(f"Androids archive registered: {manifest['datasets']['androids']['sha256']}")


def write_modma_checklist(root: Path) -> None:
    write_json(root / "manifests" / "modma-application-checklist.local.json", {
        "schemaVersion": 1,
        "generatedAt": utc_now(),
        "application": "https://modma.lzu.edu.cn/data/application/",
        "manualSteps": ["Fill investigator details", "Print and sign EULA", "Upload scanned EULA", "Wait for administrator approval"],
        "requested": ["Speech Signal", "Age", "Sex", "PHQ-9", "HAMD", "MINI"],
        "redistribution": "Raw MODMA data and portions must not be redistributed.",
    })
    print("MODMA application checklist written")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, default=WORKSPACE_DEFAULT)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("init-workspace")
    eatd = sub.add_parser("validate-eatd")
    eatd.add_argument("--dataset", type=Path, required=True)
    extract = sub.add_parser("extract-eatd")
    extract.add_argument("--dataset", type=Path, required=True)
    extract.add_argument("--output", type=Path)
    train = sub.add_parser("train-baselines")
    train.add_argument("--features", type=Path)
    synthetic = sub.add_parser("generate-synthetic")
    synthetic.add_argument("--output", type=Path)
    androids = sub.add_parser("validate-androids")
    androids.add_argument("--dataset", type=Path, required=True)
    extract_androids_parser = sub.add_parser("extract-androids")
    extract_androids_parser.add_argument("--dataset", type=Path, required=True)
    extract_androids_parser.add_argument("--output", type=Path)
    train_androids_parser = sub.add_parser("train-androids")
    train_androids_parser.add_argument("--features", type=Path)
    register = sub.add_parser("register-eatd-archive")
    register.add_argument("--archive", type=Path, required=True)
    register_androids_parser = sub.add_parser("register-androids-archive")
    register_androids_parser.add_argument("--archive", type=Path, required=True)
    sub.add_parser("write-modma-checklist")
    smoke = sub.add_parser("smoke")
    smoke.add_argument("--output", type=Path)
    smoke_androids = sub.add_parser("smoke-androids")
    smoke_androids.add_argument("--output", type=Path)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    root = args.workspace
    init_workspace(root)
    if args.command == "init-workspace":
        return
    if args.command == "validate-eatd":
        validate_eatd(args.dataset)
    elif args.command == "extract-eatd":
        extract_eatd(args.dataset, args.output or root / "processed" / "eatd-features.local.csv")
    elif args.command == "train-baselines":
        train_baselines(args.features or root / "processed" / "eatd-features.local.csv", root / "artifacts", root / "reports")
    elif args.command == "generate-synthetic":
        generate_synthetic(args.output or root / "raw" / "synthetic-eatd")
    elif args.command == "validate-androids":
        validate_androids(args.dataset)
    elif args.command == "extract-androids":
        extract_androids(args.dataset, args.output or root / "processed" / "androids-features.local.csv")
    elif args.command == "train-androids":
        train_androids(args.features or root / "processed" / "androids-features.local.csv", root / "reports")
    elif args.command == "register-eatd-archive":
        register_eatd_archive(root, args.archive)
    elif args.command == "register-androids-archive":
        register_androids_archive(root, args.archive)
    elif args.command == "write-modma-checklist":
        write_modma_checklist(root)
    elif args.command == "smoke":
        dataset = args.output or root / "raw" / "synthetic-eatd"
        generate_synthetic(dataset)
        features = root / "processed" / "synthetic-eatd-features.local.csv"
        extract_eatd(dataset, features)
        train_baselines(features, root / "artifacts" / "synthetic", root / "reports" / "synthetic")
    elif args.command == "smoke-androids":
        dataset = args.output or root / "raw" / "synthetic-androids"
        generate_synthetic_androids(dataset)
        features = root / "processed" / "synthetic-androids-features.local.csv"
        extract_androids(dataset, features)
        train_androids(features, root / "reports" / "synthetic-androids")


if __name__ == "__main__":
    main()
