"""The same two models behind a JSON API, plus a plain HTML form.

    python flask_app.py                 # http://127.0.0.1:8000

Endpoints
    GET  /                  two-tab HTML form
    GET  /health            liveness + what is loaded
    POST /api/charges       {"age": 45, "bmi": 31, "children": 2, "sex": "male",
                             "smoker": "no", "region": "southeast"}
    POST /api/diabetes      {"HighBP": 1, ..., "Income": 3}   (all 21 features)

Streamlit is the right tool for a human clicking buttons. This is the right tool for
another service calling you. Same models, same `model_service`, different door.
"""

from __future__ import annotations

import os

from flask import Flask, jsonify, render_template, request

from features import (AGE_BANDS, CHARGES_DEFAULTS, DIABETES_DEFAULTS, DIABETES_FIELDS,
                      EDUCATION, GEN_HEALTH, INCOME, REGIONS, SEX, YES_NO)
from model_service import ModelService, ModelsNotReady

app = Flask(__name__)

try:
    service: ModelService | None = ModelService().load()
    load_error = None
except ModelsNotReady as exc:
    service, load_error = None, str(exc)

LOOKUPS = {'GenHlth': GEN_HEALTH, 'Age': AGE_BANDS, 'Education': EDUCATION,
           'Income': INCOME, 'Sex': SEX}


def require_service():
    if service is None:
        return jsonify({'error': 'models not loaded', 'detail': load_error}), 503
    return None


@app.get('/health')
def health():
    if service is None:
        return jsonify({'status': 'unhealthy', 'detail': load_error}), 503
    return jsonify({'status': 'ok', **service.info()})


@app.post('/api/charges')
def api_charges():
    if (failure := require_service()) is not None:
        return failure
    payload = request.get_json(silent=True) or {}
    try:
        result = service.predict_charges({**CHARGES_DEFAULTS, **payload})
    except (KeyError, ValueError, TypeError) as exc:
        return jsonify({'error': 'bad request', 'detail': str(exc)}), 400
    return jsonify(result.to_dict())


@app.post('/api/diabetes')
def api_diabetes():
    if (failure := require_service()) is not None:
        return failure
    payload = request.get_json(silent=True) or {}
    try:
        result = service.predict_diabetes({**DIABETES_DEFAULTS, **payload})
    except (KeyError, ValueError, TypeError) as exc:
        return jsonify({'error': 'bad request', 'detail': str(exc)}), 400
    return jsonify(result.to_dict())


@app.route('/', methods=['GET', 'POST'])
def index():
    charges_result = diabetes_result = None
    charges_values = dict(CHARGES_DEFAULTS)
    diabetes_values = dict(DIABETES_DEFAULTS)
    active = request.form.get('form', 'charges') if request.method == 'POST' else 'charges'

    if request.method == 'POST' and service is not None:
        if active == 'charges':
            charges_values = {
                'age': int(request.form['age']),
                'bmi': float(request.form['bmi']),
                'children': int(request.form['children']),
                'sex': request.form['sex'],
                'smoker': request.form['smoker'],
                'region': request.form['region'],
            }
            charges_result = service.predict_charges(charges_values).to_dict()
        else:
            diabetes_values = {name: float(request.form[name])
                               for name, *_ in DIABETES_FIELDS}
            diabetes_result = service.predict_diabetes(diabetes_values).to_dict()

    return render_template(
        'index.html',
        load_error=load_error,
        active=active,
        regions=REGIONS,
        diabetes_fields=DIABETES_FIELDS,
        lookups=LOOKUPS,
        yes_no=YES_NO,
        charges_values=charges_values,
        diabetes_values=diabetes_values,
        charges_result=charges_result,
        diabetes_result=diabetes_result,
        threshold=service.threshold if service else 0.5,
        info=service.info() if service else {},
    )


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8000))
    # debug=False: this is the mode the container runs in, so develop against it.
    app.run(host='0.0.0.0', port=port, debug=False)
