"""Form definitions for both models.

The Streamlit app and the Flask app render the same fields from this one file, so a
change to a feature list cannot leave one UI out of step with the other.
"""

# --- Diabetes Risk (Week 4 classifier) ------------------------------------------------

GEN_HEALTH = {1: '1 - Excellent', 2: '2 - Very good', 3: '3 - Good',
              4: '4 - Fair', 5: '5 - Poor'}

AGE_BANDS = {
    1: '18-24', 2: '25-29', 3: '30-34', 4: '35-39', 5: '40-44', 6: '45-49',
    7: '50-54', 8: '55-59', 9: '60-64', 10: '65-69', 11: '70-74', 12: '75-79',
    13: '80 or older',
}

EDUCATION = {
    1: '1 - Never attended school', 2: '2 - Elementary', 3: '3 - Some high school',
    4: '4 - High school graduate', 5: '5 - Some college', 6: '6 - College graduate',
}

INCOME = {
    1: '1 - Less than $10,000', 2: '2 - $10,000 to $14,999', 3: '3 - $15,000 to $19,999',
    4: '4 - $20,000 to $24,999', 5: '5 - $25,000 to $34,999', 6: '6 - $35,000 to $49,999',
    7: '7 - $50,000 to $74,999', 8: '8 - $75,000 or more',
}

SEX = {0: 'Female', 1: 'Male'}
YES_NO = {0: 'No', 1: 'Yes'}

# (name, label, kind, options-or-range, default)
DIABETES_FIELDS = [
    ('HighBP',               'High blood pressure (diagnosed)',          'choice', YES_NO,      0),
    ('HighChol',             'High cholesterol (diagnosed)',             'choice', YES_NO,      0),
    ('CholCheck',            'Cholesterol checked in last 5 years',      'choice', YES_NO,      1),
    ('BMI',                  'BMI',                                      'number', (12, 98),    27),
    ('Smoker',               'Smoked 100+ cigarettes in their life',     'choice', YES_NO,      0),
    ('Stroke',               'Ever had a stroke',                        'choice', YES_NO,      0),
    ('HeartDiseaseorAttack', 'Coronary heart disease or heart attack',   'choice', YES_NO,      0),
    ('PhysActivity',         'Physical activity in the past 30 days',    'choice', YES_NO,      1),
    ('Fruits',               'Eats fruit at least once a day',           'choice', YES_NO,      1),
    ('Veggies',              'Eats vegetables at least once a day',      'choice', YES_NO,      1),
    ('HvyAlcoholConsump',    'Heavy alcohol consumption',                'choice', YES_NO,      0),
    ('AnyHealthcare',        'Has any health coverage',                  'choice', YES_NO,      1),
    ('NoDocbcCost',          'Skipped a doctor visit due to cost',       'choice', YES_NO,      0),
    ('GenHlth',              'Self-rated general health',                'choice', GEN_HEALTH,  3),
    ('MentHlth',             'Poor mental health days (last 30)',        'number', (0, 30),     0),
    ('PhysHlth',             'Poor physical health days (last 30)',      'number', (0, 30),     0),
    ('DiffWalk',             'Serious difficulty walking or climbing',   'choice', YES_NO,      0),
    ('Sex',                  'Sex',                                      'choice', SEX,         0),
    ('Age',                  'Age band',                                 'choice', AGE_BANDS,   8),
    ('Education',            'Education level',                          'choice', EDUCATION,   5),
    ('Income',               'Income band',                              'choice', INCOME,      6),
]

DIABETES_DEFAULTS = {name: default for name, _, _, _, default in DIABETES_FIELDS}

# --- Insurance Charges (Week 3 regressor) ---------------------------------------------

REGIONS = ['northeast', 'northwest', 'southeast', 'southwest']

CHARGES_FIELDS = [
    ('age',      'Age',                   'number', (18, 100),  40),
    ('bmi',      'BMI',                   'number', (12.0, 60.0), 28.0),
    ('children', 'Number of children',    'number', (0, 10),    0),
    ('sex',      'Sex',                   'text',   ['male', 'female'], 'male'),
    ('smoker',   'Smoker',                'text',   ['yes', 'no'],      'no'),
    ('region',   'Region',                'text',   REGIONS,    'southeast'),
]

CHARGES_DEFAULTS = {name: default for name, _, _, _, default in CHARGES_FIELDS}
