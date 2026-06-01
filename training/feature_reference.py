#!/usr/bin/env python3
"""Print a deterministic Python acoustic-feature reference for parity tests."""

from __future__ import annotations

import json
import math

import numpy as np

from voice_screening_pipeline import analyze_samples

SAMPLE_RATE = 16000
SAMPLE_COUNT = 16000


def samples() -> np.ndarray:
    return np.array([
        0.0 if 4000 <= index < 6000 else 0.18 * math.sin(2 * math.pi * 180 * index / SAMPLE_RATE)
        for index in range(SAMPLE_COUNT)
    ], dtype=np.float64)


if __name__ == "__main__":
    print(json.dumps(analyze_samples(samples(), SAMPLE_RATE), ensure_ascii=False, indent=2))
