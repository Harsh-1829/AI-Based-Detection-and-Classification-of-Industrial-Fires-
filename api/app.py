"""
FastAPI Server — Thermal Anomaly Classification & GIS Backend
============================================================
Provides REST API endpoints for:
- Classified thermal detections (GeoJSON)
- Persistent source clusters
- Real-time NASA FIRMS ingestion + XGBoost inference
- OSM infrastructure layers
- Model metadata & analytics
- Static GIS Dashboard hosting
"""

import json
import logging
from datetime import datetime
from pathlib import Path
from typing import List, Optional

import pandas as pd
from fastapi import BackgroundTasks, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from config import (
    BASE_DIR,
    CLASS_COLORS,
    CLASS_ICONS,
    JHARKHAND_BBOX,
    JHARKHAND_CENTER,
    MODEL_CLASSES,
    MODEL_FEATURES,
    OSM_GEOJSON_PATH,
)
from api.database import get_db, ThermalDatabase
from pipeline.classifier import get_classifier, ThermalClassifier
from data_ingestion.firms_client import FIRMSClient
from data_ingestion.osm_enrichment import OSMEnricher
from data_ingestion.landcover_enrichment import LandCoverEnricher
from pipeline.feature_engineer import engineer_features

logger = logging.getLogger("api")
logging.basicConfig(level=logging.INFO)

