"""Loading and prediction for both models.

This is the only file that knows where the models live or how to call them. The
Streamlit UI, the Flask API and the tests all go through here, which is why the same
two models can be served three different ways without duplicating a line of logic.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any

import joblib
import pandas as pd

MODEL_DIR = Path(os.environ.get('MODEL_DIR', Path(__file__).parent / 'models'))

CHARGES_MODEL_FILE = MODEL_DIR / 'insurance_charges_model.joblib'
DIABETES_MODEL_FILE = MODEL_DIR / 'diabetes_risk_model.joblib'
DIABETES_META_FILE = MODEL_DIR / 'diabetes_risk_metadata.json'

# Week 3's pipeline was fitted on these columns, in this order, including the
# interaction term we engineered by hand. Feed it anything else and it will complain.
CHARGES_COLUMNS = ['age', 'bmi', 'children', 'bmi_x_smoker', 'sex', 'smoker', 'region']

MISSING_MODELS_HINT = (
    'Model files not found in {path}.\n'
    'Run `python train_models.py` first, or copy the artifacts produced by '
    'notebook 02 into that folder.'
)


class ModelsNotReady(RuntimeError):
    """Raised when the app starts without its artifacts."""


@dataclass
class ChargesPrediction:
    predicted_charges: float
    inputs: dict[str, Any]

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class DiabetesPrediction:
    risk_probability: float
    threshold: float
    flagged: bool
    band: str
    inputs: dict[str, Any]

    def to_dict(self) -> dict:
        return asdict(self)


class ModelService:
    """Holds both models in memory. Built once at process start."""

    def __init__(self, model_dir: Path = MODEL_DIR):
        self.model_dir = Path(model_dir)
        self.charges_model = None
        self.diabetes_model = None
        self.diabetes_meta: dict = {}

    # -- lifecycle ---------------------------------------------------------------------

    def load(self) -> 'ModelService':
        missing = [p.name for p in (CHARGES_MODEL_FILE, DIABETES_MODEL_FILE,
                                    DIABETES_META_FILE) if not p.exists()]
        if missing:
            raise ModelsNotReady(MISSING_MODELS_HINT.format(path=self.model_dir.resolve())
                                 + f'\nMissing: {", ".join(missing)}')

        self.charges_model = joblib.load(CHARGES_MODEL_FILE)
        self.diabetes_model = joblib.load(DIABETES_MODEL_FILE)
        self.diabetes_meta = json.loads(DIABETES_META_FILE.read_text())
        return self

    @property
    def ready(self) -> bool:
        return self.charges_model is not None and self.diabetes_model is not None

    @property
    def threshold(self) -> float:
        return float(self.diabetes_meta.get('threshold', 0.5))

    def info(self) -> dict:
        """Everything the About tab and /health need."""
        return {
            'charges_model': type(self.charges_model).__name__,
            'diabetes_model': self.diabetes_meta.get('algorithm', 'unknown'),
            'diabetes_threshold': self.threshold,
            'diabetes_metrics': self.diabetes_meta.get('test_metrics', {}),
            'trained_rows': self.diabetes_meta.get('trained_rows'),
            'sklearn_version': self.diabetes_meta.get('sklearn_version'),
        }

    # -- predictions -------------------------------------------------------------------

    def predict_charges(self, payload: dict) -> ChargesPrediction:
        """Week 3's regressor. Rebuilds the engineered interaction term."""
        row = {
            'age': float(payload['age']),
            'bmi': float(payload['bmi']),
            'children': int(payload['children']),
            'sex': str(payload['sex']),
            'smoker': str(payload['smoker']),
            'region': str(payload['region']),
        }
        row['bmi_x_smoker'] = row['bmi'] * (1 if row['smoker'] == 'yes' else 0)

        frame = pd.DataFrame([row])[CHARGES_COLUMNS]
        predicted = float(self.charges_model.predict(frame)[0])
        return ChargesPrediction(predicted_charges=predicted, inputs=row)

    def predict_diabetes(self, payload: dict) -> DiabetesPrediction:
        """Week 4's classifier. The threshold comes from the metadata, not from 0.5."""
        features = self.diabetes_meta['features']
        missing = [f for f in features if f not in payload]
        if missing:
            raise ValueError(f'Missing required features: {", ".join(missing)}')

        row = {f: float(payload[f]) for f in features}
        frame = pd.DataFrame([row])[features]

        probability = float(self.diabetes_model.predict_proba(frame)[0, 1])
        threshold = self.threshold
        return DiabetesPrediction(
            risk_probability=probability,
            threshold=threshold,
            flagged=probability >= threshold,
            band=risk_band(probability, threshold),
            inputs=row,
        )


def risk_band(probability: float, threshold: float) -> str:
    """Plain-English band. Deliberately anchored on the chosen threshold."""
    if probability < threshold * 0.5:
        return 'low'
    if probability < threshold:
        return 'below the screening threshold'
    if probability < threshold * 2:
        return 'elevated'
    return 'high'


_service: ModelService | None = None


def get_service() -> ModelService:
    """Process-wide singleton, so the models are read from disk exactly once."""
    global _service
    if _service is None:
        _service = ModelService().load()
    return _service
