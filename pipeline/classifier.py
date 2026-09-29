"""
XGBoost Classifier Module
==========================
Loads the pre-trained Weighted XGBoost Model B and runs
multi-class thermal source classification.

Classes:
  0 = Agricultural burning
  1 = Forest fire
  2 = Industrial
  3 = Quarry/Mining
  4 = Vegetation fire (open/scrub)
"""

import json
import logging
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd
import xgboost as xgb

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from config import (
    FIRMS_MODEL_PATH,
    MODEL_METADATA_PATH,
    MODEL_FEATURES,
    MODEL_CLASSES,
    IDX_TO_CLASS,
)
from pipeline.feature_engineer import engineer_features, extract_model_input

logger = logging.getLogger(__name__)


class ThermalClassifier:
    """
    XGBoost Model B — Thermal Source Classifier.

    Classifies VIIRS thermal detections into 5 categories:
    Industrial, Forest fire, Quarry/Mining,
    Agricultural burning, Vegetation fire.
    """

    def __init__(
        self,
        model_path: Optional[str] = None,
        metadata_path: Optional[str] = None,
    ):
        self.model_path = Path(model_path or FIRMS_MODEL_PATH)
        self.metadata_path = Path(metadata_path or MODEL_METADATA_PATH)
        self.model: Optional[xgb.Booster] = None
        self.metadata: Optional[dict] = None
        self._loaded = False

    def load(self) -> "ThermalClassifier":
        """Load the XGBoost model and metadata."""
        if self._loaded:
            return self

        # Load metadata
        if self.metadata_path.exists():
            with open(self.metadata_path, "r", encoding="utf-8") as f:
                self.metadata = json.load(f)
            logger.info(
                f"Model metadata loaded: {self.metadata.get('model_name')}"
            )
        else:
            logger.warning(f"Metadata not found: {self.metadata_path}")
            self.metadata = {}

        # Load XGBoost model
        if not self.model_path.exists():
            raise FileNotFoundError(
                f"Model file not found: {self.model_path}"
            )

        logger.info(f"Loading XGBoost model from {self.model_path}...")
        self.model = xgb.Booster()
        self.model.load_model(str(self.model_path))

        logger.info(
            f"Model loaded successfully. "
            f"Test accuracy: {self.metadata.get('test_accuracy', 'N/A')}"
        )
        self._loaded = True
        return self

    def predict(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Classify thermal detections.

        Parameters
        ----------
        df : pd.DataFrame
            DataFrame with all 18 model features already computed.

        Returns
        -------
        pd.DataFrame
            Original DataFrame with added columns:
            - predicted_class: string class label
            - prediction_confidence: max probability
            - prob_*: per-class probabilities
        """
        if not self._loaded:
            self.load()

        if df.empty:
            return df

        # Extract feature matrix
        try:
            X = extract_model_input(df)
        except ValueError as e:
            logger.error(f"Feature extraction failed: {e}")
            return df

        # Create DMatrix for XGBoost
        dmatrix = xgb.DMatrix(X, feature_names=MODEL_FEATURES)

        # Predict probabilities
        probabilities = self.model.predict(dmatrix)

        # Handle single sample case
        if probabilities.ndim == 1:
            probabilities = probabilities.reshape(1, -1)

        # Get predicted class (argmax)
        predicted_indices = np.argmax(probabilities, axis=1)
        predicted_classes = [IDX_TO_CLASS[i] for i in predicted_indices]
        max_probs = np.max(probabilities, axis=1)

        # Add to DataFrame
        df = df.copy()
        df["predicted_class"] = predicted_classes
        df["prediction_confidence"] = np.round(max_probs, 6)

        # Add per-class probabilities
        for i, cls in enumerate(MODEL_CLASSES):
            col_name = (
                "prob_"
                + cls.lower()
                .replace(" ", "_")
                .replace("/", "_")
                .replace("(", "")
                .replace(")", "")
            )
            df[col_name] = np.round(probabilities[:, i], 6)

        logger.info(
            f"Classified {len(df)} detections. "
            f"Distribution: "
            + ", ".join(
                f"{cls}: {(predicted_indices == i).sum()}"
                for i, cls in enumerate(MODEL_CLASSES)
            )
        )

        return df

    def classify_raw(
        self,
        df: pd.DataFrame,
        historical_df: Optional[pd.DataFrame] = None,
    ) -> pd.DataFrame:
        """
        End-to-end classification: feature engineering + prediction.

        Parameters
        ----------
        df : pd.DataFrame
            Raw detection data (from FIRMS or CSV).
        historical_df : pd.DataFrame, optional
            Historical data for persistence computation.

        Returns
        -------
        pd.DataFrame
            Fully classified with all features and predictions.
        """
        # Step 1: Engineer features
        df_features = engineer_features(df, historical_df)

        # Step 2: Predict
        df_classified = self.predict(df_features)

        return df_classified

    def get_model_info(self) -> dict:
        """Return model metadata for the API."""
        if not self._loaded:
            self.load()

        return {
            "model_name": self.metadata.get("model_name", "XGBoost Model B"),
            "description": self.metadata.get("description", ""),
            "num_classes": len(MODEL_CLASSES),
            "classes": MODEL_CLASSES,
            "features": MODEL_FEATURES,
            "num_features": len(MODEL_FEATURES),
            "test_accuracy": self.metadata.get("test_accuracy"),
            "test_macro_f1": self.metadata.get("test_macro_f1"),
            "test_weighted_f1": self.metadata.get("test_weighted_f1"),
            "test_balanced_accuracy": self.metadata.get(
                "test_balanced_accuracy"
            ),
            "training_samples": self.metadata.get("training_samples"),
            "class_weights": self.metadata.get("class_weights"),
        }


# Alias for backward compatibility
XGBoostClassifier = ThermalClassifier


# ============================================================
# Module-level convenience
# ============================================================

_classifier_instance: Optional[ThermalClassifier] = None


def get_classifier() -> ThermalClassifier:
    """Get or create the singleton classifier instance."""
    global _classifier_instance
    if _classifier_instance is None:
        _classifier_instance = ThermalClassifier()
        _classifier_instance.load()
    return _classifier_instance


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)

    classifier = ThermalClassifier()
    classifier.load()

    # Print model info
    info = classifier.get_model_info()
    print(f"Model: {info['model_name']}")
    print(f"Classes: {info['classes']}")
    print(f"Accuracy: {info['test_accuracy']:.4f}")

    # Test with sample data
    test_data = pd.DataFrame({
        "latitude": [23.6866, 23.7517, 23.3487],
        "longitude": [86.3912, 86.4168, 85.3096],
        "bright_ti4": [328.07, 326.49, 310.0],
        "bright_ti5": [298.15, 297.15, 290.0],
        "scan": [0.57, 0.57, 0.40],
        "track": [0.52, 0.52, 0.45],
        "frp": [6.88, 3.69, 1.5],
        "confidence": ["l", "n", "h"],
        "acq_date": ["2022-01-01", "2022-01-01", "2022-03-15"],
        "acq_time": [651, 651, 1400],
        "daynight": ["D", "D", "D"],
        "worldcover_class": [5, 4, 0],
    })

    result = classifier.classify_raw(test_data)
    print("\nPredictions:")
    for _, row in result.iterrows():
        print(
            f"  ({row['latitude']:.4f}, {row['longitude']:.4f}): "
            f"{row['predicted_class']} "
            f"(conf: {row['prediction_confidence']:.4f})"
        )
