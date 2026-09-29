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
def get_stats(
    mode: str = Query("realtime", description="realtime or baseline"),
    days: int = Query(5, ge=1, le=10),
    source: str = Query("VIIRS_NOAA21_NRT"),
    force_refresh: bool = Query(False),
):
    """Return summary statistics for the dashboard (realtime by default)."""
    if mode == "realtime":
        realtime_data = fetch_and_classify_realtime(days=days, source=source, force_refresh=force_refresh)
        meta = realtime_data.get("metadata", {})
        return {
            "mode": "realtime",
            "total_detections": meta.get("count", 0),
            "by_class": meta.get("class_summary", {}),
            "max_frp": meta.get("max_frp", 0.0),
            "avg_frp": meta.get("avg_frp", 0.0),
            "persistent_sources_count": len(meta.get("sources", [])),
            "frp_by_class": meta.get("frp_by_class", {}),
            "days": days,
            "source": source,
            "timestamp": meta.get("timestamp", datetime.utcnow().isoformat()),
            "class_colors": CLASS_COLORS,
            "class_icons": CLASS_ICONS,
            "map_center": JHARKHAND_CENTER,
            "bbox": JHARKHAND_BBOX,
        }

    stats = db.get_statistics()
    stats["mode"] = "baseline"
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
        "metadata": {"count": len(features), "mode": "baseline"},
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


@app.get("/api/weather/evaluate")
def evaluate_weather_at_point(
    latitude: float = Query(..., ge=-90.0, le=90.0),
    longitude: float = Query(..., ge=-180.0, le=180.0),
    predicted_class: Optional[str] = Query(None),
):
    """
    Evaluate real-time meteorological conditions and wildfire propagation feasibility
    using Open-Meteo live API to detect false alarms and post-monsoon suppression.
    """
    from data_ingestion.weather_client import fetch_weather_and_feasibility
    return fetch_weather_and_feasibility(latitude, longitude, predicted_class)


