"""
Land Cover Enrichment Module
=============================
Reads the ESA WorldCover GeoTIFF for Jharkhand and extracts
the land cover class at each thermal detection coordinate.

Used to populate:
  - worldcover_class (numeric encoding for model input)
"""

import logging
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from config import (
    LANDCOVER_TIF_PATH,
    WORLDCOVER_CLASSES,
    WORLDCOVER_NUMERIC,
)

logger = logging.getLogger(__name__)


class LandCoverEnricher:
    """
    Extracts WorldCover land cover class for each detection point
    from the Jharkhand GeoTIFF raster.
    """

    def __init__(self, tif_path: Optional[str] = None):
        self.tif_path = Path(tif_path or LANDCOVER_TIF_PATH)
        self._dataset = None
        self._band = None
        self._transform = None
        self._loaded = False

    def load(self) -> "LandCoverEnricher":
        """Load the GeoTIFF raster."""
        if self._loaded:
            return self

        try:
            import rasterio
        except ImportError:
            logger.error(
                "rasterio is required for land cover enrichment. "
                "Install with: pip install rasterio"
            )
            self._loaded = True
            return self

        if not self.tif_path.exists():
            logger.warning(
                f"Land cover TIF not found: {self.tif_path}. "
                "Skipping land cover enrichment."
            )
            self._loaded = True
            return self

        logger.info(f"Loading WorldCover raster from {self.tif_path}...")
        self._dataset = rasterio.open(str(self.tif_path))
        self._band = self._dataset.read(1)
        self._transform = self._dataset.transform

        logger.info(
            f"Raster loaded: {self._band.shape}, "
            f"CRS={self._dataset.crs}, "
            f"Bounds={self._dataset.bounds}"
        )
        self._loaded = True
        return self

    def enrich(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Add worldcover_class column (numeric) to the DataFrame.

        Parameters
        ----------
        df : pd.DataFrame
            Must contain 'latitude' and 'longitude' columns.

        Returns
        -------
        pd.DataFrame
            With 'worldcover_class' (numeric) and 'worldcover_name' columns.
        """
        if not self._loaded:
            self.load()

        if self._dataset is None or self._band is None:
            # Fallback: no raster available
            df["worldcover_class"] = 0
            df["worldcover_name"] = "Unknown"
            return df

        import rasterio

        wc_codes = []
        wc_names = []

        for _, row in df.iterrows():
            lat = row["latitude"]
            lon = row["longitude"]

            try:
                # Convert lat/lon to raster pixel coordinates
                row_idx, col_idx = rasterio.transform.rowcol(
                    self._transform, lon, lat
                )

                # Bounds check
                if (
                    0 <= row_idx < self._band.shape[0]
                    and 0 <= col_idx < self._band.shape[1]
                ):
                    pixel_value = int(self._band[row_idx, col_idx])
                    class_name = WORLDCOVER_CLASSES.get(
                        pixel_value, "Unknown"
                    )
                else:
                    pixel_value = 0
                    class_name = "Unknown"

            except Exception:
                pixel_value = 0
                class_name = "Unknown"

            wc_codes.append(pixel_value)
            wc_names.append(class_name)

        df["worldcover_code"] = wc_codes
        df["worldcover_name"] = wc_names

        # Convert to numeric encoding used by the model
        df["worldcover_class"] = df["worldcover_name"].map(
            WORLDCOVER_NUMERIC
        ).fillna(-1).astype(int)

        logger.info(f"Enriched {len(df)} detections with WorldCover data.")
        return df

    def get_sample_at(self, lat: float, lon: float) -> dict:
        """Get land cover info for a single coordinate."""
        if not self._loaded:
            self.load()

        if self._dataset is None:
            return {"code": 0, "name": "Unknown", "numeric": -1}

        import rasterio

        try:
            row_idx, col_idx = rasterio.transform.rowcol(
                self._transform, lon, lat
            )
            if (
                0 <= row_idx < self._band.shape[0]
                and 0 <= col_idx < self._band.shape[1]
            ):
                code = int(self._band[row_idx, col_idx])
                name = WORLDCOVER_CLASSES.get(code, "Unknown")
                numeric = WORLDCOVER_NUMERIC.get(name, -1)
                return {"code": code, "name": name, "numeric": numeric}
        except Exception:
            pass

        return {"code": 0, "name": "Unknown", "numeric": -1}

    def close(self):
        """Close the raster dataset."""
        if self._dataset is not None:
            self._dataset.close()
            self._dataset = None

    def __del__(self):
        self.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    enricher = LandCoverEnricher()
    enricher.load()

    # Test with sample coordinates
    test_df = pd.DataFrame({
        "latitude": [23.7958, 23.6866, 23.3487],
        "longitude": [86.4305, 86.3912, 85.3096],
    })
    result = enricher.enrich(test_df)
    print(result[["latitude", "longitude", "worldcover_name",
                   "worldcover_class"]])
