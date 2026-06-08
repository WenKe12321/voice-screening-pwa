from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from training.voice_screening_pipeline import EATD_FILES, NESTED_LEARNING_FRAMEWORK, parse_android_folds, validate_androids, validate_eatd


def write_eatd_subject(root: Path, split: str, subject: str, score: str = "42.5", missing: str | None = None) -> None:
    directory = root / split / subject
    directory.mkdir(parents=True)
    for filename in (*EATD_FILES, "new_label.txt"):
        if filename == missing:
            continue
        (directory / filename).write_text(score if filename == "new_label.txt" else "", encoding="utf-8")


class EatdValidationTest(unittest.TestCase):
    def test_missing_file_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            dataset = Path(temporary)
            write_eatd_subject(dataset, "train", "subject-a", missing="negative_out.wav")
            write_eatd_subject(dataset, "validation", "subject-b")
            with self.assertRaisesRegex(ValueError, "missing"):
                validate_eatd(dataset)

    def test_invalid_sds_label_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            dataset = Path(temporary)
            write_eatd_subject(dataset, "train", "subject-a", score="not-a-score")
            write_eatd_subject(dataset, "validation", "subject-b")
            with self.assertRaisesRegex(ValueError, "Invalid SDS score"):
                validate_eatd(dataset)

    def test_subject_leakage_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            dataset = Path(temporary)
            write_eatd_subject(dataset, "train", "same-subject")
            write_eatd_subject(dataset, "validation", "same-subject")
            with self.assertRaisesRegex(ValueError, "Subject leakage"):
                validate_eatd(dataset)


class AndroidsValidationTest(unittest.TestCase):
    def test_fold_table_is_parsed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "fold-list.csv"
            path.write_text("filename,fold\n01_CM20_1.wav,1\n02_PF21_2.wav,2\n", encoding="utf-8")
            self.assertEqual(parse_android_folds(path), {"01_CM20_1": 1, "02_PF21_2": 2})

    def test_subject_in_multiple_folds_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "fold-list.csv"
            path.write_text("filename,fold\n01_CM20_1.wav,1\n01_CM20_1.wav,2\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "multiple folds"):
                parse_android_folds(path)

    def test_author_task_matrix_is_parsed_separately(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "fold-lists.csv"
            path.write_text(
                "Read,,,,,,,Interview,,,,\n"
                "fold1,fold2,fold3,fold4,fold5,,,fold1,fold2,fold3,fold4,fold5\n"
                "'01_CM20_1','02_PF21_2',,,,,,'03_CM22_3','04_PF23_4',,,\n",
                encoding="utf-8",
            )
            self.assertEqual(parse_android_folds(path, "reading"), {"01_CM20_1": 1, "02_PF21_2": 2})
            self.assertEqual(parse_android_folds(path, "interview"), {"03_CM22_3": 1, "04_PF23_4": 2})

    def test_missing_fold_coverage_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            dataset = Path(temporary)
            reading = dataset / "Reading-Task" / "audio" / "HC" / "01_CM20_1.wav"
            interview = dataset / "Interview-Task" / "audio" / "HC" / "01_CM20_1.wav"
            reading.parent.mkdir(parents=True)
            interview.parent.mkdir(parents=True)
            reading.touch()
            interview.touch()
            (dataset / "fold-list.csv").write_text("filename,fold\n02_PF21_2.wav,1\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "does not cover"):
                validate_androids(dataset)


class NestedLearningFrameworkTest(unittest.TestCase):
    def test_framework_records_five_ordered_layers(self) -> None:
        self.assertEqual(NESTED_LEARNING_FRAMEWORK["frameworkVersion"], "nested-learning/1.0.0")
        self.assertEqual(NESTED_LEARNING_FRAMEWORK["targetPopulation"], "Chinese college students")
        self.assertEqual(
            [layer["id"] for layer in NESTED_LEARNING_FRAMEWORK["layers"]],
            [
                "segment-features",
                "task-representation",
                "individual-risk-model",
                "target-domain-calibration",
                "continuous-validation",
            ],
        )
        self.assertEqual(NESTED_LEARNING_FRAMEWORK["calibrationStatus"], "not-calibrated")


if __name__ == "__main__":
    unittest.main()
