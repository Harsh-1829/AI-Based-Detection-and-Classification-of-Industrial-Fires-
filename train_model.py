"""
================================================================
JHARKHAND VIIRS THERMAL SOURCE CLASSIFICATION
WEIGHTED XGBOOST - MODEL B (TRAINING & EVALUATION PIPELINE)

TRAINING  : 2021 LABELED DATA (jh_viirs_train_2021_labeled.csv)
TESTING   : 2022 LABELED DATA (jh_viirs_test_2022_labeled.csv)
PREDICT   : 2022 UNCLASSIFIED DATA (jh_viirs_test_2022_unclassified.csv)

MODEL B:
Weighted XGBoost WITHOUT daynight_bin
================================================================
"""

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import (
    accuracy_score,
    balanced_accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
)
from sklearn.preprocessing import LabelEncoder
from xgboost import XGBClassifier


def main():
    print("=" * 70)
    print("JHARKHAND VIIRS THERMAL SOURCE CLASSIFICATION")
    print("WEIGHTED XGBOOST - MODEL B (TRAINING & INFERENCE)")
    print("=" * 70)

    # 1. Paths & Verification
    data_folder = Path(__file__).resolve().parent
    train_file = data_folder / "jh_viirs_train_2021_labeled.csv"
    test_file = data_folder / "jh_viirs_test_2022_labeled.csv"
    unclassified_file = data_folder / "jh_viirs_test_2022_unclassified.csv"

    print("\nCHECKING FILES")
    print("-" * 70)
    for file in [train_file, test_file, unclassified_file]:
        if file.exists():
            print(f"FOUND : {file.name}")
        else:
            raise FileNotFoundError(f"Missing required file: {file}")

    # 2. Load Data
    print("\n" + "=" * 70)
    print("LOADING DATA")
    print("=" * 70)
    train_df = pd.read_csv(train_file)
    test_df = pd.read_csv(test_file)
    unclassified_df = pd.read_csv(unclassified_file)

    print(f"2021 labeled       : {train_df.shape}")
    print(f"2022 labeled       : {test_df.shape}")
    print(f"2022 unclassified  : {unclassified_df.shape}")

    # 3. Target Column
    target = "label_final"
    if target not in train_df.columns:
        raise ValueError(f"Target column '{target}' does not exist in training dataset.")
    if target not in test_df.columns:
        raise ValueError(f"Target column '{target}' does not exist in test dataset.")

    print("\nTARGET COLUMN:", target)
    print("\n" + "=" * 70)
    print("2021 TRAINING CLASS DISTRIBUTION")
    print("=" * 70)
    class_distribution = train_df[target].value_counts()
    print(class_distribution)

    # 4. Features (Model B: 18 features without daynight_bin)
    features = [
        "latitude",
        "longitude",
        "bright_ti4",
        "bright_ti5",
        "scan",
        "track",
        "frp",
        "confidence_ordinal",
        "month_sin",
        "month_cos",
        "hour_sin",
        "hour_cos",
        "ti_diff",
        "log_frp",
        "worldcover_class",
        "n_detections_at_source",
        "unique_days_active",
        "days_active_span",
    ]

    print("\n" + "=" * 70)
    print("MODEL B FEATURES")
    print("=" * 70)
    for i, feature in enumerate(features, start=1):
        print(f"{i:2d}. {feature}")

    for feature in features:
        if feature not in train_df.columns:
            raise ValueError(f"Feature '{feature}' is missing from 2021 training dataset.")
        if feature not in test_df.columns:
            raise ValueError(f"Feature '{feature}' is missing from 2022 labeled dataset.")
        if feature not in unclassified_df.columns:
            raise ValueError(f"Feature '{feature}' is missing from 2022 unclassified dataset.")

    print("\nAll 18 required features are verified.")

    # 5. Preprocessing & Imputation
    print("\n" + "=" * 70)
    print("PREPROCESSING & NUMERIC CONVERSION")
    print("=" * 70)
    x_train = train_df[features].copy()
    x_test = test_df[features].copy()
    x_unclassified = unclassified_df[features].copy()

    for feature in features:
        x_train[feature] = pd.to_numeric(x_train[feature], errors="coerce")
        x_test[feature] = pd.to_numeric(x_test[feature], errors="coerce")
        x_unclassified[feature] = pd.to_numeric(x_unclassified[feature], errors="coerce")

    x_train = x_train.replace([np.inf, -np.inf], np.nan)
    x_test = x_test.replace([np.inf, -np.inf], np.nan)
    x_unclassified = x_unclassified.replace([np.inf, -np.inf], np.nan)

    # Impute missing values with training medians
    train_medians = x_train.median()
    x_train = x_train.fillna(train_medians).fillna(0)
    x_test = x_test.fillna(train_medians).fillna(0)
    x_unclassified = x_unclassified.fillna(train_medians).fillna(0)
    print("Missing values imputed using training medians.")

    # 6. Encode Target Classes
    print("\n" + "=" * 70)
    print("ENCODING TARGET CLASSES")
    print("=" * 70)
    label_encoder = LabelEncoder()
    y_train = label_encoder.fit_transform(train_df[target].astype(str))
    y_test = label_encoder.transform(test_df[target].astype(str))

    class_names = list(label_encoder.classes_)
    num_classes = len(class_names)
    print("Classes:")
    for i, class_name in enumerate(class_names):
        print(f"  {i} = {class_name}")

    # 7. Inverse-Frequency Class Weights
    print("\n" + "=" * 70)
    print("CALCULATING CLASS WEIGHTS")
    print("=" * 70)
    n = len(y_train)
    k = num_classes
    class_counts = np.bincount(y_train, minlength=num_classes)
    class_weights = {i: n / (k * class_counts[i]) for i in range(num_classes)}

    for class_id, class_name in enumerate(class_names):
        print(
            f"  {class_name:<30} count = {class_counts[class_id]:>6d}  weight = {class_weights[class_id]:.4f}"
        )
    sample_weights = np.array([class_weights[cid] for cid in y_train])

    # 8. Train XGBoost Model B
    print("\n" + "=" * 70)
    print("TRAINING WEIGHTED XGBOOST MODEL B")
    print("=" * 70)
    model = XGBClassifier(
        objective="multi:softprob",
        num_class=num_classes,
        n_estimators=500,
        max_depth=7,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        min_child_weight=3,
        reg_alpha=0.1,
        reg_lambda=1.0,
        random_state=42,
        eval_metric="mlogloss",
        tree_method="hist",
        n_jobs=-1,
    )
    model.fit(x_train, y_train, sample_weight=sample_weights, verbose=False)
    print("Training complete.")

    # 9. Evaluate on 2022 Independent Test Data
    print("\n" + "=" * 70)
    print("2022 INDEPENDENT TEST EVALUATION")
    print("=" * 70)
    y_pred = model.predict(x_test).astype(int)
    y_pred_proba = model.predict_proba(x_test)

    accuracy = accuracy_score(y_test, y_pred)
    macro_f1 = f1_score(y_test, y_pred, average="macro")
    weighted_f1 = f1_score(y_test, y_pred, average="weighted")
    balanced_acc = balanced_accuracy_score(y_test, y_pred)

    print(f"Accuracy           : {accuracy:.4f} ({accuracy * 100:.2f}%)")
    print(f"Macro-F1           : {macro_f1:.4f} ({macro_f1 * 100:.2f}%)")
    print(f"Weighted-F1        : {weighted_f1:.4f} ({weighted_f1 * 100:.2f}%)")
    print(f"Balanced Accuracy  : {balanced_acc:.4f} ({balanced_acc * 100:.2f}%)")

    # 10. Classification Report & Confusion Matrix
    print("\n" + "=" * 70)
    print("CLASSIFICATION REPORT")
    print("=" * 70)
    report_text = classification_report(
        y_test, y_pred, target_names=class_names, digits=4, zero_division=0
    )
    print(report_text)

    report_df = pd.DataFrame(
        classification_report(
            y_test, y_pred, target_names=class_names, output_dict=True, zero_division=0
        )
    ).transpose()
    report_file = data_folder / "xgboost_model_B_2022_classification_report.csv"
    report_df.to_csv(report_file)
    print(f"Classification report saved to: {report_file}")

    cm = confusion_matrix(y_test, y_pred)
    print("\nCONFUSION MATRIX:")
    print(cm)

    # 11. Feature Importance
    print("\n" + "=" * 70)
    print("FEATURE IMPORTANCE")
    print("=" * 70)
    importance_df = pd.DataFrame({
        "feature": features,
        "importance": model.feature_importances_,
    }).sort_values("importance", ascending=False)
    print(importance_df.to_string(index=False))

    importance_file = data_folder / "xgboost_model_B_feature_importance.csv"
    importance_df.to_csv(importance_file, index=False)
    print(f"Feature importance saved to: {importance_file}")

    # 12. Inference on 2022 Unclassified Data
    print("\n" + "=" * 70)
    print("INFERENCE ON 2022 UNCLASSIFIED OBSERVATIONS")
    print("=" * 70)
    unclass_preds = model.predict(x_unclassified).astype(int)
    unclass_probas = model.predict_proba(x_unclassified)

    classified_df = unclassified_df.copy()
    classified_df["predicted_class"] = label_encoder.inverse_transform(unclass_preds)
    classified_df["prediction_confidence"] = unclass_probas.max(axis=1)

    for class_id, class_name in enumerate(class_names):
        safe_name = (
            class_name.lower()
            .replace("/", "_")
            .replace(" ", "_")
            .replace("(", "")
            .replace(")", "")
            .replace("-", "_")
        )
        classified_df[f"prob_{safe_name}"] = unclass_probas[:, class_id]

    print("\nSample Predictions (Top 10):")
    sample_cols = ["latitude", "longitude", "frp", "predicted_class", "prediction_confidence"]
    print(classified_df[sample_cols].head(10).to_string(index=False))

    # 13. Prediction Distribution
    pred_dist = (
        classified_df["predicted_class"]
        .value_counts()
        .rename_axis("predicted_class")
        .reset_index(name="count")
    )
    pred_dist["percentage"] = (pred_dist["count"] / len(classified_df)) * 100
    print("\n" + "=" * 70)
    print("2022 UNCLASSIFIED PREDICTION DISTRIBUTION")
    print("=" * 70)
    print(pred_dist.to_string(index=False))

    dist_file = data_folder / "xgboost_model_B_prediction_distribution.csv"
    pred_dist.to_csv(dist_file, index=False)
    print(f"Prediction distribution saved to: {dist_file}")

    # 14. Save Classified Outputs
    classified_file = data_folder / "jh_viirs_2022_unclassified_CLASSIFIED_MODEL_B.csv"
    classified_df.to_csv(classified_file, index=False)
    print(f"\nFinal classified dataset saved: {classified_file}")

    # 15. Save 2022 Test Predictions
    test_results = test_df.copy()
    test_results["actual_class"] = label_encoder.inverse_transform(y_test)
    test_results["predicted_class"] = label_encoder.inverse_transform(y_pred)
    test_results["prediction_confidence"] = y_pred_proba.max(axis=1)
    test_preds_file = data_folder / "jh_viirs_2022_test_predictions_MODEL_B.csv"
    test_results.to_csv(test_preds_file, index=False)
    print(f"2022 test predictions saved: {test_preds_file}")

    # 16. Save Trained Model
    model_file = data_folder / "jharkhand_viirs_MODEL_B.json"
    model.save_model(str(model_file))
    print(f"XGBoost model saved: {model_file}")

    # 17. Save Model Metadata
    metadata = {
        "model_name": "Weighted XGBoost Model B",
        "description": "Jharkhand VIIRS thermal-source multiclass classifier",
        "target": target,
        "classes": class_names,
        "features": features,
        "num_classes": num_classes,
        "class_weights": {class_names[i]: float(class_weights[i]) for i in range(num_classes)},
        "training_samples": int(len(train_df)),
        "testing_samples": int(len(test_df)),
        "unclassified_predictions": int(len(unclassified_df)),
        "test_accuracy": float(accuracy),
        "test_macro_f1": float(macro_f1),
        "test_weighted_f1": float(weighted_f1),
        "test_balanced_accuracy": float(balanced_acc),
    }
    metadata_file = data_folder / "jharkhand_viirs_MODEL_B_metadata.json"
    with open(metadata_file, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=4)
    print(f"Model metadata saved: {metadata_file}")

    # 18. Final Summary
    print("\n" + "=" * 70)
    print("XGBOOST CLASSIFICATION COMPLETE - SUCCESS")
    print("=" * 70)
    print(f"Model: Weighted XGBoost Model B (without daynight_bin)")
    print(f"Training observations (2021)   : {len(train_df):,}")
    print(f"Test observations (2022)       : {len(test_df):,}")
    print(f"Test Accuracy                  : {accuracy * 100:.2f}%")
    print(f"Test Macro-F1                  : {macro_f1 * 100:.2f}%")
    print(f"Test Balanced Accuracy         : {balanced_acc * 100:.2f}%")
    print(f"Unclassified Processed (2022)  : {len(classified_df):,}")
    print("=" * 70)


if __name__ == "__main__":
    main()
