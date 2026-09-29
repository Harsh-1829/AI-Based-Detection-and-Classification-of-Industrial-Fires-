"""
OSM Enrichment Module
=====================
Loads the OpenStreetMap GeoJSON export for Jharkhand and provides
spatial lookup to find the nearest landuse feature for each
thermal detection point.

Used to populate:
  - nearest_landuse_class
  - distance_to_landuse_m
"""

import json
import logging
from typing import Tuple, Optional
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.spatial import cKDTree

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from config import OSM_GEOJSON_PATH, EARTH_RADIUS_KM

logger = logging.getLogger(__name__)


# ============================================================
# OSM Landuse category extraction
# ============================================================

# Priority order for extracting a classification label from OSM properties
_LANDUSE_KEYS = [
    "landuse",
    "natural",
    "man_made",
    "industrial",
    "power",
    "amenity",
    "building",
]

# Mapping of raw OSM values → our classification categories
_OSM_TO_CLASS = {
    # Industrial
    "industrial": "Industrial",
    "factory": "Industrial",
    "works": "Industrial",
    "kiln": "Industrial",
    "power_plant": "Industrial",
    "plant": "Industrial",
    "generator": "Industrial",
    "refinery": "Industrial",
    "smelter": "Industrial",
    "steel": "Industrial",
    # Quarry / Mining
    "quarry": "Quarry/Mining",
    "mine": "Quarry/Mining",
    "mining": "Quarry/Mining",
    "coal": "Quarry/Mining",
    "opencast": "Quarry/Mining",
    "mineshaft": "Quarry/Mining",
    # Forest
    "forest": "Forest",
    "wood": "Forest",
    # Agricultural
    "farmland": "Agricultural",
    "farmyard": "Agricultural",
    "orchard": "Agricultural",
    "vineyard": "Agricultural",
    "meadow": "Agricultural",
    "allotments": "Agricultural",
    "crop": "Agricultural",
    # Vegetation / Scrub
    "scrub": "Vegetation/Scrub",
    "grassland": "Vegetation/Scrub",
    "heath": "Vegetation/Scrub",
    "grass": "Vegetation/Scrub",
    # Other
    "residential": "Residential",
    "commercial": "Commercial",
    "water": "Water",
    "wetland": "Wetland",
    "bare_rock": "Bare",
    "sand": "Bare",
}


