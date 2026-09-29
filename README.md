# ThermalIntel: AI-Enabled Geospatial Thermal Anomaly & Industrial Fire Monitoring

> **Smart India Hackathon (SIH 2026)**  
> **Problem Statement:** AI-Based Detection and Classification of Industrial Fires & Persistent Thermal Sources  
> **Region of Focus:** Jharkhand State, India  
> **Model Performance:** **81.69% Test Accuracy** | **83.06% Weighted-F1** | **71.62% Balanced Accuracy**

---

## 📌 Executive Summary

Satellite-based active fire monitoring systems (such as NASA FIRMS) detect thermal anomalies but cannot distinguish between industrial flare stacks, mining quarries, forest wildfires, crop residue burning, and open scrub fires. 

**AGNI-VISION** solves this challenge through an end-to-end AI-geospatial architecture:
1. **Near-Real-Time Satellite Ingestion:** Automated connection to the NASA FIRMS Ultra-Real-Time (URT) API (VIIRS NOAA-21 / NOAA-20 / Suomi-NPP).
2. **Geospatial & Proximity Enrichment:** Automatic pixel-level querying against ESA WorldCover (10m resolution) and KD-Tree distance calculations against 3,913 OpenStreetMap industrial & mining infrastructure assets in Jharkhand.
3. **Spatiotemporal Grouping & Feature Engineering:** Extraction of 18 features capturing recurrence frequency, active lifespan (`days_active_span`), and thermal dynamics (`log_frp`, `ti_diff`).
4. **Weighted XGBoost Multi-Class Classification (Model B):** Classifies thermal detections into 5 distinct categories:
   - 🏭 **Industrial Facilities** (Power plants, steel mills, refineries, brick kilns)
   - ⛏️ **Quarry / Mining Operations** (Open-cast coal mines, blasting zones)
   - 🌲 **Forest Fires**
   - 🌾 **Agricultural Burning** (Crop stubble)
   - 🌿 **Vegetation Fires** (Open scrub/grassland)
5. **Interactive GIS Web Dashboard & REST API:** Built with FastAPI and Leaflet.js with live spatiotemporal filtering, hotspot persistence clustering, and full GeoJSON export.

---

## 📁 Submission Directory Structure

```
├── run_server.py                     # Entrypoint: Launches FastAPI backend & GIS Web Dashboard
├── run_pipeline.py                   # CLI Orchestrator: End-to-end ingestion -> inference -> export
├── train_model.py                    # Standalone training & evaluation script for XGBoost Model B
├── config.py                         # Central configuration (paths, bounding box, API keys)
├── requirements.txt                  # Python dependencies
├── flow.txt                          # ASCII system architecture & dataflow diagram
├── PROBLEM_STATEMENT.txt             # Official SIH problem description
├── SIH2026-IDEA-Presentation-Format.pptx # Official SIH Idea Presentation deck
│
├── jharkhand_viirs_MODEL_B.json      # Serialized pre-trained XGBoost Model B (81.69% accuracy)
├── jharkhand_viirs_MODEL_B_metadata.json # Hyperparameters, class weights, and metrics
│
├── export.geojson                    # OpenStreetMap dataset (3,913 industrial/mining features)
│
├── jh_viirs_train_2021_labeled.csv   # Training dataset: 34,900 ground-truth labeled detections
├── jh_viirs_test_2022_labeled.csv    # Independent test dataset: 19,144 labeled detections
├── jh_viirs_test_2022_unclassified.csv # 11,978 unclassified detections for inference demo
├── jh_viirs_2022_test_predictions_MODEL_B.csv # Model B test evaluation output
├── jh_viirs_2022_unclassified_CLASSIFIED_MODEL_B.csv # Model B inference output
│
├── xgboost_model_B_2022_classification_report.csv # Precision/Recall/F1 per class
├── xgboost_model_B_feature_importance.csv         # Top feature rankings
├── xgboost_model_B_prediction_distribution.csv    # Predicted class breakdown
│
├── api/                              # FastAPI backend application
│   ├── app.py                        # REST endpoints (/api/stats, /api/detections, /api/firms/live)
│   └── database.py                   # Central GeoJSON database loader & query engine
│
├── dashboard/                        # Modern GIS Web Dashboard frontend
│   ├── index.html                    # Glassmorphism dark-mode GIS interface
│   ├── css/styles.css                # CSS design system
│   └── js/app.js                     # Map logic, Leaflet layers, clustering, and filters
│
├── data/                             # GIS Boundary polygon
│   └── jharkhand_boundary.geojson    # Official administrative polygon of Jharkhand
│
├── pipeline/                         # AI & Feature Engineering pipeline
│   ├── classifier.py                 # Multi-class inference wrapper
│   └── feature_engineer.py           # 18-feature extraction and DBSCAN spatiotemporal clustering
│
└── data_ingestion/                   # External API & geospatial enrichment
    ├── firms_client.py               # NASA FIRMS URT live API client
    ├── osm_enrichment.py             # Spatial distance query via KD-Tree
    └── landcover_enrichment.py       # ESA WorldCover raster sampler (with safe fallback)
```

