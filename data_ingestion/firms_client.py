"""
NASA FIRMS API Client
=====================
Fetches VIIRS/MODIS thermal anomaly detections for Jharkhand
from the NASA FIRMS (Fire Information for Resource Management System) API.

Uses MAP_KEY authentication and returns structured DataFrames
matching the XGBoost Model B input schema.
"""

import io
import time
import logging
from datetime import datetime, timedelta
from typing import Optional

import pandas as pd
import requests

import sys
sys.path.insert(0, str(__file__).rsplit("\\", 2)[0])
from config import (
    FIRMS_MAP_KEY,
    FIRMS_SOURCES,
    JHARKHAND_BBOX,
    JHARKHAND_BBOX_STR,
)

logger = logging.getLogger(__name__)


class FIRMSClient:
    """
    Client for NASA FIRMS REST API.

    Fetches near-real-time and archival VIIRS/MODIS thermal detections
    for the Jharkhand bounding box.
    """

    BASE_URL = "https://firms.modaps.eosdis.nasa.gov/api/area/csv"

    def __init__(self, map_key: str = FIRMS_MAP_KEY):
        self.map_key = map_key
        self.session = requests.Session()
        self.session.headers.update({
            "Accept": "text/csv",
        })

    # ----------------------------------------------------------------
    # PUBLIC API
    # ----------------------------------------------------------------

    def fetch_area(
        self,
        days: int = 1,
        source: str = "VIIRS_NOAA21_NRT",
    ) -> pd.DataFrame:
        """Alias for fetch_recent for area bounding box."""
        return self.fetch_recent(source=source, day_range=days)

    def fetch_recent(
        self,
        source: str = "VIIRS_NOAA21_NRT",
        day_range: int = 2,
    ) -> pd.DataFrame:
        """
        Fetch recent thermal detections (last N days).

        Parameters
        ----------
        source : str
            FIRMS data source (e.g., VIIRS_NOAA21_NRT, VIIRS_SNPP_NRT, VIIRS_NOAA20_NRT).
        day_range : int
            Number of recent days (1-10).

        Returns
        -------
        pd.DataFrame
            Raw FIRMS detections with standardized columns.
        """
        day_range = max(1, min(10, day_range))

        url = (
            f"{self.BASE_URL}/{self.map_key}/{source}/"
            f"{JHARKHAND_BBOX_STR}/{day_range}"
        )

        logger.info(f"Fetching FIRMS data: source={source}, days={day_range}")
        logger.info(f"URL: {url}")

        return self._request_and_parse(url, source)

    def fetch_date_range(
        self,
        start_date: str,
        end_date: str,
        source: str = "VIIRS_NOAA21_NRT",
    ) -> pd.DataFrame:
        """
        Fetch thermal detections for a specific date range.

        Parameters
        ----------
        start_date : str
            Start date in YYYY-MM-DD format.
        end_date : str
            End date in YYYY-MM-DD format.
        source : str
            FIRMS data source.

        Returns
        -------
        pd.DataFrame
            Raw FIRMS detections.
        """
        url = (
            f"{self.BASE_URL}/{self.map_key}/{source}/"
            f"{JHARKHAND_BBOX_STR}/{start_date}/{end_date}"
        )

        logger.info(
            f"Fetching FIRMS data: source={source}, "
            f"range={start_date} to {end_date}"
        )

        return self._request_and_parse(url, source)

    def fetch_all_sources_recent(
        self,
        day_range: int = 2,
    ) -> pd.DataFrame:
        """
        Fetch recent data from all VIIRS sources and combine.

        Returns
        -------
        pd.DataFrame
            Combined detections from all VIIRS instruments.
        """
        frames = []
        for name, source_id in FIRMS_SOURCES.items():
            if "VIIRS" not in name:
                continue
            try:
                df = self.fetch_recent(source=source_id, day_range=day_range)
                if not df.empty:
                    df["instrument"] = name
                    frames.append(df)
                    logger.info(f"  {name}: {len(df)} detections")
                # Rate limiting
                time.sleep(1)
            except Exception as e:
                logger.warning(f"  {name}: Failed — {e}")

        if not frames:
            logger.warning("No detections from any VIIRS source.")
            return pd.DataFrame()

        combined = pd.concat(frames, ignore_index=True)
        # Remove duplicates (same lat/lon/time)
        combined = combined.drop_duplicates(
            subset=["latitude", "longitude", "acq_date", "acq_time"],
            keep="first",
        )
        logger.info(f"Total combined detections: {len(combined)}")
        return combined

    # ----------------------------------------------------------------
    # INTERNAL
    # ----------------------------------------------------------------

    def _request_and_parse(
        self,
        url: str,
        source: str,
    ) -> pd.DataFrame:
        """Send HTTP request and parse CSV response."""
        try:
            response = self.session.get(url, timeout=60)
            response.raise_for_status()

            # Check if response is valid CSV
            content = response.text.strip()
            if not content or "Error" in content[:100]:
                logger.error(f"FIRMS API error: {content[:200]}")
                return pd.DataFrame()

            df = pd.read_csv(io.StringIO(content))

            if df.empty:
                logger.info("No detections found in the specified area/time.")
                return df

            # Standardize column names
            df = self._standardize_columns(df, source)

            # Filter to Jharkhand bounds (safety check)
            df = df[
                (df["latitude"] >= JHARKHAND_BBOX["south"])
                & (df["latitude"] <= JHARKHAND_BBOX["north"])
                & (df["longitude"] >= JHARKHAND_BBOX["west"])
                & (df["longitude"] <= JHARKHAND_BBOX["east"])
            ].copy()

            logger.info(
                f"Fetched {len(df)} detections within Jharkhand bounds."
            )
            return df

        except requests.exceptions.Timeout:
            logger.error("FIRMS API request timed out.")
            return pd.DataFrame()
        except requests.exceptions.HTTPError as e:
            logger.error(f"FIRMS API HTTP error: {e}")
            return pd.DataFrame()
        except Exception as e:
            logger.error(f"FIRMS API unexpected error: {e}")
            return pd.DataFrame()

    def _standardize_columns(
        self,
        df: pd.DataFrame,
        source: str,
    ) -> pd.DataFrame:
        """
        Standardize FIRMS CSV columns to match our model's expectations.
        VIIRS columns: latitude, longitude, bright_ti4, scan, track,
                       acq_date, acq_time, satellite, instrument,
                       confidence, version, bright_ti5, frp, daynight, type
        """
        # Rename columns if needed (VIIRS should already have correct names)
        col_map = {
            "brightness": "bright_ti4",  # MODIS compatibility
        }
        df = df.rename(columns={
            k: v for k, v in col_map.items() if k in df.columns
        })

        # Ensure required columns exist
        required = [
            "latitude", "longitude", "bright_ti4", "scan", "track",
            "acq_date", "acq_time", "confidence", "bright_ti5", "frp",
            "daynight",
        ]
        for col in required:
            if col not in df.columns:
                logger.warning(f"Missing column '{col}' — filling with NaN")
                df[col] = float("nan")

        # Parse date/time
        df["acq_date"] = pd.to_datetime(df["acq_date"], errors="coerce")

        # Add type column if missing (VIIRS type code)
        if "type" not in df.columns:
            df["type"] = 2  # Default VIIRS type

        return df


# ============================================================
# Convenience function
# ============================================================

def fetch_firms_data(
    day_range: int = 2,
    source: Optional[str] = None,
) -> pd.DataFrame:
    """
    Quick helper to fetch FIRMS data.

    Parameters
    ----------
    day_range : int
        Number of recent days to fetch.
    source : str, optional
        Specific source, or None to fetch all VIIRS sources.

    Returns
    -------
    pd.DataFrame
        Raw thermal detections.
    """
    client = FIRMSClient()
    if source:
        return client.fetch_recent(source=source, day_range=day_range)
    return client.fetch_all_sources_recent(day_range=day_range)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    print("Testing FIRMS API client...")
    df = fetch_firms_data(day_range=1, source="VIIRS_SNPP_NRT")
    print(f"Fetched {len(df)} detections")
    if not df.empty:
        print(df.head())
        print(f"\nColumns: {list(df.columns)}")
