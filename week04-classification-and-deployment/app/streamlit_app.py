"""One Streamlit app, two models, two tabs.

    streamlit run streamlit_app.py

Nothing in this file knows that one model is a regression and the other a
classification. Both are a loaded pipeline with a predict method behind a form.
"""

import streamlit as st

from features import (AGE_BANDS, CHARGES_FIELDS, DIABETES_FIELDS, EDUCATION,
                      GEN_HEALTH, INCOME, REGIONS, SEX, YES_NO)
from model_service import ModelService, ModelsNotReady

st.set_page_config(page_title='ML & AI Launchpad — Week 4', page_icon='🩺',
                   layout='wide')


@st.cache_resource
def load_models() -> ModelService:
    """Cached so the joblib files are read once per process, not once per click."""
    return ModelService().load()


try:
    service = load_models()
except ModelsNotReady as exc:
    st.error(str(exc))
    st.stop()

st.title('Two models, one app')
st.caption('Week 3 regression and Week 4 classification, served from the same container.')

charges_tab, diabetes_tab, about_tab = st.tabs(
    ['💵 Charges Predictor', '🩺 Diabetes Risk', 'ℹ️ About the models'])


# --- Tab 1: Week 3 regression ---------------------------------------------------------

with charges_tab:
    st.subheader('Predicted annual medical insurance charges')
    st.write('Linear regression with a BMI x smoker interaction term, trained in Week 3.')

    with st.form('charges_form'):
        left, middle, right = st.columns(3)
        with left:
            age = st.number_input('Age', 18, 100, 40)
            sex = st.selectbox('Sex', ['male', 'female'])
        with middle:
            bmi = st.number_input('BMI', 12.0, 60.0, 28.0, step=0.1)
            smoker = st.selectbox('Smoker', ['no', 'yes'])
        with right:
            children = st.number_input('Number of children', 0, 10, 0)
            region = st.selectbox('Region', REGIONS)

        submitted = st.form_submit_button('Predict charges', type='primary')

    if submitted:
        result = service.predict_charges({
            'age': age, 'bmi': bmi, 'children': children,
            'sex': sex, 'smoker': smoker, 'region': region,
        })
        st.metric('Predicted annual charges', f'${result.predicted_charges:,.0f}')
        st.caption('Typical error on held-out data is a few thousand dollars. '
                   'This is an estimate of an average, not a quote.')
        with st.expander('What the model received'):
            st.json(result.inputs)


# --- Tab 2: Week 4 classification -----------------------------------------------------

with diabetes_tab:
    st.subheader('Diabetes risk screening score')
    st.write('Gradient-boosted trees on the CDC BRFSS 2015 survey, trained in Week 4.')

    st.info(f'This model flags anyone above a **{service.threshold:.1%}** probability, '
            f'not the usual 50%. The threshold was chosen to catch about 75% of '
            f'diabetics, accepting that most flags will be false alarms.', icon='⚙️')

    lookup = {'GenHlth': GEN_HEALTH, 'Age': AGE_BANDS, 'Education': EDUCATION,
              'Income': INCOME, 'Sex': SEX}

    with st.form('diabetes_form'):
        payload = {}
        columns = st.columns(3)
        for index, (name, label, kind, options, default) in enumerate(DIABETES_FIELDS):
            column = columns[index % 3]
            with column:
                if kind == 'number':
                    low, high = options
                    payload[name] = st.number_input(label, low, high, default, key=name)
                else:
                    keys = list(options)
                    payload[name] = st.selectbox(
                        label, keys, index=keys.index(default),
                        format_func=lambda value, o=options: o[value], key=name)

        submitted = st.form_submit_button('Estimate risk', type='primary')

    if submitted:
        result = service.predict_diabetes(payload)

        left, right = st.columns([1, 2])
        with left:
            st.metric('Estimated risk', f'{result.risk_probability:.1%}')
            st.caption(f'Screening threshold: {result.threshold:.1%}')
        with right:
            if result.flagged:
                st.warning(f'**Flagged for screening** — risk is {result.band}. '
                           f'A clinician would follow up with a blood test.', icon='⚠️')
            else:
                st.success(f'**Not flagged** — risk is {result.band}.', icon='✅')
            st.progress(min(result.risk_probability / max(result.threshold * 3, 1e-9), 1.0))

        st.caption('Not a diagnosis. A statistical association learned from a 2015 '
                   'telephone survey, wrong about roughly two thirds of the people it '
                   'flags. See the About tab.')
        with st.expander('What the model received'):
            st.json(result.inputs)


# --- Tab 3: provenance ----------------------------------------------------------------

with about_tab:
    st.subheader('What is actually running')
    info = service.info()

    left, right = st.columns(2)
    with left:
        st.markdown('**Charges Predictor**')
        st.write(f'- Model: `{info["charges_model"]}`')
        st.write('- Data: medical insurance charges, 2,772 rows after de-duplication')
        st.write('- Metric: R² about 0.89, mean absolute error about $2,800')
    with right:
        st.markdown('**Diabetes Risk**')
        st.write(f'- Model: `{info["diabetes_model"]}`')
        st.write(f'- Trained on {info["trained_rows"]:,} rows (CDC BRFSS 2015)')
        metrics = info['diabetes_metrics']
        if metrics:
            st.write(f'- Test ROC-AUC: {metrics["roc_auc"]:.3f}, '
                     f'PR-AUC: {metrics["pr_auc"]:.3f}')
            st.write(f'- At the chosen threshold: recall '
                     f'{metrics["recall_at_threshold"]:.0%}, precision '
                     f'{metrics["precision_at_threshold"]:.0%}')

    st.divider()
    st.markdown("""
**Limitations, stated plainly.** The diabetes model predicts a *reported diagnosis* in a
2015 US telephone survey, not disease. Undiagnosed diabetics appear in the training data
as negatives, so the model has partly learned who sees a doctor. It uses income and
education as features. Neither model is a medical or financial instrument, and both are
teaching artifacts for the ML & AI Launchpad cohort.
    """)

    with st.expander('Raw model metadata'):
        st.json(service.diabetes_meta)
