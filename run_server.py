"""
AGNI-VISION — Server Launcher
=============================
Initializes the GeoJSON database and launches the FastAPI backend + GIS web dashboard.

Usage:
    python run_server.py
"""

import sys
from pathlib import Path

# Add workspace to path
BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))

import uvicorn
from api.database import get_db
import config

BANNER = r"""
==============================================================================
   ___    ____ _   _ ___      __     _____ ____ ___ ___  _   _ 
  / _ \  / ___| \ | |_ _|     \ \   / /_ _/ ___|_ _/ _ \| \ | |
 / /_\ \| |  _|  \| || |  ___  \ \ / / | |\___ \| | | | |  \| |
 |  _  || |_| | |\  || | |___|  \ V /  | | ___) | | |_| | |\  |
 |_| |_| \____|_| \_|___|        \_/  |___|____/___\___/|_| \_|
                                                               
 AI-Enabled Geospatial Thermal Anomaly & Industrial Fire Monitoring
 SIH 26162 | XGBoost Model B (81.7% Acc) + NASA FIRMS + ESA WorldCover
==============================================================================
"""


def main():
    print(BANNER)
    print(">> Initializing Central GeoJSON Database...")
    db = get_db()
    stats = db.get_statistics()
    print(f">> Database ready with {stats['total_detections']:,} classified anomalies across Jharkhand.")
    print(f">> Persistent hotspots identified: {stats['persistent_sources_count']:,}")

    print("-" * 78)
    print("  [GIS Web Dashboard]       --> http://127.0.0.1:8000")
    print("  [Interactive API Docs]    --> http://127.0.0.1:8000/docs")
    print("  [ReDoc Specification]     --> http://127.0.0.1:8000/redoc")
    print("  [Statistics Endpoint]     --> http://127.0.0.1:8000/api/stats")
    print("  [Detections GeoJSON API]  --> http://127.0.0.1:8000/api/detections")
    print("-" * 78)
    print(">> Starting FastAPI Uvicorn Server on http://127.0.0.1:8000 (Press Ctrl+C to stop)...")

    uvicorn.run(
        "api.app:app",
        host="127.0.0.1",
        port=8000,
        log_level="info",
        reload=False,
    )


if __name__ == "__main__":
    main()
