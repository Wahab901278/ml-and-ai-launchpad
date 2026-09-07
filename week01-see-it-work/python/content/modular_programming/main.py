"""
Entry point that ties the two modules together.

Modular programming means splitting a program into separate files
(modules) instead of writing everything in one long file. Each module
has one clear job, data_cleaning.py prepares raw data, stats.py
summarizes clean data. main.py imports both and uses them together.

Real world link: a typical machine learning project is organized the
same way, for example data_cleaning.py, feature_engineering.py,
model.py and train.py, each file responsible for one part of the
pipeline, imported and combined in a main script.
"""

# import the whole module, then call functions as data_cleaning.function_name
import data_cleaning

# import specific functions directly, so they can be called by name
from stats import average, highest, lowest,total

# import a module under a shorter alias
import data_cleaning as clean


def main():
    # a raw dataset the way it might arrive in real life, with missing
    # and invalid entries mixed in
    raw_scores = [70, None, 85, -5, 90, "invalid", 60, None, 75]

    scores = clean.fill_missing(raw_scores, default=0)
    scores = clean.remove_invalid(scores)


    print("cleaned scores:", scores)
    print("total:", total(scores))
    print("average:", average(scores))
    print("highest:", highest(scores))
    print("lowest:", lowest(scores))


# this guard makes sure main() only runs when this file is executed
# directly, not when it is imported into another file
if __name__ == "__main__":
    main()