@app.get("/api/landcover/validate")
def validate_landcover_footprint(
    latitude: float = Query(..., ge=-90.0, le=90.0),
    longitude: float = Query(..., ge=-180.0, le=180.0),
    predicted_class: Optional[str] = Query(None),
    radius_m: int = Query(375, ge=100, le=2000, description="VIIRS pixel footprint radius in metres"),
):
    """
    Sample ESA WorldCover 10m raster pixels within the VIIRS 375m footprint
    around the given coordinate and return a land-cover composition breakdown
    with an automated validation verdict for the predicted fire class.
    """
    try:
        import rasterio
        import rasterio.transform
        import numpy as np
        import math
    except ImportError:
        raise HTTPException(status_code=500, detail="rasterio/numpy not available")

    tif_path = BASE_DIR / "jharkhand_landcover.tif"
    if not tif_path.exists():
        raise HTTPException(status_code=404, detail="Land-cover GeoTIFF not found")

    # WorldCover class codes → human labels
    WC_CLASSES = {
        10: "Tree cover",
        20: "Shrubland",
        30: "Grassland",
        40: "Cropland",
        50: "Built-up",
        60: "Bare/sparse vegetation",
        70: "Snow and ice",
        80: "Permanent water bodies",
        90: "Herbaceous wetland",
        95: "Mangroves",
        100: "Moss and lichen",
    }

    try:
        with rasterio.open(str(tif_path)) as ds:
            transform = ds.transform
            band = ds.read(1)
            rows, cols = band.shape

            # Degrees per metre approximation
            deg_lat = radius_m / 111320.0
            deg_lon = radius_m / (111320.0 * math.cos(math.radians(latitude)))

            # Pixel window covering the footprint bounding box
            r_min, c_min = rasterio.transform.rowcol(transform, longitude - deg_lon, latitude + deg_lat)
            r_max, c_max = rasterio.transform.rowcol(transform, longitude + deg_lon, latitude - deg_lat)

            r_min = max(0, int(r_min))
            r_max = min(rows - 1, int(r_max))
            c_min = max(0, int(c_min))
            c_max = min(cols - 1, int(c_max))

            # Guard: ensure valid window
            if r_min > r_max or c_min > c_max:
                r_c, c_c = rasterio.transform.rowcol(transform, longitude, latitude)
                r_min = r_max = max(0, min(rows - 1, int(r_c)))
                c_min = c_max = max(0, min(cols - 1, int(c_c)))

            window_pixels = band[r_min:r_max + 1, c_min:c_max + 1].flatten()
            total = len(window_pixels)

            if total == 0:
                raise ValueError("Empty pixel window")

            # Count each class
            pixel_counts: dict = {}
            for code, name in WC_CLASSES.items():
                count = int(np.sum(window_pixels == code))
                if count > 0:
                    pixel_counts[name] = round(count / total * 100, 1)

            # Dominant class
            dominant = max(pixel_counts, key=pixel_counts.get) if pixel_counts else "Unknown"
            forest_pct = pixel_counts.get("Tree cover", 0.0)
            buildup_pct = pixel_counts.get("Built-up", 0.0)
            bare_pct = pixel_counts.get("Bare/sparse vegetation", 0.0)
            crop_pct = pixel_counts.get("Cropland", 0.0)

    except Exception as e:
        logger.warning(f"Landcover footprint sampling failed: {e}")
        return {
            "latitude": latitude, "longitude": longitude,
            "radius_m": radius_m, "pixel_counts": {}, "dominant_class": "Unknown",
            "forest_pct": 0, "buildup_pct": 0, "bare_pct": 0,
            "verdict": "INSUFFICIENT_DATA",
            "verdict_text": "Could not sample ESA WorldCover raster for this location.",
            "verdict_color": "#94a3b8",
            "mixed_pixel_warning": False,
        }

    # ---- Automated validation logic ----
    is_mixed = forest_pct > 10 and (buildup_pct + bare_pct) > 10
    verdict = "UNVERIFIED"
    verdict_text = ""
    verdict_color = "#94a3b8"

    if predicted_class == "Forest fire":
        if forest_pct >= 60:
            verdict = "CONFIRMED_FOREST"
            verdict_text = f"✅ {forest_pct:.0f}% tree cover in 375m footprint strongly supports a forest/vegetation fire classification."
            verdict_color = "#22c55e"
        elif forest_pct >= 30:
            verdict = "PARTIAL_FOREST"
            verdict_text = f"⚠️ Mixed pixel: {forest_pct:.0f}% forest + {buildup_pct:.0f}% built-up. Possible mis-classification — industrial or mine activity may be the true source."
            verdict_color = "#f59e0b"
        else:
            verdict = "LIKELY_MISCLASSIFIED"
            verdict_text = f"🚨 Only {forest_pct:.0f}% tree cover detected. Dominant land cover is '{dominant}' ({buildup_pct:.0f}% built-up, {bare_pct:.0f}% bare). This is likely an INDUSTRIAL or MINING hotspot mis-labelled as Forest fire."
            verdict_color = "#ef4444"
    elif predicted_class == "Industrial":
        if buildup_pct + bare_pct >= 50:
            verdict = "CONFIRMED_INDUSTRIAL"
            verdict_text = f"✅ {buildup_pct:.0f}% built-up + {bare_pct:.0f}% bare/sparse land supports industrial classification."
            verdict_color = "#ef4444"
        elif forest_pct >= 40:
            verdict = "CHECK_REQUIRED"
            verdict_text = f"⚠️ Unexpectedly high forest cover ({forest_pct:.0f}%) near an industrial classification. Review OSM proximity data."
            verdict_color = "#f59e0b"
        else:
            verdict = "PLAUSIBLE"
            verdict_text = f"Dominant land-cover: '{dominant}'. Industrial classification is plausible for this mixed-use area."
            verdict_color = "#f97316"
    elif predicted_class in ("Quarry/Mining",):
        if bare_pct + buildup_pct >= 40:
            verdict = "CONFIRMED_MINING"
            verdict_text = f"✅ {bare_pct:.0f}% bare/sparse + {buildup_pct:.0f}% built-up land aligns with open-cast mining or quarry activity."
            verdict_color = "#f97316"
        else:
            verdict = "PLAUSIBLE"
            verdict_text = f"Dominant land-cover: '{dominant}'. Mining classification is plausible."
            verdict_color = "#f97316"
    elif predicted_class in ("Agricultural burning", "Vegetation fire (open/scrub)"):
        if crop_pct + pixel_counts.get("Grassland", 0) + pixel_counts.get("Shrubland", 0) >= 40:
            verdict = "CONFIRMED"
            verdict_text = f"✅ Agricultural/vegetation cover confirmed in footprint."
            verdict_color = "#eab308"
        else:
            verdict = "PLAUSIBLE"
            verdict_text = f"Dominant: '{dominant}'. Classification is plausible."
            verdict_color = "#eab308"
    else:
        verdict = "UNVERIFIED"
        verdict_text = f"Dominant land-cover in 375m footprint: '{dominant}' ({pixel_counts.get(dominant, 0):.0f}%)."
        verdict_color = "#94a3b8"

    if is_mixed:
        mixed_warning = f"Mixed-pixel boundary detected: {forest_pct:.0f}% forest / {buildup_pct:.0f}% built-up / {bare_pct:.0f}% bare coexist in footprint."
    else:
        mixed_warning = None

    return {
        "latitude": latitude,
        "longitude": longitude,
        "radius_m": radius_m,
        "total_pixels_sampled": total,
        "pixel_counts": pixel_counts,
        "dominant_class": dominant,
        "forest_pct": forest_pct,
        "buildup_pct": buildup_pct,
        "bare_pct": bare_pct,
        "crop_pct": crop_pct,
        "verdict": verdict,
        "verdict_text": verdict_text,
        "verdict_color": verdict_color,
        "mixed_pixel_warning": mixed_warning,
        "predicted_class": predicted_class,
    }


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


