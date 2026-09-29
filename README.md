# ThermalIntell: AI-Enabled Geospatial Thermal Anomaly & Industrial Fire Intelligence Platform

> **Smart India Hackathon (SIH 2026)**  
> **Problem Statement ID:** SIH26162  
> **Problem Statement Title:** AI-Based Detection and Classification of Industrial Fires and Persistent Thermal Sources Using NASA FIRMS, OSM & Satellite Data  
> **Theme:** Disaster Management | **Category:** Software  
> **Focus Region:** Jharkhand State, India (24 Districts, Jharia Coalfields, Bokaro, Ramgarh, Jamshedpur)  
> **Validated Model Performance:** **81.69% Test Accuracy** | **83.06% Weighted F1-Score** | **71.62% Balanced Accuracy**  

---

## 📌 Executive Summary

Satellite active fire monitoring systems (such as NASA FIRMS) detect thermal anomalies from orbit but treat every hotspot as a generic heat dot. They cannot distinguish whether an anomaly is a steel plant blast furnace running normally in Bokaro, an underground coal seam fire in Jharia, an open-cast blasting operation, a hazardous forest wildfire in Saranda, or seasonal crop residue burning.

**ThermalIntell** bridges the gap between raw satellite telemetry, ground-truth industrial geography, and disaster management. It ingests NASA VIIRS (375m resolution) satellite data in near-real-time, enriches it with pixel-level **10m ESA WorldCover** land use and **3,913 OpenStreetMap industrial & mining infrastructure assets**, and classifies each thermal anomaly across 5 distinct categories in under **25 milliseconds** per detection using a cost-weighted **XGBoost Model B**.

---

## 🚀 Key Platform Innovations & Capabilities

### 1. 🏭 5-Class Cost-Weighted AI Classifier (Model B)
* Classifies satellite thermal events into 5 verified operational categories:
  * 🏭 **Industrial Facilities** (Power plants, steel mills, refineries, brick kilns) — *97.0% Precision | 94.0% F1*
  * ⛏️ **Quarry / Mining Operations** (Open-cast coal mines, blasting zones, Jharia coalfield fires) — *85.4% Precision | 90.9% F1*
  * 🌲 **Forest Wildfires** (Protected forest reserves, canopy fires) — *92.9% Precision | 85.3% F1*
  * 🌾 **Agricultural Stubble Burning** (Crop residue fires)
  * 🌿 **Vegetation & Scrub Fires** (Open scrub and roadside brush)
* Uses cost-sensitive sample weighting (`compute_sample_weight('balanced')`) to resolve extreme class imbalance between routine scrub fires and critical industrial flares.

### 2. 🛰️ Multi-Source Geospatial & Satellite Fusion
* **NASA FIRMS Ingestion:** Automated connection to the NASA FIRMS Ultra-Real-Time (URT) and Near-Real-Time (NRT) API for VIIRS sensors (NOAA-21, NOAA-20, Suomi-NPP) at **375m spatial resolution**.
* **10m ESA WorldCover:** Pixel-level land cover queries identifying ground-level surface composition across 11 standard ESA classes.
* **3,913 OSM Industrial Assets:** Sub-millisecond $O(\log N)$ nearest-neighbor spatial queries via **SciPy cKDTree** against verified factories, power stations, and mine polygons across Jharkhand.
* **18 Engineered Spatiotemporal Features:** Includes thermal differentials ($TI4 - TI5$), logarithmic Fire Radiative Power ($\log(FRP)$), day/night diurnal cycle embeddings, and multi-day temporal persistence metrics.

### 3. 🌤️ Live Meteorological & Wildfire Feasibility Intelligence
* Integrated with Open-Meteo REST API at exact detection coordinates.
* Pulls live **ambient temperature (°C)**, **relative humidity (%)**, **precipitation (mm)**, and **wind speed (km/h)**.
* Computes an environmental wildfire feasibility verdict to determine if meteorological conditions can sustain or spread open flame vs. enclosed industrial heat.

### 4. 🔬 375m Optical Footprint Sub-Pixel Validation
* Decomposes the 375m VIIRS sensor footprint against underlying 10m ESA WorldCover pixels.
* Samples up to 1,000 sub-pixels to detect mixed-pixel edge cases (e.g. an industrial facility bordering a forest or scrubland) and displays the dominant land-cover percentage.

