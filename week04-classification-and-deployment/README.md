# Week 4: Classification & Deployment

**4h**

By the end you have two models packaged into one deployed app, and you understand that
deployment is a repeatable process, not a property of the model.

**Stack:** scikit-learn, MLflow, Streamlit, Flask, Docker

**Dataset:** [CDC Diabetes Health Indicators](https://archive.ics.uci.edu/dataset/891/cdc+diabetes+health+indicators)
— 253,680 responses to the 2015 BRFSS survey, 21 features, binary diabetes label. Pulled
straight from UCI in the notebooks, so nobody needs a login.

## Running order

| # | Material | Time | What you come away with |
|---|---|---|---|
| 1 | [`01_tree_models_concepts.ipynb`](01_tree_models_concepts.ipynb) | 120 min | Why an ensemble beats one tree, and when to reach for which |
| 2 | [`02_diabetes_risk_classification.ipynb`](02_diabetes_risk_classification.ipynb) | 80 min | A tuned, tracked classifier and the threshold that makes it useful |
| 3 | [`app/README.md`](app/README.md) | 40 min | Both models in one Streamlit/Flask app, in one Docker container |

Both notebooks run as-is in Google Colab. Locally you need
`pandas numpy matplotlib seaborn scikit-learn mlflow joblib` (plus `xgboost` if you want
the one optional cell in notebook 1).

## 1 — Decision trees, random forests, boosting  *(concept, 120 min)*

Tree-based models from the ground up, every claim demonstrated rather than asserted:

- how a tree picks its splits — Gini impurity computed by hand, then by scikit-learn
- the decision boundary drawn at depth 2, 5 and unlimited, so overfitting is something
  you *see* before it is something you measure
- why trees need no scaling, and why they cannot extrapolate
- **bagging**: five trees disagreeing about the same person, and the average beating all
  five; the tree-correlation measurement that explains what `max_features` is for
- **boosting**: gradient boosting implemented in nine lines of stumps, the learning-rate
  trade-off, and the curve where test score turns back down
- a cheat sheet for which model to reach for, including when the answer is still
  logistic regression

## 2 — Diabetes risk prediction  *(project, 80 min)*

The full modelling workflow on all 253,680 rows:

- why 86% accuracy is a *failing* score on this data
- a bake-off across KNN, decision tree, random forest and gradient boosting, all in
  pipelines so the scaler cannot leak
- **hyperparameter tuning**: `GridSearchCV` on KNN and the tree, `RandomizedSearchCV` on
  the forest and the booster, reading `cv_results_` rather than just `best_score_`
- **threshold tuning** — the part that actually matters. Moving one number that requires
  no retraining takes recall from 16% to 75% and changes the outcome for thousands of
  people in the test set
- **MLflow**: both this classifier and Week 3's regressor logged with identical code,
  which is the whole thesis of the week in one cell

Produces `diabetes_risk_model.joblib`, `diabetes_risk_metadata.json` and a rebuilt
`insurance_charges_model.joblib` for the app.

## 3 — Combined deployment  *(40 min)*

One app, two tabs — **Charges Predictor** (Week 3 regression) and **Diabetes Risk**
(Week 4 classification) — served by Streamlit for humans and Flask for machines, packaged
in a single Docker container.

```bash
cd app
pip install -r requirements.txt
python train_models.py          # rebuilds both models from raw data
streamlit run streamlit_app.py  # or: python flask_app.py
docker build -t launchpad-week04 . && docker run --rm -p 8501:8501 launchpad-week04
```

Full walkthrough, including what to point at while it is on screen: [`app/README.md`](app/README.md).

## A note to put in front of the room

The diabetes model predicts a **reported diagnosis** in a 2015 US telephone survey, not
disease. Undiagnosed diabetics are labelled negative in the training data, everything is
self-reported, and the model uses income and education as features. It is a teaching
artifact and a screening-style score, not a medical device. Writing that paragraph is
part of deploying a model, not an afterthought to it.

## Contents

- `01_tree_models_concepts.ipynb` — concept session
- `02_diabetes_risk_classification.ipynb` — project session
- `app/` — the deployable app, training script, and Dockerfile
- `community_contributions/` — projects shared by cohort members ([how to contribute](../CONTRIBUTING.md))