# In-memory realtime cache
_realtime_cache = {}
_CACHE_TTL_SECONDS = 90

def fetch_and_classify_realtime(days: int = 5, source: str = "VIIRS_NOAA21_NRT", force_refresh: bool = False) -> dict:
    """Fetch live NASA FIRMS detections, enrich, classify with Model B, and compute real-time metrics."""
    import time
    cache_key = (days, source)
    now = time.time()
    if not force_refresh and cache_key in _realtime_cache:
        cached_time, cached_data = _realtime_cache[cache_key]
        if now - cached_time < _CACHE_TTL_SECONDS:
            logger.info(f"Returning cached real-time FIRMS data for {cache_key} (age: {int(now - cached_time)}s)")
            return cached_data

    logger.info(f"Querying real-time FIRMS detections: {days} days from {source} (force_refresh={force_refresh})...")
    try:
        raw_df = firms_client.fetch_area(days=days, source=source)
        raw_df = filter_by_jharkhand_polygon(raw_df)
    except Exception as e:
        logger.error(f"Real-time FIRMS fetch failed: {e}")
        raise HTTPException(status_code=502, detail=f"NASA FIRMS API error: {str(e)}")

    if raw_df.empty:
        empty_res = {
            "type": "FeatureCollection",
            "features": [],
            "metadata": {
                "count": 0,
                "days": days,
                "source": source,
                "message": f"0 active thermal anomalies detected in Jharkhand in the past {days} day(s).",
                "timestamp": datetime.utcnow().isoformat(),
                "class_summary": {cls: 0 for cls in MODEL_CLASSES},
                "max_frp": 0.0,
                "avg_frp": 0.0,
                "sources": [],
                "frp_by_class": {},
            },
        }
        _realtime_cache[cache_key] = (now, empty_res)
        return empty_res

    # Step 1: Enrich with LandCover & OSM
    enriched_df = landcover_enricher.enrich(raw_df)
    enriched_df = osm_enricher.enrich(enriched_df)

    # Step 2: Classify with Model B
    classified_df = classifier.classify_raw(enriched_df, historical_df=db._df)

    # Step 3: Compute live hotspots & persistent clusters
    active_sources = []
    if "source_cluster_id" in classified_df.columns:
        for cid, grp in classified_df.groupby("source_cluster_id"):
            lead = grp.iloc[0]
            dom_class = str(grp["predicted_class"].mode().iloc[0] if not grp["predicted_class"].empty else "Industrial")
            active_sources.append({
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [round(float(lead["longitude"]), 5), round(float(lead["latitude"]), 5)]
                },
                "properties": {
                    "source_cluster_id": str(cid),
                    "dominant_class": dom_class,
                    "color": CLASS_COLORS.get(dom_class, "#ef4444"),
                    "detection_count": int(len(grp)),
                    "avg_frp": round(float(grp["frp"].mean()), 2) if "frp" in grp else 0.0,
                    "max_frp": round(float(grp["frp"].max()), 2) if "frp" in grp else 0.0,
                    "avg_confidence": round(float(grp["prediction_confidence"].mean()), 4) if "prediction_confidence" in grp else 0.9,
                    "first_seen": str(grp["acq_date"].min()) if "acq_date" in grp else "Today",
                    "last_seen": str(grp["acq_date"].max()) if "acq_date" in grp else "Today",
                    "active_days": int(grp["acq_date"].nunique()) if "acq_date" in grp else 1,
                    "nearest_osm_name": str(lead.get("nearest_osm_name", "Industrial Facility")),
                }
            })
        active_sources.sort(key=lambda s: (s["properties"]["detection_count"], s["properties"]["max_frp"]), reverse=True)

    max_frp = round(float(classified_df["frp"].max()), 2) if "frp" in classified_df and not classified_df["frp"].dropna().empty else 0.0
    avg_frp = round(float(classified_df["frp"].mean()), 2) if "frp" in classified_df and not classified_df["frp"].dropna().empty else 0.0

    frp_by_class = {}
    if "frp" in classified_df.columns:
        for cls, grp in classified_df.groupby("predicted_class"):
            frp_by_class[cls] = round(float(grp["frp"].mean()), 2)

    class_summary = classified_df["predicted_class"].value_counts().to_dict()
    for cls in MODEL_CLASSES:
        if cls not in class_summary:
            class_summary[cls] = 0

    # Convert to GeoJSON
    geojson = db.to_geojson(classified_df)
    geojson["metadata"] = {
        "count": len(classified_df),
        "days": days,
        "source": source,
        "class_summary": class_summary,
        "max_frp": max_frp,
        "avg_frp": avg_frp,
        "timestamp": datetime.utcnow().isoformat(),
        "message": f"Successfully retrieved {len(classified_df)} real-time thermal anomalies from NASA FIRMS ({source}).",
        "sources": active_sources[:50],
        "frp_by_class": frp_by_class,
    }

    _realtime_cache[cache_key] = (now, geojson)
    return geojson


@app.get("/api/detections/realtime")
def get_realtime_detections(
    days: int = Query(5, ge=1, le=10, description="Number of days to query (1-10)"),
    source: str = Query("VIIRS_NOAA21_NRT", description="Satellite data source (VIIRS_NOAA21_NRT)"),
    force_refresh: bool = Query(False, description="Bypass cache and force fresh pull from NASA FIRMS"),
):
    """
    Directly query NASA FIRMS URT for real-time detections, enrich with LandCover + OSM,
    classify with XGBoost Model B, and return GeoJSON of ONLY the real-time anomalies.
    """
    return fetch_and_classify_realtime(days=days, source=source, force_refresh=force_refresh)


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