### 5. 🚨 Automated Multi-Agency Emergency Alert Dispatcher
* **Automated Severity Triage:** Categorizes anomalies into `CRITICAL` (FRP $\ge$ 50 MW or high-confidence industrial/forest), `HIGH`, or `MODERATE`.
* **Multi-Agency Simultaneous Routing:** Dispatches automated emergency notifications with response SLAs (5 min for Critical, 15 min for High, 45 min for Moderate) to:
  * **NDRF** (National Disaster Response Force)
  * **State DFO** (Divisional Forest Office)
  * **State PCB** (Pollution Control Board)
  * **District Police Control Room**
  * **Local Fire & Emergency Services**
* Tracks all dispatches in an auditable in-memory session log (`/api/dispatch/log`).

### 6. 📄 Official Executive PDF Incident Report Generator
* Pure browser-native A4 printable dossier engine (no bulky external PDF server dependencies).
* Inlines official state headers, SIH 26162 project identification, dynamic severity color banners, 7 structured intelligence sections, XGBoost class probabilities, and official response directives.

### 7. 🗺️ Command Web GIS Dashboard & AI Simulator
* Built with a dark-warm **Cowboy Space aesthetic** (`#1f1509` background, `#c14f09` burnt-orange accents, `#f9f7f3` warm ivory typography).
* Interactive Leaflet.js canvas with client-side GPU **Leaflet-Heat** rendering, multi-layer filter drawers, district zoom jumps, and dynamic Chart.js analytics.
* **What-If AI Simulator:** Real-time sandbox allowing operators to feed custom coordinates, FRP, and satellite brightness temperatures to evaluate Model B inference on demand.

---

## 📁 Repository Directory Structure

```
├── run_server.py                          # Launcher: Boots central database, FastAPI backend & GIS UI
├── run_pipeline.py                        # CLI Orchestrator: End-to-end ingestion -> inference -> export
├── train_model.py                         # Standalone training & evaluation pipeline for XGBoost Model B
├── config.py                              # Central configuration (paths, bounding box, API keys)
├── requirements.txt                       # Python dependencies
├── flow.txt                               # System architecture & dataflow documentation
├── PROBLEM_STATEMENT.txt                  # Official SIH 26162 problem description
├── SIH2026-IDEA-Presentation-Format.pptx  # Official SIH Idea Presentation deck
│
├── jharkhand_viirs_MODEL_B.json           # Serialized pre-trained XGBoost Model B (81.69% accuracy)
├── jharkhand_viirs_MODEL_B_metadata.json  # Hyperparameters, feature columns, and evaluation metrics
│
├── export.geojson                         # OpenStreetMap dataset (3,913 industrial/mining features)
├── jh_viirs_train_2021_labeled.csv        # Training dataset: 34,900 ground-truth labeled detections
├── jh_viirs_test_2022_labeled.csv         # Independent test dataset: 19,144 labeled detections
├── jh_viirs_test_2022_unclassified.csv    # 11,978 unclassified detections for inference demo
├── jh_viirs_2022_test_predictions_MODEL_B.csv # Model B test evaluation output
├── jh_viirs_2022_unclassified_CLASSIFIED_MODEL_B.csv # Model B batch inference output
│
├── api/                                   # FastAPI backend application
│   ├── app.py                             # REST API endpoints (stats, detections, recon, simulator)
│   └── database.py                        # Central GeoJSON database engine & memory cache
│
├── dashboard/                             # Modern GIS Web Dashboard frontend
│   ├── index.html                         # Full-featured command dashboard interface
│   ├── css/styles.css                     # Custom design system (Cowboy Space dark-warm theme)
│   └── js/
│       ├── app.js                         # Core GIS client logic, Leaflet layers, and inspection panel
│       ├── charts.js                      # Chart.js analytics module
│       ├── alert-dispatcher.js            # Automated emergency triage & multi-agency dispatch engine
│       └── pdf-reporter.js                # Official A4 incident report PDF generator
│
├── data/                                  # Spatial boundaries & database output
│   ├── jharkhand_boundary.geojson         # Official administrative polygon of Jharkhand
│   └── classified_detections.geojson      # Pre-indexed classified anomaly store
│
├── pipeline/                              # AI & Feature Engineering pipeline
│   ├── classifier.py                      # Multi-class inference wrapper (Model B)
│   └── feature_engineer.py                # 18-feature extraction & DBSCAN spatial clustering
│
└── data_ingestion/                        # Data sources & geospatial enrichment
    ├── firms_client.py                    # NASA FIRMS URT/NRT live API client
    ├── osm_enrichment.py                  # Spatial distance query via SciPy cKDTree
    └── landcover_enrichment.py            # ESA WorldCover 10m raster sampler (with fallback)
```

---

## 🚀 Quickstart & Setup Guide

