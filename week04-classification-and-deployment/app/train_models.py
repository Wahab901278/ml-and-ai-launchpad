"""Train both models and write the artifacts the app serves.

This script is the deployable version of the two notebooks. It exists so that the
question "how was the model in production made?" has a runnable answer that is not
"open a notebook and press shift-enter forty times".

    python train_models.py            # train both, write ./models/
    python train_models.py --mlflow   # also log both runs to MLflow

The hyperparameters below are the ones the Phase 4 search in notebook 02 selected. The
search is not repeated here: searching is an experiment, training is a build step, and
mixing the two is how build steps become unreproducible.
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LinearRegression
from sklearn.metrics import (accuracy_score, average_precision_score,
                             mean_absolute_error, precision_recall_curve,
                             precision_score, r2_score, recall_score, roc_auc_score)
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

MODEL_DIR = Path(__file__).parent / 'models'
RANDOM_STATE = 42

DIABETES_URL = 'https://archive.ics.uci.edu/static/public/891/data.csv'
INSURANCE_REPO = 'rahulvyasm/medical_insurance_data'

# Selected by RandomizedSearchCV in notebook 02, Phase 4.
DIABETES_PARAMS = {
    'learning_rate': 0.05,
    'max_iter': 200,
    'max_leaf_nodes': 15,
    'min_samples_leaf': 100,
    'l2_regularization': 1.0,
}

# The operating point chosen in notebook 02, Phase 5. A miss costs far more than a
# false alarm for a screening tool, so we target recall and accept the precision.
TARGET_RECALL = 0.75


# --- data loading ---------------------------------------------------------------------

def load_diabetes() -> pd.DataFrame:
    try:
        df = pd.read_csv(DIABETES_URL)
        print(f'  loaded {len(df):,} rows from UCI')
    except Exception as exc:                                    # noqa: BLE001
        print(f'  UCI fetch failed ({exc}); trying local CSV')
        df = pd.read_csv('diabetes_binary_health_indicators_BRFSS2015.csv')
    return df.drop(columns=['ID'], errors='ignore')


def load_insurance() -> pd.DataFrame:
    try:
        from huggingface_hub import hf_hub_download, list_repo_files
        csvs = [f for f in list_repo_files(INSURANCE_REPO, repo_type='dataset')
                if f.endswith('.csv')]
        df = pd.read_csv(hf_hub_download(INSURANCE_REPO, csvs[0], repo_type='dataset'))
        print(f'  loaded {len(df):,} rows from Hugging Face')
    except Exception as exc:                                    # noqa: BLE001
        print(f'  Hugging Face fetch failed ({exc}); trying local CSV')
        df = pd.read_csv('medical_insurance.csv')
    return df


# --- training -------------------------------------------------------------------------

def train_diabetes_model(log_mlflow: bool = False) -> dict:
    print('Diabetes risk classifier')
    df = load_diabetes()

    target = 'Diabetes_binary'
    X = df.drop(columns=[target])
    y = df[target].astype(int)

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, stratify=y, random_state=RANDOM_STATE)

    model = HistGradientBoostingClassifier(random_state=RANDOM_STATE, **DIABETES_PARAMS)
    started = time.time()
    model.fit(X_train, y_train)
    print(f'  fitted on {len(X_train):,} rows in {time.time() - started:.1f}s')

    proba = model.predict_proba(X_test)[:, 1]

    # Pick the threshold: the highest precision that still reaches our recall target.
    precisions, recalls, thresholds = precision_recall_curve(y_test, proba)
    viable = np.where(recalls[:-1] >= TARGET_RECALL)[0]
    best = viable[np.argmax(precisions[:-1][viable])]
    threshold = float(thresholds[best])

    predicted = (proba >= threshold).astype(int)
    metrics = {
        'roc_auc': float(roc_auc_score(y_test, proba)),
        'pr_auc': float(average_precision_score(y_test, proba)),
        'recall_at_threshold': float(recall_score(y_test, predicted)),
        'precision_at_threshold': float(precision_score(y_test, predicted)),
        'accuracy_at_threshold': float(accuracy_score(y_test, predicted)),
    }
    print(f'  ROC-AUC {metrics["roc_auc"]:.4f} | threshold {threshold:.4f} | '
          f'recall {metrics["recall_at_threshold"]:.3f} | '
          f'precision {metrics["precision_at_threshold"]:.3f}')

    import sklearn
    metadata = {
        'model_name': 'diabetes_risk',
        'algorithm': 'HistGradientBoostingClassifier',
        'best_params': DIABETES_PARAMS,
        'features': list(X_train.columns),
        'threshold': round(threshold, 4),
        'target_recall': TARGET_RECALL,
        'trained_rows': int(len(X_train)),
        'test_metrics': metrics,
        'data_source': DIABETES_URL,
        'sklearn_version': sklearn.__version__,
        'trained_at': time.strftime('%Y-%m-%d %H:%M:%S'),
    }

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, MODEL_DIR / 'diabetes_risk_model.joblib')
    (MODEL_DIR / 'diabetes_risk_metadata.json').write_text(json.dumps(metadata, indent=2))
    print(f'  wrote {MODEL_DIR / "diabetes_risk_model.joblib"}')

    if log_mlflow:
        _log_run('week04-diabetes-classification', 'diabetes_risk', model,
                 params={**DIABETES_PARAMS, 'threshold': round(threshold, 4)},
                 metrics=metrics, example=X_train.head(3),
                 tags={'task': 'classification', 'app_tab': 'Diabetes Risk'})

    return metadata


def train_charges_model(log_mlflow: bool = False) -> dict:
    print('Insurance charges regressor')
    df = load_insurance().drop_duplicates().reset_index(drop=True)
    df['bmi_x_smoker'] = df['bmi'] * (df['smoker'] == 'yes').astype(int)

    numeric = ['age', 'bmi', 'children', 'bmi_x_smoker']
    categorical = ['sex', 'smoker', 'region']

    X = df[numeric + categorical]
    y = df['charges']
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=RANDOM_STATE)

    model = Pipeline([
        ('prep', ColumnTransformer([
            ('num', 'passthrough', numeric),
            ('cat', OneHotEncoder(drop='first'), categorical)])),
        ('model', LinearRegression()),
    ]).fit(X_train, y_train)

    predicted = model.predict(X_test)
    metrics = {'r2': float(r2_score(y_test, predicted)),
               'mae': float(mean_absolute_error(y_test, predicted))}
    print(f'  R2 {metrics["r2"]:.4f} | MAE ${metrics["mae"]:,.0f}')

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, MODEL_DIR / 'insurance_charges_model.joblib')
    print(f'  wrote {MODEL_DIR / "insurance_charges_model.joblib"}')

    if log_mlflow:
        _log_run('week03-insurance-regression', 'insurance_charges', model,
                 params={'algorithm': 'LinearRegression + one-hot + interaction'},
                 metrics=metrics, example=X_train.head(3),
                 tags={'task': 'regression', 'app_tab': 'Charges Predictor'})

    return metrics


def _log_run(experiment: str, run_name: str, model, params: dict,
             metrics: dict, example: pd.DataFrame, tags: dict) -> None:
    """Identical for a regressor and a classifier. That is the point of the exercise."""
    import mlflow
    import mlflow.sklearn

    mlflow.set_tracking_uri('sqlite:///mlflow.db')
    mlflow.set_experiment(experiment)
    with mlflow.start_run(run_name=run_name):
        mlflow.log_params(params)
        mlflow.log_metrics(metrics)
        mlflow.set_tags(tags)
        try:                            # MLflow 3 renamed artifact_path -> name
            mlflow.sklearn.log_model(model, name='model', input_example=example,
                                     serialization_format='cloudpickle')
        except TypeError:
            mlflow.sklearn.log_model(model, artifact_path='model', input_example=example,
                                     serialization_format='cloudpickle')
    print(f'  logged to MLflow experiment "{experiment}"')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mlflow', action='store_true',
                        help='also log both runs to a local MLflow store')
    parser.add_argument('--only', choices=['diabetes', 'charges'],
                        help='train just one of the two models')
    args = parser.parse_args()

    if args.only != 'charges':
        train_diabetes_model(args.mlflow)
    if args.only != 'diabetes':
        train_charges_model(args.mlflow)

    print(f'\nArtifacts in {MODEL_DIR.resolve()}')
    for path in sorted(MODEL_DIR.iterdir()):
        if path.name != '.gitkeep':
            print(f'  {path.name}  ({path.stat().st_size / 1024:.0f} KB)')


if __name__ == '__main__':
    main()
