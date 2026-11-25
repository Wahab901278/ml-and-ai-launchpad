# Deployment — the second half of Week 4

**~40 min, hands on.**

You have two model files. Getting them in front of a person is now a sequence of four
steps that does not care what is inside them:

```
train  ->  save artifact  ->  wrap in an app  ->  containerise
```

Do it once for a regression and once for a classification and the claim at the top of the
week becomes obvious: **deployment is a repeatable process, not a property of the model.**

---

## 0. What is in this folder

| File | Role |
|---|---|
| `train_models.py` | Rebuilds **both** models from raw data. The reproducible build step. |
| `model_service.py` | Loads the artifacts and makes predictions. The only file that touches a model. |
| `features.py` | Field definitions both UIs render from, so they cannot drift apart. |
| `streamlit_app.py` | The UI for humans — two tabs. |
| `flask_app.py` | The same models as a JSON API plus a plain HTML form. |
| `templates/index.html` | Flask's form. |
| `Dockerfile`, `entrypoint.sh` | One image, either front door. |
| `models/` | The artifacts. Not in git — you generate them. |

> **Notice what is *not* here.** No training data, no notebook, no grid search. A
> deployed app needs the artifact and the code to call it, and nothing else. If your app
> needs the notebook to run, you have not finished deploying it.

---

## 1. Get the models (2 min)

Either copy what notebook 02 produced:

```bash
cp ../artifacts/*.joblib ../artifacts/*.json models/
```

or rebuild both from scratch — this is the version that goes in a pipeline:

```bash
pip install -r requirements.txt
python train_models.py
```

Roughly a minute, mostly downloading the 13 MB CDC file. You should end up with:

```
models/diabetes_risk_model.joblib       ~360 KB
models/diabetes_risk_metadata.json      ~1 KB
models/insurance_charges_model.joblib   ~4 KB
```

Add `--mlflow` to log both runs to a local MLflow store while it trains.

> **Instructor note.** `train_models.py` hard-codes the hyperparameters the notebook's
> search chose, and does not re-run the search. Ask the room whether that is cheating.
> It is not: searching is an *experiment*, training is a *build step*, and a build step
> that re-runs a random search produces a different model every time it is called. That
> is the opposite of what a build is for.

---

## 2. The Streamlit app (10 min)

```bash
streamlit run streamlit_app.py
```

Opens on http://localhost:8501 with three tabs: **Charges Predictor**, **Diabetes Risk**,
and **About the models**.

Things worth pointing at while it is on screen:

- **`@st.cache_resource` on the loader.** Without it, Streamlit re-reads both joblib files
  on every widget interaction. With it, they are read once per process. This is the single
  most common performance mistake in Streamlit ML apps.
- **The classifier's threshold is read from the metadata file**, not hard-coded, and not
  0.5. Change `threshold` in the JSON, restart, and the app's behaviour changes with no
  retraining. That is the Phase 5 lesson turned into a config value.
- **Both tabs call the same `ModelService`.** The UI has no idea one model returns dollars
  and the other returns a probability. It asks for a prediction and renders what it gets.

### Try this, live

1. On **Charges Predictor**, flip `smoker` from no to yes and watch the number jump. That
   is the interaction term from Week 3 doing its job.
2. On **Diabetes Risk**, set general health to `4 - Fair`, BMI to 34, high blood pressure
   to yes, age band to 60-64. Watch the score cross the threshold.
3. Then set general health back to `1 - Excellent` with everything else unchanged. One
   survey answer moves the score more than anything else on the form — exactly what the
   permutation importance chart predicted.

---

## 3. The Flask API (10 min)

```bash
python flask_app.py       # http://127.0.0.1:8000
```

Same models, different door. Streamlit is for a person clicking; Flask is for another
service calling.