class OSMEnricher:
    """
    Spatial enrichment using OSM GeoJSON data.

    Builds a KD-tree from OSM point features for fast
    nearest-neighbor lookups.
    """

    def __init__(self, geojson_path: Optional[str] = None):
        self.geojson_path = Path(geojson_path or OSM_GEOJSON_PATH)
        self._features = []
        self._coords = None
        self._tree = None
        self._classes = []
        self._names = []
        self._loaded = False

    def load(self) -> "OSMEnricher":
        """Load GeoJSON and build spatial index."""
        if self._loaded:
            return self

        logger.info(f"Loading OSM GeoJSON from {self.geojson_path}...")

        with open(self.geojson_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        coords_list = []
        classes_list = []
        names_list = []

        for feature in data.get("features", []):
            geom = feature.get("geometry", {})
            props = feature.get("properties", {})

            # Extract coordinates (handle Point geometry)
            if geom.get("type") == "Point":
                lon, lat = geom["coordinates"]
            elif geom.get("type") in ("Polygon", "MultiPolygon"):
                # Use centroid approximation for polygons
                coords_flat = _flatten_coords(geom)
                if coords_flat:
                    lon = np.mean([c[0] for c in coords_flat])
                    lat = np.mean([c[1] for c in coords_flat])
                else:
                    continue
            else:
                continue

            # Extract landuse class
            osm_class = _extract_class(props)
            name = props.get("name", "")

            coords_list.append((lat, lon))
            classes_list.append(osm_class)
            names_list.append(name)

        if not coords_list:
            logger.warning("No valid OSM features found!")
            self._loaded = True
            return self

        self._coords = np.array(coords_list)
        self._classes = classes_list
        self._names = names_list

        # Build KD-tree using lat/lon (approximate, good enough for ~1km)
        # Convert to radians for haversine-compatible tree
        coords_rad = np.radians(self._coords)
        self._tree = cKDTree(coords_rad)

        self._loaded = True
        logger.info(
            f"Loaded {len(self._coords)} OSM features. "
            f"KD-tree built."
        )
        return self

    def enrich(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Add nearest_landuse_class and distance_to_landuse_m columns.

        Parameters
        ----------
        df : pd.DataFrame
            Must contain 'latitude' and 'longitude' columns.

        Returns
        -------
        pd.DataFrame
            With added 'nearest_landuse_class' and 'distance_to_landuse_m'.
        """
        if not self._loaded:
            self.load()

        if self._tree is None or len(self._coords) == 0:
            df["nearest_landuse_class"] = "No OSM match"
            df["distance_to_landuse_m"] = 0.0
            return df

        # Query points
        points = df[["latitude", "longitude"]].values
        points_rad = np.radians(points)

        # KD-tree query (returns distances in radians)
        distances_rad, indices = self._tree.query(points_rad, k=1)

        # Convert radian distance to meters (haversine approximation)
        distances_m = distances_rad * EARTH_RADIUS_KM * 1000.0

        # Assign results
        df["nearest_landuse_class"] = [
            self._classes[i] if i < len(self._classes) else "No OSM match"
            for i in indices
        ]
        df["distance_to_landuse_m"] = np.round(distances_m, 1)
        df["nearest_osm_name"] = [
            self._names[i] if i < len(self._names) else ""
            for i in indices
        ]

        logger.info(f"Enriched {len(df)} detections with OSM data.")
        return df

    def get_all_features_geojson(self) -> dict:
        """
        Return all OSM features as a GeoJSON FeatureCollection
        for dashboard overlay.
        """
        if not self._loaded:
            self.load()

        features = []
        for i, (lat, lon) in enumerate(self._coords):
            features.append({
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [float(lon), float(lat)],
                },
                "properties": {
                    "class": self._classes[i],
                    "name": self._names[i],
                },
            })

        return {
            "type": "FeatureCollection",
            "features": features,
        }


# ============================================================
# HELPERS
# ============================================================

def _extract_class(properties: dict) -> str:
    """Extract a landuse classification from OSM properties."""
    for key in _LANDUSE_KEYS:
        value = properties.get(key, "")
        if value:
            # Check direct mapping
            mapped = _OSM_TO_CLASS.get(value.lower(), "")
            if mapped:
                return mapped
            # Check if any keyword matches
            value_lower = value.lower()
            for keyword, cls in _OSM_TO_CLASS.items():
                if keyword in value_lower:
                    return cls

    # Check resource field (common for mining features)
    resource = properties.get("resource", "").lower()
    if resource in ("coal", "iron", "bauxite", "limestone", "copper"):
        return "Quarry/Mining"

    # Check operator field for known industrial operators
    operator = properties.get("operator", "").lower()
    if any(kw in operator for kw in ("coal", "mining", "steel", "power")):
        return "Industrial"

    return "No OSM match"


def _flatten_coords(geometry: dict) -> list:
    """Flatten polygon coordinates into a list of [lon, lat] pairs."""
    coords = geometry.get("coordinates", [])
    result = []

    def _recurse(obj):
        if (
            isinstance(obj, (list, tuple))
            and len(obj) >= 2
            and isinstance(obj[0], (int, float))
        ):
            result.append(obj[:2])
        elif isinstance(obj, (list, tuple)):
            for item in obj:
                _recurse(item)

    _recurse(coords)
    return result


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    enricher = OSMEnricher()
    enricher.load()
    print(f"Loaded {len(enricher._coords)} features")

    # Test with a sample point (Dhanbad coal area)
    test_df = pd.DataFrame({
        "latitude": [23.7958, 23.6866],
        "longitude": [86.4305, 86.3912],
    })
    result = enricher.enrich(test_df)
    print(result[["latitude", "longitude", "nearest_landuse_class",
                   "distance_to_landuse_m", "nearest_osm_name"]])