> **Note on Land Cover GeoTIFF Raster (`jharkhand_landcover.tif`):**  
> The 70MB ESA WorldCover raster is excluded from Git to keep cloning fast and lightweight. The pipeline includes an automatic fallback that allows full model inference even without the local raster. If required for local raster queries, place `jharkhand_landcover.tif` in the root folder.

---

## 🚀 Quickstart & Setup Guide

### 1. Environment Setup
Install required Python dependencies:
```bash
pip install -r requirements.txt
```

### 2. Launch the GIS Web Dashboard
Start the local server hosting both the interactive map and API endpoints:
```bash
python run_server.py
```
- **GIS Web Dashboard:** [http://127.0.0.1:8000](http://127.0.0.1:8000)
- **Interactive Swagger API Docs:** [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)
- **Database Statistics Endpoint:** [http://127.0.0.1:8000/api/stats](http://127.0.0.1:8000/api/stats)

### 3. Run the Inference Pipeline
Execute batch classification on unclassified satellite detections or query live NASA FIRMS API:
```bash
# Option A: Run inference on local CSV data
python run_pipeline.py --source csv --input jh_viirs_test_2022_unclassified.csv

# Option B: Run live query against NASA FIRMS API (last 24 hours)
python run_pipeline.py --source firms --days 1 --satellite VIIRS_NOAA21_NRT
```

### 4. Re-train & Evaluate XGBoost Model B from Scratch
To verify model reproducibility and generate fresh evaluation reports:
```bash
python train_model.py
```

---

## 📊 Model B Evaluation Summary

| Class | Precision | Recall | F1-Score | Support |
|---|---|---|---|---|
| **Industrial** | **97.00%** | **91.20%** | **94.01%** | 4,638 |
| **Quarry / Mining** | **85.40%** | **97.06%** | **90.86%** | 3,639 |
| **Forest fire** | **92.85%** | **78.96%** | **85.34%** | 8,721 |
| **Vegetation fire** | 32.37% | 47.21% | 38.41% | 1,523 |
| **Agricultural burning** | 26.93% | 43.66% | 33.31% | 623 |
| **Overall Accuracy** | — | — | **81.69%** | 19,144 |
| **Weighted-F1** | — | — | **83.06%** | 19,144 |
| **Balanced Accuracy** | — | — | **71.62%** | 19,144 |

### Top Predictive Features:
1. `unique_days_active` (27.3%): Number of distinct days thermal activity was recorded at the location.
2. `n_detections_at_source` (17.1%): Total count of repeated satellite thermal hits.
3. `days_active_span` (15.4%): Temporal duration from first detection to last detection.
4. `latitude` & `longitude` (11.0%): Geospatial coordinates cross-referenced with industrial clusters.
5. `hour_sin` & `hour_cos` (8.8%): Day vs. night diurnal cycle patterns.

---

## 🌐 API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/stats` | Summary metrics: total anomalies, class counts, avg/max FRP, persistent hotspots. |
| `GET` | `/api/detections` | Filtered GeoJSON features with pagination, confidence filter, and date ranges. |
| `GET` | `/api/sources` | Clustered persistent thermal sources with recurrence counts. |
| `GET` | `/api/boundary` | Jharkhand state administrative boundary GeoJSON. |
| `GET` | `/api/osm-infrastructure` | OpenStreetMap industrial facilities and mine locations. |
| `POST`| `/api/fetch-firms` | Live NASA FIRMS API pull with automatic LandCover + OSM enrichment and Model B inference. |
