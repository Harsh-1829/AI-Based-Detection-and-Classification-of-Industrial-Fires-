"""
GeoJSON Data Store Module
==========================
Lightweight, file-backed geospatial data store for classified thermal detections
and persistent source clusters.

Eliminates need for PostgreSQL/PostGIS setup while providing fast GeoJSON
export, bounding box filtering, and spatial queries.
"""

import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from config import (
    BASE_DIR,
    CLASSIFIED_DIR,
    CSV_TEST_PREDICTIONS,
    CSV_UNCLASSIFIED,
    MODEL_CLASSES,
    CLASS_COLORS,
    JHARKHAND_BBOX,
)

logger = logging.getLogger(__name__)

DB_FILE = CLASSIFIED_DIR / "thermal_detections.geojson"
SOURCES_FILE = CLASSIFIED_DIR / "persistent_sources.geojson"


class ThermalDatabase:
    """
    In-memory and file-backed GeoJSON database for thermal detections.
    """

    def __init__(self, db_path: Optional[Path] = None):
        self.db_path = db_path or DB_FILE
        self.sources_path = SOURCES_FILE
        self._df: pd.DataFrame = pd.DataFrame()
        self._initialized = False

    def initialize(self, force_reload: bool = False):
        """Load data from GeoJSON or seed from existing prediction CSVs."""
        if self._initialized and not force_reload:
            return

        if self.db_path.exists() and not force_reload:
            logger.info(f"Loading thermal database from {self.db_path}...")
            try:
                with open(self.db_path, "r", encoding="utf-8") as f:
                    geojson_data = json.load(f)
                features = geojson_data.get("features", [])
                records = []
                for feat in features:
                    props = feat.get("properties", {})
                    coords = feat.get("geometry", {}).get("coordinates", [0, 0])
                    props["longitude"] = coords[0]
                    props["latitude"] = coords[1]
                    records.append(props)
                self._df = pd.DataFrame(records)
                logger.info(f"Loaded {len(self._df)} detections from GeoJSON database.")
                self._initialized = True
                return
            except Exception as e:
                logger.warning(f"Failed to read {self.db_path}: {e}. Seeding from CSV...")

        # Seed from CSV files
        self._seed_from_csv()
        self._initialized = True

    def _seed_from_csv(self):
        """Seed the database with existing classified model predictions."""
        dfs = []

        # 1. 2022 test predictions
        if CSV_TEST_PREDICTIONS.exists():
            logger.info(f"Seeding from {CSV_TEST_PREDICTIONS}...")
            df1 = pd.read_csv(CSV_TEST_PREDICTIONS)
            dfs.append(df1)

        # 2. 2022 unclassified classified
        if CSV_UNCLASSIFIED.exists():
            logger.info(f"Seeding from {CSV_UNCLASSIFIED}...")
            df2 = pd.read_csv(CSV_UNCLASSIFIED)
            dfs.append(df2)

        if dfs:
            combined = pd.concat(dfs, ignore_index=True)
            # Standardize columns
            if "predicted_class" not in combined.columns and "pred_class_name" in combined.columns:
                combined["predicted_class"] = combined["pred_class_name"]

            # Drop duplicates based on location and timestamp
            dedup_cols = [c for c in ["latitude", "longitude", "acq_date", "acq_time"] if c in combined.columns]
            if dedup_cols:
                combined = combined.drop_duplicates(subset=dedup_cols)

            # Filter to strictly inside Jharkhand boundary polygon
            boundary_file = BASE_DIR / "data" / "jharkhand_boundary.geojson"
            if boundary_file.exists():
                try:
                    import shapely.geometry, shapely.prepared
                    with open(boundary_file, "r", encoding="utf-8") as bf:
                        b_data = json.load(bf)
                    poly = shapely.geometry.shape(b_data["features"][0]["geometry"])
                    prep_poly = shapely.prepared.prep(poly)
                    mask = [
                        prep_poly.contains(shapely.geometry.Point(row["longitude"], row["latitude"]))
                        for _, row in combined.iterrows()
                    ]
                    combined = combined[mask].reset_index(drop=True)
                except Exception as e:
                    logger.warning(f"Boundary polygon filter failed: {e}")

            self._df = combined
            logger.info(f"Seeded database with {len(self._df)} detections strictly inside Jharkhand.")
            self.save()
        else:
            logger.warning("No seed CSV files found. Initializing empty database.")
            self._df = pd.DataFrame()

    def save(self):
        """Save in-memory detections to GeoJSON file."""
        if self._df.empty:
            return

        geojson = self.to_geojson(self._df)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.db_path, "w", encoding="utf-8") as f:
            json.dump(geojson, f, indent=2)
        logger.info(f"Saved {len(self._df)} detections to {self.db_path}.")

    def add_detections(self, new_df: pd.DataFrame, save_now: bool = True):
        """
        Append new detections to the database, deduplicating records.
        """
        self.initialize()
        if new_df.empty:
            return

        if self._df.empty:
            self._df = new_df.copy()
        else:
            combined = pd.concat([self._df, new_df], ignore_index=True)
            if "acq_date" in combined.columns:
                combined["acq_date"] = combined["acq_date"].astype(str).str.split(" ").str[0]
            dedup_cols = [c for c in ["latitude", "longitude", "acq_date", "acq_time"] if c in combined.columns]
            if dedup_cols:
                combined = combined.drop_duplicates(subset=dedup_cols, keep="last")
            self._df = combined

        if "acq_date" in self._df.columns:
            self._df["acq_date"] = self._df["acq_date"].astype(str).str.split(" ").str[0]

        if save_now:
            self.save()

    def query(
        self,
        class_name: Optional[str] = None,
        min_confidence: float = 0.0,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        min_frp: Optional[float] = None,
        daynight: Optional[str] = None,
        bbox: Optional[List[float]] = None,
        limit: int = 1000,
        offset: int = 0,
    ) -> pd.DataFrame:
        """
        Filter detections by class, confidence, date range, FRP, and spatial bbox.
        """
        self.initialize()
        if self._df.empty:
            return pd.DataFrame()

        df = self._df.copy()

        # Class filter
        if class_name and class_name.lower() != "all":
            if "predicted_class" in df.columns:
                df = df[df["predicted_class"].str.lower() == class_name.lower()]

        # Confidence filter
        if min_confidence > 0:
            if "prediction_confidence" in df.columns:
                df = df[df["prediction_confidence"] >= min_confidence]

        # Date range filter
        if "acq_date" in df.columns:
            if start_date:
                df = df[df["acq_date"] >= start_date]
            if end_date:
                df = df[df["acq_date"] <= end_date]

        # FRP filter
        if min_frp is not None and "frp" in df.columns:
            df = df[df["frp"] >= min_frp]

        # Day/Night filter
        if daynight and "daynight" in df.columns:
            df = df[df["daynight"] == daynight.upper()]

        # Bounding box filter: [min_lon, min_lat, max_lon, max_lat]
        if bbox and len(bbox) == 4 and "latitude" in df.columns and "longitude" in df.columns:
            min_lon, min_lat, max_lon, max_lat = bbox
            df = df[
                (df["longitude"] >= min_lon)
                & (df["longitude"] <= max_lon)
                & (df["latitude"] >= min_lat)
                & (df["latitude"] <= max_lat)
            ]

        # Sort by date descending if available
        if "acq_date" in df.columns:
            sort_cols = ["acq_date"]
            if "acq_time" in df.columns:
                sort_cols.append("acq_time")
            df = df.sort_values(by=sort_cols, ascending=False)

        # Slice limit/offset
        total_matched = len(df)
        if offset > 0:
            df = df.iloc[offset:]
        if limit > 0:
            df = df.iloc[:limit]

        return df

    def get_statistics(self) -> Dict[str, Any]:
        """Compute aggregate statistics for the dashboard."""
        self.initialize()
        if self._df.empty:
            return {
                "total_detections": 0,
                "by_class": {},
                "avg_frp": 0.0,
                "max_frp": 0.0,
                "date_min": None,
                "date_max": None,
                "persistent_sources_count": 0,
            }

        df = self._df

        # Class counts
        by_class = {}
        if "predicted_class" in df.columns:
            counts = df["predicted_class"].value_counts().to_dict()
            for cls in MODEL_CLASSES:
                by_class[cls] = int(counts.get(cls, 0))
            for k, v in counts.items():
                if k not in by_class:
                    by_class[k] = int(v)

        # FRP statistics
        avg_frp = float(df["frp"].mean()) if "frp" in df.columns else 0.0
        max_frp = float(df["frp"].max()) if "frp" in df.columns else 0.0

        # Date range
        date_min, date_max = None, None
        if "acq_date" in df.columns and not df["acq_date"].empty:
            dates = df["acq_date"].dropna().astype(str).str.split(" ").str[0]
            if not dates.empty:
                date_min = str(dates.min())
                date_max = str(dates.max())

        # Persistent sources count
        persistent_count = 0
        if "n_detections_at_source" in df.columns:
            persistent_count = int((df["n_detections_at_source"] >= 3).sum())
        elif "source_cluster_id" in df.columns:
            source_sizes = df["source_cluster_id"].value_counts()
            persistent_count = int((source_sizes >= 3).count())

        # Confidence breakdown
        conf_breakdown = {}
        if "prediction_confidence" in df.columns:
            conf_breakdown["high (>=0.8)"] = int((df["prediction_confidence"] >= 0.8).sum())
            conf_breakdown["medium (0.5-0.8)"] = int(((df["prediction_confidence"] >= 0.5) & (df["prediction_confidence"] < 0.8)).sum())
            conf_breakdown["low (<0.5)"] = int((df["prediction_confidence"] < 0.5).sum())

        return {
            "total_detections": len(df),
            "by_class": by_class,
            "avg_frp": round(avg_frp, 2),
            "max_frp": round(max_frp, 2),
            "date_range": {"min": date_min, "max": date_max},
            "persistent_sources_count": persistent_count,
            "confidence_breakdown": conf_breakdown,
        }

    def get_sources(self, min_detections: int = 3, limit: int = 100) -> pd.DataFrame:
        """
        Group detections by persistent thermal source cluster.
        """
        self.initialize()
        if self._df.empty or "source_cluster_id" not in self._df.columns:
            return pd.DataFrame()

        df = self._df.copy()
        # Drop invalid or empty cluster ids
        df = df[df["source_cluster_id"].notna()]
        df = df[~df["source_cluster_id"].astype(str).isin(["", "-1", "-1.0", "nan", "None"])]
        if df.empty:
            return pd.DataFrame()

        df["latitude"] = pd.to_numeric(df["latitude"], errors="coerce")
        df["longitude"] = pd.to_numeric(df["longitude"], errors="coerce")
        if "frp" in df.columns:
            df["frp"] = pd.to_numeric(df["frp"], errors="coerce").fillna(0.0)
        else:
            df["frp"] = 0.0

        if "prediction_confidence" in df.columns:
            df["prediction_confidence"] = pd.to_numeric(df["prediction_confidence"], errors="coerce").fillna(0.5)
        else:
            df["prediction_confidence"] = 0.5

        if "acq_date" in df.columns:
            df["acq_date"] = df["acq_date"].astype(str).str.split(" ").str[0]
        else:
            df["acq_date"] = "2022-01-01"

        grouped = df.groupby("source_cluster_id").agg({
            "latitude": "mean",
            "longitude": "mean",
            "frp": ["count", "mean", "max"],
            "predicted_class": lambda s: s.mode()[0] if not s.empty else "Unknown",
            "prediction_confidence": "mean",
            "acq_date": ["min", "max", "nunique"],
        })

        grouped.columns = [
            "latitude", "longitude", "detection_count",
            "avg_frp", "max_frp", "dominant_class",
            "avg_confidence", "first_seen", "last_seen", "active_days"
        ]
        grouped = grouped.reset_index()

        # Filter by min detections
        grouped = grouped[grouped["detection_count"] >= min_detections]
        grouped = grouped.sort_values(by="detection_count", ascending=False)

        if limit > 0:
            grouped = grouped.head(limit)

        return grouped

    @staticmethod
    def to_geojson(df: pd.DataFrame) -> Dict[str, Any]:
        """Convert a DataFrame of detections to GeoJSON FeatureCollection."""
        features = []
        if df.empty:
            return {"type": "FeatureCollection", "features": []}

        for idx, row in df.iterrows():
            lon = float(row.get("longitude", 0.0))
            lat = float(row.get("latitude", 0.0))

            pred_class = str(row.get("predicted_class", "Unknown"))
            color = CLASS_COLORS.get(pred_class, "#9ca3af")

            props = {}
            for col, val in row.items():
                if col in ["latitude", "longitude"]:
                    continue
                if pd.isna(val):
                    props[col] = None
                elif isinstance(val, (np.integer, int)):
                    props[col] = int(val)
                elif isinstance(val, (np.floating, float)):
                    props[col] = round(float(val), 4)
                else:
                    props[col] = str(val)

            props["color"] = color

            features.append({
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [round(lon, 5), round(lat, 5)],
                },
                "properties": props,
            })

        return {
            "type": "FeatureCollection",
            "features": features,
        }


# Singleton database instance
_db_instance: Optional[ThermalDatabase] = None


def get_db() -> ThermalDatabase:
    """Get or create singleton ThermalDatabase instance."""
    global _db_instance
    if _db_instance is None:
        _db_instance = ThermalDatabase()
        _db_instance.initialize()
    return _db_instance


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    db = get_db()
    stats = db.get_statistics()
    print("Database Statistics:")
    print(json.dumps(stats, indent=2))