# Initialize FastAPI
app = FastAPI(
    title="Thermal Anomaly Classification GIS API",
    description="AI-enabled geospatial system for industrial fire and thermal anomaly classification using XGBoost Model B and NASA FIRMS.",
    version="1.0.0",
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Shared in-memory singletons
db = get_db()
classifier = get_classifier()

osm_enricher = OSMEnricher()
landcover_enricher = LandCoverEnricher()
firms_client = FIRMSClient()
JHARKHAND_BOUNDARY_PATH = BASE_DIR / "data" / "jharkhand_boundary.geojson"
_jharkhand_prep_poly = None

def get_jharkhand_prep_poly():
    global _jharkhand_prep_poly
    if _jharkhand_prep_poly is None and JHARKHAND_BOUNDARY_PATH.exists():
        import shapely.geometry, shapely.prepared
        with open(JHARKHAND_BOUNDARY_PATH, "r", encoding="utf-8") as f:
            b_data = json.load(f)
        poly = shapely.geometry.shape(b_data["features"][0]["geometry"])
        _jharkhand_prep_poly = shapely.prepared.prep(poly)
    return _jharkhand_prep_poly

def filter_by_jharkhand_polygon(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df
    prep_poly = get_jharkhand_prep_poly()
    if prep_poly is None:
        return df
    import shapely.geometry
    mask = [
        prep_poly.contains(shapely.geometry.Point(row["longitude"], row["latitude"]))
        for _, row in df.iterrows()
    ]
    return df[mask].reset_index(drop=True)


# ============================================================
# PYDANTIC SCHEMAS
# ============================================================

class CustomDetectionRequest(BaseModel):
    latitude: float = Field(..., example=23.7958)
    longitude: float = Field(..., example=86.4305)
    bright_ti4: float = Field(325.0, example=330.5)
    bright_ti5: float = Field(298.0, example=299.2)
    scan: float = Field(0.5, example=0.48)
    track: float = Field(0.5, example=0.45)
    frp: float = Field(5.0, example=12.4)
    confidence: str = Field("n", example="h")
    acq_date: Optional[str] = Field(None, example="2026-09-12")
    acq_time: Optional[int] = Field(630, example=700)
    daynight: Optional[str] = Field("D", example="D")


# ============================================================
# API ENDPOINTS
# ============================================================

@app.get("/api/health")
def health_check():
    """System health check and status."""
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "database_records": len(db._df) if db._initialized else 0,
        "model_loaded": classifier._loaded,
    }


@app.get("/api/stats")
def get_stats():
    """Return summary statistics for the dashboard."""
    stats = db.get_statistics()
    stats["class_colors"] = CLASS_COLORS
    stats["class_icons"] = CLASS_ICONS
    stats["map_center"] = JHARKHAND_CENTER
    stats["bbox"] = JHARKHAND_BBOX
    return stats


@app.get("/api/detections")
def get_detections(
    class_name: Optional[str] = Query(None, description="Filter by fire/thermal class"),
    min_confidence: float = Query(0.0, ge=0.0, le=1.0, description="Minimum prediction confidence"),
    start_date: Optional[str] = Query(None, description="Start date (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="End date (YYYY-MM-DD)"),
    min_frp: Optional[float] = Query(None, ge=0.0, description="Minimum FRP (MW)"),
    daynight: Optional[str] = Query(None, pattern="^[DNdn]$", description="D for Day, N for Night"),
    min_lon: Optional[float] = None,
    min_lat: Optional[float] = None,
    max_lon: Optional[float] = None,
    max_lat: Optional[float] = None,
    limit: int = Query(2500, ge=1, le=15000, description="Max detections to return"),
    offset: int = Query(0, ge=0),
):
    """
    Get classified thermal detections in GeoJSON FeatureCollection format.
    Optimized for Leaflet rendering.
    """
    bbox = None
    if all(v is not None for v in [min_lon, min_lat, max_lon, max_lat]):
        bbox = [min_lon, min_lat, max_lon, max_lat]

    filtered_df = db.query(
        class_name=class_name,
        min_confidence=min_confidence,
        start_date=start_date,
        end_date=end_date,
        min_frp=min_frp,
        daynight=daynight,
        bbox=bbox,
        limit=limit,
        offset=offset,
    )

    geojson = db.to_geojson(filtered_df)
    geojson["metadata"] = {
        "count": len(filtered_df),
        "total_in_db": len(db._df),
        "limit": limit,
        "offset": offset,
    }
    return geojson


@app.get("/api/sources")
def get_persistent_sources(
    min_detections: int = Query(3, ge=1, description="Minimum repeated detections"),
    limit: int = Query(150, ge=1, le=1000),
):
    """
    Get persistent thermal source clusters (industrial flares, quarries, recurring burn sites).
    """
    sources_df = db.get_sources(min_detections=min_detections, limit=limit)
    if sources_df.empty:
        return {"type": "FeatureCollection", "features": []}

    features = []
    for _, row in sources_df.iterrows():
        dom_class = str(row["dominant_class"])
        color = CLASS_COLORS.get(dom_class, "#ef4444")

        features.append({
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [round(float(row["longitude"]), 5), round(float(row["latitude"]), 5)],
            },
            "properties": {
                "source_cluster_id": str(row["source_cluster_id"]),
                "dominant_class": dom_class,
                "color": color,
                "detection_count": int(row["detection_count"]),
                "avg_frp": round(float(row["avg_frp"]), 2),
                "max_frp": round(float(row["max_frp"]), 2),
                "avg_confidence": round(float(row["avg_confidence"]), 4),
                "first_seen": str(row["first_seen"]),
                "last_seen": str(row["last_seen"]),
                "active_days": int(row["active_days"]),
            },
        })

    return {
        "type": "FeatureCollection",
        "features": features,
        "metadata": {"count": len(features)},
    }


@app.get("/api/model/info")
def get_model_info():
    """Get metadata, metrics, and feature list for XGBoost Model B."""
    return classifier.get_model_info()


@app.get("/api/osm/features")
def get_osm_features(
    feature_type: Optional[str] = Query(None, description="quarry, forest, industrial, etc."),
    limit: int = Query(2000, ge=1, le=10000),
):
    """
    Return OSM infrastructure features (GeoJSON) from export.geojson for overlay.
    """
    if not OSM_GEOJSON_PATH.exists():
        raise HTTPException(status_code=404, detail="OSM export.geojson file not found")

    with open(OSM_GEOJSON_PATH, "r", encoding="utf-8") as f:
        osm_data = json.load(f)

    features = osm_data.get("features", [])
    if feature_type:
        features = [
            feat for feat in features
            if feat.get("properties", {}).get("landuse") == feature_type
            or feat.get("properties", {}).get("natural") == feature_type
        ]

    features = features[:limit]
    return {
        "type": "FeatureCollection",
        "features": features,
        "metadata": {"returned": len(features)},
    }


@app.get("/api/boundary")
def get_jharkhand_boundary():
    """Return official Jharkhand state boundary GeoJSON."""
    if not JHARKHAND_BOUNDARY_PATH.exists():
        raise HTTPException(status_code=404, detail="Jharkhand boundary GeoJSON not found")
    with open(JHARKHAND_BOUNDARY_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


@app.post("/api/fetch-firms")
def fetch_firms_live(
    days: int = Query(1, ge=1, le=10, description="Number of days to query (1-10)"),
    source: str = Query("VIIRS_NOAA21_NRT", description="VIIRS_NOAA21_NRT, VIIRS_SNPP_NRT, VIIRS_NOAA20_NRT, etc."),
):
    """
    Trigger live NASA FIRMS API pull, enrich with OSM + LandCover,
    engineer features, run XGBoost Model B inference, and save into database.
    """
    logger.info(f"Triggering FIRMS live fetch for {days} days from {source}...")
    try:
        raw_df = firms_client.fetch_area(days=days, source=source)
        raw_df = filter_by_jharkhand_polygon(raw_df)
    except Exception as e:
        logger.error(f"FIRMS fetch failed: {e}")
        raise HTTPException(status_code=502, detail=f"NASA FIRMS API error: {str(e)}")

    if raw_df.empty:
        return {
            "status": "success",
            "message": f"FIRMS API queried successfully, but 0 thermal anomalies detected in Jharkhand for the past {days} day(s).",
            "new_detections_count": 0,
        }

    # Step 1: Enrich with LandCover
    enriched_df = landcover_enricher.enrich(raw_df)

    # Step 2: Enrich with OSM
    enriched_df = osm_enricher.enrich(enriched_df)

    # Step 3: Run XGBoost classification pipeline
    classified_df = classifier.classify_raw(enriched_df, historical_df=db._df)

    # Step 4: Add to database
    db.add_detections(classified_df, save_now=True)

    return {
        "status": "success",
        "message": f"Successfully ingested and classified {len(classified_df)} new detections from NASA FIRMS ({source}).",
        "new_detections_count": len(classified_df),
        "class_summary": classified_df["predicted_class"].value_counts().to_dict(),
        "sample": db.to_geojson(classified_df.head(5)),
    }


@app.get("/api/detections/realtime")
def get_realtime_detections(
    days: int = Query(5, ge=1, le=5, description="Number of days to query (1-5)"),
    source: str = Query("VIIRS_NOAA21_NRT", description="Satellite data source (VIIRS_NOAA21_NRT)"),
):
    """
    Directly query NASA FIRMS URT for real-time detections, enrich with LandCover + OSM,
    classify with XGBoost Model B, and return GeoJSON of ONLY the real-time anomalies.
    """
    logger.info(f"Querying real-time FIRMS detections: {days} days from {source}...")
    try:
        raw_df = firms_client.fetch_area(days=days, source=source)
        raw_df = filter_by_jharkhand_polygon(raw_df)
    except Exception as e:
        logger.error(f"Real-time FIRMS fetch failed: {e}")
        raise HTTPException(status_code=502, detail=f"NASA FIRMS API error: {str(e)}")

    if raw_df.empty:
        return {
            "type": "FeatureCollection",
            "features": [],
            "metadata": {
                "count": 0,
                "days": days,
                "source": source,
                "message": f"0 active thermal anomalies detected in Jharkhand in the past {days} day(s).",
                "timestamp": datetime.utcnow().isoformat(),
            },
        }

    # Enrich with LandCover & OSM
    enriched_df = landcover_enricher.enrich(raw_df)
    enriched_df = osm_enricher.enrich(enriched_df)

    # Classify with Model B
    classified_df = classifier.classify_raw(enriched_df, historical_df=db._df)

    # Convert to GeoJSON
    geojson = db.to_geojson(classified_df)
    geojson["metadata"] = {
        "count": len(classified_df),
        "days": days,
        "source": source,
        "class_summary": classified_df["predicted_class"].value_counts().to_dict(),
        "timestamp": datetime.utcnow().isoformat(),
        "message": f"Successfully retrieved {len(classified_df)} real-time thermal anomalies from NASA FIRMS.",
    }
    return geojson


@app.post("/api/classify-point")
def classify_custom_point(req: CustomDetectionRequest):
    """
    Classify a single custom observation or hypothetical thermal anomaly.
    Enriches with LandCover and OSM automatically, then runs XGBoost Model B inference.
    """
    point_dict = req.dict()
    if not point_dict.get("acq_date"):
        point_dict["acq_date"] = datetime.utcnow().strftime("%Y-%m-%d")

    df = pd.DataFrame([point_dict])

    # Enrich
    df = landcover_enricher.enrich(df)
    df = osm_enricher.enrich(df)

    # Classify
    classified = classifier.classify_raw(df, historical_df=db._df)

    row = classified.iloc[0].to_dict()
    result = {
        "latitude": row.get("latitude"),
        "longitude": row.get("longitude"),
        "predicted_class": row.get("predicted_class"),
        "prediction_confidence": row.get("prediction_confidence"),
        "probabilities": {
            cls: float(row.get(f"prob_{cls.lower().replace(' ', '_').replace('/', '_').replace('(', '').replace(')', '')}", 0.0))
            for cls in MODEL_CLASSES
        },
        "color": CLASS_COLORS.get(row.get("predicted_class"), "#ef4444"),
        "worldcover_name": row.get("worldcover_name", "Unknown"),
        "nearest_osm_name": row.get("nearest_osm_name", "None"),
        "nearest_osm_type": row.get("nearest_osm_type", "None"),
        "distance_to_landuse_m": row.get("distance_to_landuse_m", 0.0),
    }
    return result


# ============================================================
# STATIC DASHBOARD MOUNTING
# ============================================================

DASHBOARD_DIR = BASE_DIR / "dashboard"
if DASHBOARD_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(DASHBOARD_DIR)), name="static")

    @app.get("/")
    def serve_dashboard():
        index_path = DASHBOARD_DIR / "index.html"
        if index_path.exists():
            return FileResponse(index_path)
        return {"message": "Dashboard UI is being built. Visit /docs for API documentation."}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api.app:app", host="0.0.0.0", port=8000, reload=False)
