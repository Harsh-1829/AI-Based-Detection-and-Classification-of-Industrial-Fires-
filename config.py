"""
SIH WIN — Central Configuration
Thermal Anomaly Classification & GIS Dashboard
"""

import os
from pathlib import Path

# ============================================================
# PATHS
# ============================================================
BASE_DIR = Path(__file__).resolve().parent

# Data files
FIRMS_MODEL_PATH = BASE_DIR / "jharkhand_viirs_MODEL_B.json"
MODEL_METADATA_PATH = BASE_DIR / "jharkhand_viirs_MODEL_B_metadata.json"
OSM_GEOJSON_PATH = BASE_DIR / "export.geojson"
LANDCOVER_TIF_PATH = BASE_DIR / "jharkhand_landcover.tif"
NASA_ENV_PATH = BASE_DIR / "nasa.env"

# Existing CSV data
CSV_TEST_PREDICTIONS = BASE_DIR / "jh_viirs_2022_test_predictions_MODEL_B.csv"
CSV_UNCLASSIFIED = BASE_DIR / "jh_viirs_2022_unclassified_CLASSIFIED_MODEL_B.csv"
CSV_TRAIN_2021 = BASE_DIR / "jh_viirs_train_2021_labeled.csv"

# Output directories
DATA_DIR = BASE_DIR / "data"
CLASSIFIED_DIR = DATA_DIR / "classified"
CACHE_DIR = DATA_DIR / "cache"

# Ensure output directories exist
CLASSIFIED_DIR.mkdir(parents=True, exist_ok=True)
CACHE_DIR.mkdir(parents=True, exist_ok=True)

# ============================================================
# NASA FIRMS API
# ============================================================
NASA_FIRMS_API_KEY = "b69e88b318d87df2a9a6374d99c1012f"
GOOGLE_MAPS_API_KEY = "AIzaSyDIaBUtw8BvmtVZ2yBN4hmHXcEJZzUsHbk"

# FIRMS API base URLs
FIRMS_BASE_URL = "https://firms.modaps.eosdis.nasa.gov/api/area/csv"
FIRMS_MAP_KEY = NASA_FIRMS_API_KEY

# Data sources available via FIRMS
FIRMS_SOURCES = {
    "VIIRS_NOAA21": "VIIRS_NOAA21_NRT",
    "VIIRS_SNPP": "VIIRS_SNPP_NRT",
    "VIIRS_NOAA20": "VIIRS_NOAA20_NRT",
    "MODIS": "MODIS_NRT",
}
DEFAULT_FIRMS_SOURCE = "VIIRS_NOAA21_NRT"

# ============================================================
# JHARKHAND BOUNDING BOX
# ============================================================
JHARKHAND_BBOX = {
    "south": 21.95,
    "north": 25.35,
    "west": 83.30,
    "east": 87.95,
}
JHARKHAND_BBOX_STR = f"{JHARKHAND_BBOX['west']},{JHARKHAND_BBOX['south']},{JHARKHAND_BBOX['east']},{JHARKHAND_BBOX['north']}"

# Map center for dashboard
JHARKHAND_CENTER = {
    "lat": 23.65,
    "lon": 85.60,
}
DEFAULT_ZOOM = 7

# ============================================================
# XGBOOST MODEL B — CONFIGURATION
# ============================================================
MODEL_FEATURES = [
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

MODEL_CLASSES = [
    "Agricultural burning",
    "Forest fire",
    "Industrial",
    "Quarry/Mining",
    "Vegetation fire (open/scrub)",
]

# Class-to-index mapping
CLASS_TO_IDX = {cls: idx for idx, cls in enumerate(MODEL_CLASSES)}
IDX_TO_CLASS = {idx: cls for idx, cls in enumerate(MODEL_CLASSES)}

# ============================================================
# CONFIDENCE MAPPING
# ============================================================
CONFIDENCE_MAP = {
    "l": 0,   # low
    "n": 1,   # nominal
    "h": 2,   # high
}

# ============================================================
# ESA WORLDCOVER CLASS MAPPING
# ============================================================
# ESA WorldCover 10m v200 class codes
WORLDCOVER_CLASSES = {
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

# Numeric encoding used by the model
WORLDCOVER_NUMERIC = {
    "Tree cover": 0,
    "Shrubland": 1,
    "Grassland": 2,
    "Cropland": 3,
    "Built-up": 4,
    "Bare/sparse vegetation": 5,
    "Snow and ice": 6,
    "Permanent water bodies": 7,
    "Herbaceous wetland": 8,
    "Mangroves": 9,
    "Moss and lichen": 10,
    "Unknown": -1,
}

# ============================================================
# SPATIAL CLUSTERING (DBSCAN)
# ============================================================
DBSCAN_EPS_KM = 1.0          # 1 km radius for source grouping
DBSCAN_MIN_SAMPLES = 1       # minimum 1 detection per source
EARTH_RADIUS_KM = 6371.0     # for haversine distance

# ============================================================
# DASHBOARD VISUALIZATION
# ============================================================
CLASS_COLORS = {
    "Industrial":                   "#ef4444",  # Red
    "Forest fire":                  "#22c55e",  # Green
    "Quarry/Mining":                "#f97316",  # Orange
    "Agricultural burning":         "#eab308",  # Yellow
    "Vegetation fire (open/scrub)": "#a855f7",  # Purple
}

CLASS_ICONS = {
    "Industrial":                   "🏭",
    "Forest fire":                  "🌲🔥",
    "Quarry/Mining":                "⛏️",
    "Agricultural burning":         "🌾",
    "Vegetation fire (open/scrub)": "🔥",
}

# ============================================================
# API SERVER
# ============================================================
API_HOST = "0.0.0.0"
API_PORT = 8000
