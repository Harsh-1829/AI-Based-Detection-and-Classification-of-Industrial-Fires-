"""
ThermalIntell — Pipeline Orchestrator CLI
======================================
Executes the full end-to-end data processing and classification pipeline:
1. Data Ingestion (NASA FIRMS API or historical CSV)
2. Geospatial Enrichment (ESA WorldCover TIF + OpenStreetMap GeoJSON)
3. Feature Engineering (18 temporal, thermal, spatial, persistence features)
4. XGBoost Model B Multi-Class Inference
5. Final GeoJSON & CSV Database Export

Usage:
    python run_pipeline.py --source firms --days 1
    python run_pipeline.py --source csv --input jh_viirs_test_2022_unclassified.csv --output data/classified/predictions.csv
"""

import argparse
import logging
import sys
import time
from pathlib import Path

import pandas as pd

# Add workspace to Python path
BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))

import config
from data_ingestion.firms_client import FIRMSClient
from data_ingestion.landcover_enrichment import LandCoverEnricher
from data_ingestion.osm_enrichment import OSMEnricher
from pipeline.classifier import ThermalClassifier
from api.database import get_db

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("run_pipeline")


def run_pipeline(
    source: str = "firms",
    input_file: str = None,
    output_file: str = None,
    days: int = 1,
    satellite_source: str = "VIIRS_NOAA21_NRT",
):
    start_time = time.time()
    print("=" * 70)
    print("      THERMALINTELL: AI THERMAL ANOMALY CLASSIFICATION PIPELINE      ")
    print("=" * 70)

    # -------------------------------------------------------------
    # Step 1: Data Ingestion
    # -------------------------------------------------------------
    logger.info(">>> STEP 1: Ingesting Thermal Detections...")
    if source.lower() == "firms":
        logger.info(f"Connecting to NASA FIRMS URT API (last {days} day(s), {satellite_source})...")
        client = FIRMSClient()
        raw_df = client.fetch_area(days=days, source=satellite_source)
        if raw_df.empty:
            logger.warning(
                f"No thermal anomalies detected in Jharkhand bounding box in the past {days} day(s)."
            )
            print("-" * 70)
            print("NASA FIRMS returned 0 active fire points for the specified time window.")
            print("To run pipeline with demonstration data, use: python run_pipeline.py --source csv")
            return
    elif source.lower() == "csv":
        csv_path = Path(input_file or config.CSV_TEST_PREDICTIONS)
        if not csv_path.exists():
            # Try finding unclassified test data
            csv_path = BASE_DIR / "jh_viirs_test_2022_unclassified.csv"
        if not csv_path.exists():
            raise FileNotFoundError(f"Input CSV file not found: {csv_path}")

        logger.info(f"Reading input detections from CSV: {csv_path}...")
        raw_df = pd.read_csv(csv_path)
    else:
        raise ValueError(f"Unknown source: {source}. Use 'firms' or 'csv'.")

    logger.info(f"Ingested {len(raw_df):,} thermal detection records.")

    # -------------------------------------------------------------
    # Step 2: Geospatial Enrichment
    # -------------------------------------------------------------
    logger.info(">>> STEP 2: Geospatial Enrichment (Land Cover + OSM)...")

    # Land cover
    if "worldcover_class" not in raw_df.columns or raw_df["worldcover_class"].isna().any():
        logger.info("Extracting ESA WorldCover classes from raster...")
        lc_enricher = LandCoverEnricher()
        enriched_df = lc_enricher.enrich(raw_df)
    else:
        logger.info("WorldCover classes already present in dataset.")
        enriched_df = raw_df

    # OSM infrastructure
    if "distance_to_landuse_m" not in enriched_df.columns:
        logger.info("Performing spatial R-tree/KD-tree query against OpenStreetMap features...")
        osm_enricher = OSMEnricher()
        enriched_df = osm_enricher.enrich(enriched_df)
    else:
        logger.info("OSM proximity features already present.")

    # -------------------------------------------------------------
    # Step 3 & 4: Feature Engineering & XGBoost Model B Inference
    # -------------------------------------------------------------
    logger.info(">>> STEP 3 & 4: Feature Engineering & Model B Multi-Class Inference...")
    classifier = ThermalClassifier()
    classifier.load()

    classified_df = classifier.classify_raw(enriched_df)

    # -------------------------------------------------------------
    # Step 5: Persistence Analysis & DB Export
    # -------------------------------------------------------------
    logger.info(">>> STEP 5: Updating Geospatial Database & GeoJSON Export...")
    db = get_db()
    db.add_detections(classified_df, save_now=True)

    if output_file:
        out_path = Path(output_file)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        classified_df.to_csv(out_path, index=False)
        logger.info(f"Exported classified predictions to {out_path}.")

    elapsed = time.time() - start_time
    print("=" * 70)
    print("                    PIPELINE SUMMARY RESULTS                       ")
    print("=" * 70)
    print(f"Total Detections Processed: {len(classified_df):,}")
    print(f"Execution Time:            {elapsed:.2f} seconds")
    print("\nClassification Segregation Breakdown:")
    counts = classified_df["predicted_class"].value_counts()
    for cls_name, count in counts.items():
        pct = (count / len(classified_df)) * 100
        print(f"  * {cls_name:<30}: {count:>6,} ({pct:>5.1f}%)")

    stats = db.get_statistics()
    print(f"\nTotal Records in Central GIS Store: {stats['total_detections']:,}")
    print(f"Persistent Hotspot Clusters:         {stats['persistent_sources_count']:,}")
    print(f"Maximum Fire Radiative Power (FRP):  {stats['max_frp']} MW")
    print("=" * 70)


def main():
    parser = argparse.ArgumentParser(
        description="ThermalIntell Thermal Anomaly Classification Pipeline"
    )
    parser.add_argument(
        "--source",
        choices=["firms", "csv"],
        default="firms",
        help="Input data source: 'firms' (NASA FIRMS API) or 'csv' (local file)",
    )
    parser.add_argument(
        "--input",
        type=str,
        default=None,
        help="Path to input CSV file if source is 'csv'",
    )
    parser.add_argument(
        "--output",
        type=str,
        default=None,
        help="Path to save classified output CSV",
    )
    parser.add_argument(
        "--days",
        type=int,
        default=1,
        help="Number of days to query from FIRMS (1-10)",
    )
    parser.add_argument(
        "--satellite",
        type=str,
        default="VIIRS_NOAA21_NRT",
        help="FIRMS satellite instrument (VIIRS_NOAA21_NRT, VIIRS_SNPP_NRT, VIIRS_NOAA20_NRT, MODIS_NRT)",
    )

    args = parser.parse_args()
    run_pipeline(
        source=args.source,
        input_file=args.input,
        output_file=args.output,
        days=args.days,
        satellite_source=args.satellite,
    )


if __name__ == "__main__":
    main()