```bash
curl -s localhost:8000/health | python -m json.tool

curl -s -X POST localhost:8000/api/charges \
  -H 'Content-Type: application/json' \
  -d '{"age": 45, "bmi": 31.0, "children": 2, "sex": "male", "smoker": "no", "region": "southeast"}'

curl -s -X POST localhost:8000/api/diabetes \
  -H 'Content-Type: application/json' \
  -d '{"HighBP": 1, "HighChol": 1, "BMI": 34, "GenHlth": 4, "Age": 9, "DiffWalk": 1, "Income": 3}'
```

The diabetes endpoint fills any feature you leave out with a default so the demo is
short. **A real API should reject an incomplete payload rather than silently inventing
values** — the missing-feature check is already in `model_service.predict_diabetes`;
the endpoint just chooses to pre-fill first. Ask the room which behaviour they want, and
why the answer is different for a demo than for a clinic.

Three things this API has that a `predict()` call in a notebook does not:

- **`/health`** — so an orchestrator can tell "running" from "running and able to work".
- **A 400 on bad input** instead of a 500 and a stack trace.
- **A 503 when the models are missing**, with the fix in the message.

---

## 4. Docker (15 min)

The app runs on your machine. That is not the same as running.

```bash
docker build -t launchpad-week04 .

docker run --rm -p 8501:8501 launchpad-week04                     # Streamlit
docker run --rm -p 8000:8000 -e APP_MODE=flask -e PORT=8000 \
  launchpad-week04                                                # Flask + gunicorn
```

Read the `Dockerfile` top to bottom with the room. Four decisions in it are worth the
time:

1. **`COPY requirements.txt` before `COPY` of the code.** Docker caches each layer and
   rebuilds from the first one that changed. Code changes hourly, dependencies change
   monthly — so install dependencies first and every later build skips a two-minute pip
   install. Swap those two lines and you will feel it on every rebuild.
2. **Pinned versions in `requirements.txt`.** The model was pickled by a specific
   scikit-learn. Unpinned, a rebuild three months from now silently installs a newer one
   and you get a warning, a subtly different prediction, or a crash. Pinning is not
   pedantry, it is the whole reason the container is reproducible.
3. **`USER appuser`.** The base image runs as root. A web process does not need to be.
4. **`HEALTHCHECK`.** The container can now say whether it is healthy, and anything
   scheduling it can restart it when it is not.

### The point of the whole exercise

One image. Two models. Two completely different ML problems — a linear regression
returning dollars and a gradient-boosted classifier returning a probability — behind the
same `docker run`.

Nothing in the Dockerfile mentions regression or classification. Nothing in
`streamlit_app.py` branches on model type. That is what it means for deployment to be a
process rather than a property: **you built the pipeline once, and it now accepts any
model you hand it.**

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `ModelsNotReady` on startup | `models/` is empty | `python train_models.py` |
| `docker build` fails at `COPY models/` | same thing, before the build | train first, then build |
| `InconsistentVersionWarning` on load | model pickled by a different scikit-learn | match `requirements.txt` to the training env, or retrain |
| Port already in use | something else on 8501/8000 | `-p 8600:8501`, or `--server.port` |
| Streamlit re-reads models on every click | `@st.cache_resource` missing | put it back |

---

## Your turn

**1.** Change `threshold` in `models/diabetes_risk_metadata.json` to `0.35` and restart
the app. Same model file, different behaviour. Explain to someone what you just changed
and what you did *not* change.

**2.** Make `/api/diabetes` reject incomplete payloads with a 400 listing the missing
features, instead of filling in defaults. Then decide which behaviour belongs in a
teaching demo and which belongs in a clinic.

**3.** Add a `/api/batch` endpoint that accepts a list of people and returns a list of
scores. Where is the one-row-at-a-time assumption in `model_service.py`?

**4.** Build the image, then run `docker images`. How large is it, and what is taking the
space? Try `python:3.11-slim` against `python:3.11` and measure.

**5.** *Harder.* Load the diabetes model from an MLflow run ID rather than a joblib file,
falling back to the file if MLflow is unreachable. Then argue for or against that being
an improvement.