### 1. Environment Setup
Clone the repository and install the verified dependencies:
```bash
git clone https://github.com/Harsh-1829/AI-Based-Detection-and-Classification-of-Industrial-Fires-.git
cd AI-Based-Detection-and-Classification-of-Industrial-Fires-

# Create virtual environment
python -m venv venv
venv\Scripts\activate   # Windows (or: source venv/bin/activate on Linux/macOS)

# Install requirements
pip install -r requirements.txt
```

### 2. Launch the Web Platform
Start the local server hosting the API and GIS Web Dashboard:
```bash
python run_server.py
```
* **GIS Command Dashboard:** [http://127.0.0.1:8000](http://127.0.0.1:8000)
* **Interactive Swagger API Docs:** [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)
* **ReDoc API Specification:** [http://127.0.0.1:8000/redoc](http://127.0.0.1:8000/redoc)

### 3. Run the CLI Pipeline
Execute batch classification on unclassified satellite detections or query live NASA FIRMS API:
```bash
# Option A: Run inference on local CSV data
python run_pipeline.py --source csv --input jh_viirs_test_2022_unclassified.csv

# Option B: Run live query against NASA FIRMS API (last 24 hours)
python run_pipeline.py --source firms --days 1 --satellite VIIRS_NOAA21_NRT
```

### 4. Reproduce & Retrain Model B
Re-train XGBoost Model B from scratch on the 34,900 labeled dataset and generate fresh evaluation metrics:
```bash
python train_model.py
```

---

## 📊 Model B Evaluation & Benchmark Report

Evaluated on an independent test dataset of **19,144 ground-truth labeled VIIRS detections** across Jharkhand State (2022):

| Category | Precision | Recall | F1-Score | Support |
|:---|:---:|:---:|:---:|:---:|
| **Industrial Facilities** | **97.00%** | **91.20%** | **94.01%** | 4,638 |
| **Quarry / Mining Operations** | **85.40%** | **97.06%** | **90.86%** | 3,639 |
| **Forest Wildfires** | **92.85%** | **78.96%** | **85.34%** | 8,721 |
| **Vegetation / Scrub Fires** | 32.37% | 47.21% | 38.41% | 1,523 |
| **Agricultural Stubble** | 26.93% | 43.66% | 33.31% | 623 |
| **Overall Test Accuracy** | — | — | **81.69%** | 19,144 |
| **Weighted F1-Score** | — | — | **83.06%** | 19,144 |
| **Balanced Accuracy** | — | — | **71.62%** | 19,144 |

### Top Predictive Feature Importances
1. **`unique_days_active` (27.3%):** Identifies permanent industrial flare stacks and persistent Jharia coal seam fires.
2. **`n_detections_at_source` (17.1%):** Total count of repeated thermal detections within the spatial cluster.
3. **`days_active_span` (15.4%):** Temporal span from first detected date to most recent detection.
4. **`latitude` & `longitude` (11.0%):** Spatial correlation with known industrial clusters and mineral belts.
5. **`hour_sin` & `hour_cos` (8.8%):** Diurnal solar cycle separating daytime-only false alarms from 24/7 industrial furnaces.

---

## 🌐 REST API Reference

| Method | Endpoint | Description |
|:---|:---|:---|
| `GET` | `/api/stats` | High-level KPI metrics (total detections, class distribution, max FRP, persistent hotspots). |
| `GET` | `/api/detections` | Filtered GeoJSON features with pagination, class filters, FRP sliders, and date queries. |
| `GET` | `/api/detections/realtime` | Live NASA FIRMS stream with automated WorldCover + OSM enrichment and Model B inference. |
| `GET` | `/api/recon/satellite` | 375m VIIRS optical footprint validation with 10m ESA WorldCover sub-pixel breakdown. |
| `POST` | `/api/classify` | On-demand inference endpoint for single coordinate/thermal telemetry points (What-If simulator). |
| `GET` | `/api/sources` | Clustered persistent thermal sources with recurrence rankings (DBSCAN). |
| `GET` | `/api/boundary` | Jharkhand state administrative boundary GeoJSON. |
| `GET` | `/api/osm-infrastructure` | OpenStreetMap 3,913 industrial facilities and mine locations. |
| `GET` | `/api/health` | Service health check and database loading status. |

---

## 👥 Team Deadlock — Smart India Hackathon 2026

* **Problem Statement:** SIH26162 — AI-Based Detection and Classification of Industrial Fires & Persistent Thermal Sources  
* **Theme:** Disaster Management  
* **Codebase:** [https://github.com/Harsh-1829/AI-Based-Detection-and-Classification-of-Industrial-Fires-](https://github.com/Harsh-1829/AI-Based-Detection-and-Classification-of-Industrial-Fires-)
