"""
Feature Engineering Module
===========================
Replicates the exact feature engineering pipeline from the
XGBoost Model B training notebook (Untitled.ipynb).

Produces the 18 features expected by the model:
  latitude, longitude, bright_ti4, bright_ti5, scan, track, frp,
  confidence_ordinal, month_sin, month_cos, hour_sin, hour_cos,
  ti_diff, log_frp, worldcover_class, n_detections_at_source,
  unique_days_active, days_active_span
"""

import logging
from typing import Optional

import numpy as np
import pandas as pd
from scipy.spatial.distance import cdist

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from config import (
    MODEL_FEATURES,
    CONFIDENCE_MAP,
    DBSCAN_EPS_KM,
    DBSCAN_MIN_SAMPLES,
    EARTH_RADIUS_KM,
)

logger = logging.getLogger(__name__)


def engineer_features(
    df: pd.DataFrame,
    historical_df: Optional[pd.DataFrame] = None,
) -> pd.DataFrame:
    """
    Full feature engineering pipeline.

    Parameters
    ----------
    df : pd.DataFrame
        Raw detection data with columns: latitude, longitude,
        bright_ti4, bright_ti5, scan, track, frp, confidence,
        acq_date, acq_time, daynight, worldcover_class.
    historical_df : pd.DataFrame, optional
        Historical detections for computing persistence features.
        If None, persistence is computed from df alone.

    Returns
    -------
    pd.DataFrame
        With all 18 model features computed.
    """
    logger.info(f"Engineering features for {len(df)} detections...")
    df = df.copy()

    # Step 1: Parse temporal fields
    df = _compute_temporal_features(df)

    # Step 2: Thermal derived features
    df = _compute_thermal_features(df)

    # Step 3: Confidence encoding
    df = _compute_confidence_ordinal(df)

    # Step 4: Ensure worldcover_class exists (should be added by enrichment)
    if "worldcover_class" not in df.columns:
        df["worldcover_class"] = 0
        logger.warning("worldcover_class missing — defaulting to 0")

    # Step 5: Spatial clustering and persistence features
    combined = df
    if historical_df is not None and not historical_df.empty:
        combined = pd.concat([historical_df, df], ignore_index=True)

    combined = _compute_source_clusters(combined)
    combined = _compute_persistence_features(combined)

    # If we combined with historical, extract only the new rows
    if historical_df is not None and not historical_df.empty:
        n_hist = len(historical_df)
        df_result = combined.iloc[n_hist:].copy().reset_index(drop=True)
    else:
        df_result = combined

    # Step 6: Handle missing values
    for col in MODEL_FEATURES:
        if col not in df_result.columns:
            df_result[col] = 0
            logger.warning(f"Feature '{col}' missing — filled with 0")
        else:
            df_result[col] = pd.to_numeric(
                df_result[col], errors="coerce"
            ).fillna(0)

    logger.info("Feature engineering complete.")
    return df_result


# ============================================================
# TEMPORAL FEATURES
# ============================================================

def _compute_temporal_features(df: pd.DataFrame) -> pd.DataFrame:
    """Compute cyclic month and hour encodings."""

    # Parse acq_date to get month
    if "acq_date" in df.columns:
        df["acq_date"] = pd.to_datetime(df["acq_date"], errors="coerce")
        df["month"] = df["acq_date"].dt.month
    elif "month" not in df.columns:
        df["month"] = 1

    # Parse acq_time to get hour
    if "acq_time" in df.columns:
        # acq_time is HHMM format (e.g., 651 = 06:51, 1919 = 19:19)
        df["hour"] = (
            pd.to_numeric(df["acq_time"], errors="coerce")
            .fillna(0)
            .astype(int)
            // 100
        )
    elif "hour" not in df.columns:
        df["hour"] = 12

    # Cyclic encoding
    df["month_sin"] = np.sin(2 * np.pi * df["month"] / 12)
    df["month_cos"] = np.cos(2 * np.pi * df["month"] / 12)
    df["hour_sin"] = np.sin(2 * np.pi * df["hour"] / 24)
    df["hour_cos"] = np.cos(2 * np.pi * df["hour"] / 24)

    return df


# ============================================================
# THERMAL FEATURES
# ============================================================

def _compute_thermal_features(df: pd.DataFrame) -> pd.DataFrame:
    """Compute ti_diff and log_frp."""

    # Temperature difference
    if "bright_ti4" in df.columns and "bright_ti5" in df.columns:
        df["ti_diff"] = (
            pd.to_numeric(df["bright_ti4"], errors="coerce").fillna(0)
            - pd.to_numeric(df["bright_ti5"], errors="coerce").fillna(0)
        )
    else:
        df["ti_diff"] = 0

    # Log of Fire Radiative Power
    if "frp" in df.columns:
        frp = pd.to_numeric(df["frp"], errors="coerce").fillna(0)
        df["log_frp"] = np.log1p(frp.clip(lower=0))
    else:
        df["log_frp"] = 0

    return df


# ============================================================
# CONFIDENCE ENCODING
# ============================================================

def _compute_confidence_ordinal(df: pd.DataFrame) -> pd.DataFrame:
    """Map confidence (l/n/h) to ordinal (0/1/2)."""

    if "confidence" in df.columns:
        df["confidence_ordinal"] = (
            df["confidence"]
            .astype(str)
            .str.strip()
            .str.lower()
            .map(CONFIDENCE_MAP)
            .fillna(1)  # default to nominal
            .astype(int)
        )
    elif "confidence_ordinal" not in df.columns:
        df["confidence_ordinal"] = 1

    return df


# ============================================================
# SPATIAL CLUSTERING
# ============================================================

def _compute_source_clusters(df: pd.DataFrame) -> pd.DataFrame:
    """
    Group detections into spatial source clusters using
    grid-based clustering (matching the training notebook approach).

    Creates source_cluster_id as "{grid_row}_{grid_col}".
    """
    if df.empty:
        df["source_cluster_id"] = ""
        return df

    # Grid-based clustering (matching notebook: ~1km grid cells)
    # At ~23°N latitude: 1° lat ≈ 111 km, 1° lon ≈ 102 km
    # So ~0.01° ≈ 1.1 km grid cell
    grid_size = 0.01  # ~1 km grid

    lat_grid = (df["latitude"] / grid_size).astype(int)
    lon_grid = (df["longitude"] / grid_size).astype(int)

    df["source_cluster_id"] = (
        lat_grid.astype(str) + "_" + lon_grid.astype(str)
    )

    n_clusters = df["source_cluster_id"].nunique()
    logger.info(f"Identified {n_clusters} source clusters.")
    return df


# ============================================================
# PERSISTENCE FEATURES
# ============================================================

def _compute_persistence_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Compute persistence features per source cluster:
      - n_detections_at_source: total detections at this grid cell
      - unique_days_active: number of unique dates with detections
      - days_active_span: date range span in days
    """
    if df.empty or "source_cluster_id" not in df.columns:
        df["n_detections_at_source"] = 1
        df["unique_days_active"] = 1
        df["days_active_span"] = 0
        return df

    # Ensure acq_date is datetime
    if "acq_date" in df.columns:
        df["acq_date"] = pd.to_datetime(df["acq_date"], errors="coerce")

    # Group by source cluster
    cluster_stats = df.groupby("source_cluster_id").agg(
        n_detections=("source_cluster_id", "size"),
        unique_days=(
            "acq_date",
            lambda x: x.dropna().dt.date.nunique() if hasattr(x.iloc[0] if len(x) > 0 else pd.NaT, "date") else 1,
        ),
        first_date=("acq_date", "min"),
        last_date=("acq_date", "max"),
    ).reset_index()

    # Compute days span
    cluster_stats["days_span"] = (
        (cluster_stats["last_date"] - cluster_stats["first_date"])
        .dt.days
        .fillna(0)
        .astype(int)
    )

    # Merge back
    df = df.merge(
        cluster_stats[["source_cluster_id", "n_detections",
                        "unique_days", "days_span"]],
        on="source_cluster_id",
        how="left",
    )

    df["n_detections_at_source"] = df["n_detections"].fillna(1).astype(int)
    df["unique_days_active"] = df["unique_days"].fillna(1).astype(int)
    df["days_active_span"] = df["days_span"].fillna(0).astype(int)

    # Cleanup temp columns
    df = df.drop(
        columns=["n_detections", "unique_days", "days_span",
                  "first_date", "last_date"],
        errors="ignore",
    )

    return df


# ============================================================
# EXTRACT MODEL INPUT
# ============================================================

def extract_model_input(df: pd.DataFrame) -> np.ndarray:
    """
    Extract the 18-feature matrix for XGBoost prediction.

    Parameters
    ----------
    df : pd.DataFrame
        Must contain all MODEL_FEATURES columns.

    Returns
    -------
    np.ndarray
        Feature matrix of shape (n_samples, 18).
    """
    missing = [f for f in MODEL_FEATURES if f not in df.columns]
    if missing:
        raise ValueError(f"Missing features: {missing}")

    return df[MODEL_FEATURES].values.astype(np.float32)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)

    # Test with sample data
    test_data = pd.DataFrame({
        "latitude": [23.6866, 23.7517],
        "longitude": [86.3912, 86.4168],
        "bright_ti4": [328.07, 326.49],
        "bright_ti5": [298.15, 297.15],
        "scan": [0.57, 0.57],
        "track": [0.52, 0.52],
        "frp": [6.88, 3.69],
        "confidence": ["l", "n"],
        "acq_date": ["2022-01-01", "2022-01-01"],
        "acq_time": [651, 651],
        "daynight": ["D", "D"],
        "worldcover_class": [5, 4],
    })

    result = engineer_features(test_data)
    print("Engineered features:")
    for feat in MODEL_FEATURES:
        print(f"  {feat}: {result[feat].tolist()}")
