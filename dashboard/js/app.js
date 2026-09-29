/**
 * AGNI-VISION — Main GIS Dashboard Application
 * Leaflet.js + NASA FIRMS + XGBoost Model B Integration
 */

(function () {
    "use strict";

    // Application State
    const state = {
        map: null,
        baseLayers: {},
        currentBaseLayer: "google",
        boundaryLayer: null,
        detectionsLayer: null,
        heatLayer: null,
        sourcesLayer: null,
        osmLayer: null,
        detectionsData: null,
        sourcesData: null,
        statsData: null,
        activeClasses: new Set(["Industrial", "Forest fire", "Quarry/Mining", "Agricultural burning", "Vegetation fire (open/scrub)"]),
        minConfidence: 0.5,
        minFRP: 0,
        daynight: "ALL",
        isDrawerCollapsed: true,
        selectedDetection: null,
        isRealtimeMode: false,
        realtimeData: null,
        realtimeDays: 5,
    };

    // Color definitions
    const CLASS_COLORS = {
        "Industrial": "#ef4444",
        "Forest fire": "#22c55e",
        "Quarry/Mining": "#f97316",
        "Agricultural burning": "#eab308",
        "Vegetation fire (open/scrub)": "#a855f7",
    };

    const DISTRICT_BOUNDS = {
        "ALL": { center: [23.65, 85.60], zoom: 7 },
        "DHANBAD": { center: [23.795, 86.43], zoom: 11 },     // Jharia Coalfields
        "BOKARO": { center: [23.669, 85.96], zoom: 11 },      // Steel City & Thermal plants
        "JAMSHEDPUR": { center: [22.804, 86.202], zoom: 11 }, // Tata Industrial Hub
        "RAMGARH": { center: [23.63, 85.51], zoom: 11 },      // Mines & Kilns
        "RANCHI": { center: [23.344, 85.309], zoom: 11 },     // Capital
        "CHATRA": { center: [24.21, 84.87], zoom: 10 },       // Forest cover
    };

    // Initialize Application
    document.addEventListener("DOMContentLoaded", async () => {
        initMap();
        initUIEventListeners();
        window.dashboardCharts.init();

        // Load initial data
        await fetchBoundary();
        await fetchStats();
        await fetchSources();
        await fetchDetections();
    });

    /**
     * Map Setup & Basemaps
     */
    function initMap() {
        state.map = L.map("gis-map", {
            center: [23.65, 85.60],
            zoom: 7,
            minZoom: 6,
            maxZoom: 17,
            zoomControl: false,
            preferCanvas: true,
        });

        // Add Zoom Control to Top-Right
        L.control.zoom({ position: "topright" }).addTo(state.map);

        // Basemaps
        state.baseLayers.dark = L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
            attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
            subdomains: "abcd",
            maxZoom: 20,
        });

        state.baseLayers.satellite = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
            attribution: "Tiles &copy; Esri",
            maxZoom: 18,
        });

        state.baseLayers.google = L.tileLayer("https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}&key=AIzaSyDIaBUtw8BvmtVZ2yBN4hmHXcEJZzUsHbk", {
            attribution: '&copy; Google Maps',
            subdomains: ["0", "1", "2", "3"],
            maxZoom: 20,
        });

        state.baseLayers.googleRoad = L.tileLayer("https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}&key=AIzaSyDIaBUtw8BvmtVZ2yBN4hmHXcEJZzUsHbk", {
            attribution: '&copy; Google Maps',
            subdomains: ["0", "1", "2", "3"],
            maxZoom: 20,
        });

        state.baseLayers.osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            attribution: '&copy; OpenStreetMap contributors',
            maxZoom: 19,
        });

        // Set default basemap to Google Maps
        state.baseLayers.google.addTo(state.map);

        // Initialize Layer Groups
        state.detectionsLayer = L.layerGroup().addTo(state.map);
        state.sourcesLayer = L.layerGroup().addTo(state.map);
        state.osmLayer = L.layerGroup();

        // Map Event Listeners
        state.map.on("mousemove", (e) => {
            const lat = e.latlng.lat.toFixed(4);
            const lng = e.latlng.lng.toFixed(4);
            document.getElementById("coord-latlon").textContent = `${lat}° N, ${lng}° E`;
        });

        state.map.on("zoomend", () => {
            document.getElementById("coord-zoom").textContent = `Zoom: ${state.map.getZoom()}`;
        });

        state.map.on("click", (e) => {
            // Fill Simulator coordinates on map click
            const simLat = document.getElementById("sim-lat");
            const simLon = document.getElementById("sim-lon");
            if (simLat && simLon) {
                simLat.value = e.latlng.lat.toFixed(4);
                simLon.value = e.latlng.lng.toFixed(4);
            }
        });
    }

    /**
     * Fetch & Render Official Jharkhand State Boundary
     */
    async function fetchBoundary() {
        try {
            const res = await fetch("/api/boundary");
            if (!res.ok) return;
            const geojson = await res.json();

            state.boundaryLayer = L.geoJSON(geojson, {
                style: {
                    color: "#00f0ff",
                    weight: 2.8,
                    opacity: 0.95,
                    dashArray: "8, 6",
                    fillColor: "#06b6d4",
                    fillOpacity: 0.04,
                },
                onEachFeature: (feature, layer) => {
                    layer.bindTooltip(
                        "<div style='font-family:Inter,sans-serif;padding:3px 6px;'><strong>State of Jharkhand</strong><br><span style='color:#38bdf8;font-size:10px;'>Official Thermal Monitoring Zone</span></div>",
                        { sticky: true }
                    );
                }
            }).addTo(state.map);

            if (state.boundaryLayer.getBounds().isValid()) {
                state.map.fitBounds(state.boundaryLayer.getBounds(), { padding: [20, 20] });
            }
        } catch (err) {
            console.error("Failed to load Jharkhand boundary:", err);
        }
    }

    /**
     * Fetch KPI Statistics
     */
    async function fetchStats() {
        try {
            const res = await fetch("/api/stats");
            const data = await res.json();
            state.statsData = data;

            document.getElementById("val-total-count").textContent = (data.total_detections || 0).toLocaleString();
            document.getElementById("val-industrial-count").textContent = (data.by_class?.Industrial || 0).toLocaleString();
            document.getElementById("val-forest-count").textContent = (data.by_class?.["Forest fire"] || 0).toLocaleString();
            document.getElementById("val-quarry-count").textContent = (data.by_class?.["Quarry/Mining"] || 0).toLocaleString();
            document.getElementById("val-agri-count").textContent = (data.by_class?.["Agricultural burning"] || 0).toLocaleString();
            document.getElementById("val-max-frp").textContent = `${data.max_frp || 0} MW`;

            // Update sidebar counts
            document.getElementById("count-industrial").textContent = (data.by_class?.Industrial || 0).toLocaleString();
            document.getElementById("count-forest").textContent = (data.by_class?.["Forest fire"] || 0).toLocaleString();
            document.getElementById("count-quarry").textContent = (data.by_class?.["Quarry/Mining"] || 0).toLocaleString();
            document.getElementById("count-agri").textContent = (data.by_class?.["Agricultural burning"] || 0).toLocaleString();
            document.getElementById("count-vegetation").textContent = (data.by_class?.["Vegetation fire (open/scrub)"] || 0).toLocaleString();

            const pill = document.getElementById("stats-summary-pill");
            if (pill) pill.textContent = `${(data.total_detections || 0).toLocaleString()} Records Ingested`;

            window.dashboardCharts.updateFromStats(data);
        } catch (err) {
            console.error("Failed to fetch stats:", err);
        }
    }

    /**
     * Fetch Persistent Thermal Sources
     */
    async function fetchSources() {
        try {
            const res = await fetch("/api/sources?min_detections=3&limit=150");
            const geojson = await res.json();
            state.sourcesData = geojson;

            renderSourcesLayer(geojson);
            window.dashboardCharts.populateHotspots(geojson, (lat, lon, props) => {
                state.map.flyTo([lat, lon], 13, { duration: 1.5 });
                showDetectionDetails({
                    predicted_class: props.dominant_class,
                    prediction_confidence: props.avg_confidence,
                    latitude: lat,
                    longitude: lon,
                    frp: props.avg_frp,
                    source_cluster_id: props.source_cluster_id,
                    n_detections_at_source: props.detection_count,
                    unique_days_active: props.active_days,
                    days_active_span: `${props.first_seen} to ${props.last_seen}`,
                });
            });
        } catch (err) {
            console.error("Failed to fetch persistent sources:", err);
        }
    }

    /**
     * Fetch Classified Detections from API
     */
    async function fetchDetections() {
        try {
            const params = new URLSearchParams({
                limit: 3000,
                min_confidence: state.minConfidence,
            });

            if (state.daynight !== "ALL") {
                params.set("daynight", state.daynight);
            }

            const res = await fetch(`/api/detections?${params.toString()}`);
            const geojson = await res.json();
            state.detectionsData = geojson;

            applyFiltersAndRender();
        } catch (err) {
            console.error("Failed to fetch detections:", err);
            showToast("Failed to load detections from backend", "error");
        }
    }

    /**
     * Render Detections Layer with Filters
     */
    function applyFiltersAndRender() {
        if (!state.detectionsData || !state.detectionsData.features) return;

        state.detectionsLayer.clearLayers();
        if (state.heatLayer) {
            state.map.removeLayer(state.heatLayer);
            state.heatLayer = null;
        }

        const heatPoints = [];
        let renderedCount = 0;

        state.detectionsData.features.forEach((feat) => {
            const p = feat.properties;
            const [lon, lat] = feat.geometry.coordinates;

            // Class filter
            if (!state.activeClasses.has(p.predicted_class)) return;

            // Confidence filter
            if (p.prediction_confidence && p.prediction_confidence < state.minConfidence) return;

            // FRP filter
            if (p.frp && p.frp < state.minFRP) return;

            // Collect heat points: [lat, lng, intensity]
            heatPoints.push([lat, lon, Math.min((p.frp || 2) / 10, 1.0)]);

            // Marker appearance
            const color = CLASS_COLORS[p.predicted_class] || "#06b6d4";
            const isHighFrp = p.frp && p.frp >= 15;
            const radius = isHighFrp ? 7 : (p.predicted_class === "Industrial" ? 6 : 5);

            const marker = L.circleMarker([lat, lon], {
                radius: radius,
                fillColor: color,
                color: isHighFrp ? "#ffffff" : color,
                weight: isHighFrp ? 2 : 1,
                opacity: 0.9,
                fillOpacity: 0.75,
            });

            // Interactive Popup
            const popupHtml = `
                <div style="min-width: 200px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 6px;">
                        <span style="background:${color}; color:#fff; font-size:10px; font-weight:700; padding:2px 6px; border-radius:4px; text-transform:uppercase;">
                            ${p.predicted_class}
                        </span>
                        <span style="font-family:monospace; font-size:11px; color:#4ade80; font-weight:700;">
                            ${(p.prediction_confidence * 100).toFixed(1)}% Conf
                        </span>
                    </div>
                    <div style="font-size:11px; color:#cbd5e1; margin-bottom:4px;">
                        <strong>Location:</strong> ${lat.toFixed(4)}° N, ${lon.toFixed(4)}° E
                    </div>
                    <div style="font-size:11px; color:#cbd5e1; margin-bottom:4px;">
                        <strong>FRP:</strong> <span style="color:#f87171; font-weight:700;">${p.frp || 'N/A'} MW</span> | 
                        <strong>TI4:</strong> ${p.bright_ti4 || 'N/A'} K
                    </div>
                    <div style="font-size:10px; color:#94a3b8; margin-top:6px; border-top:1px solid rgba(255,255,255,0.1); padding-top:4px;">
                        ${p.acq_date || '2022'} • Pass: ${p.daynight === 'D' ? '☀️ Day' : '🌙 Night'}
                    </div>
                </div>
            `;

            marker.bindPopup(popupHtml, { closeButton: true });

            marker.on("click", () => {
                showDetectionDetails({ ...p, latitude: lat, longitude: lon });
            });

            state.detectionsLayer.addLayer(marker);
            renderedCount++;
        });

        // Initialize / Update Heatmap if checked
        const heatmapCheckbox = document.getElementById("toggle-heatmap");
        if (heatmapCheckbox && heatmapCheckbox.checked && heatPoints.length > 0 && typeof L.heatLayer === "function") {
            state.heatLayer = L.heatLayer(heatPoints, {
                radius: 18,
                blur: 14,
                maxZoom: 14,
                gradient: { 0.2: "#3b82f6", 0.5: "#eab308", 0.8: "#f97316", 1.0: "#ef4444" }
            }).addTo(state.map);
        }

        document.getElementById("rendered-features-count").textContent = `${renderedCount.toLocaleString()} items rendered`;
    }

    /**
     * Render Persistent Source Clusters
     */
    function renderSourcesLayer(geojson) {
        state.sourcesLayer.clearLayers();
        if (!geojson || !geojson.features) return;

        geojson.features.forEach((feat) => {
            const p = feat.properties;
            const [lon, lat] = feat.geometry.coordinates;

            const ringMarker = L.circleMarker([lat, lon], {
                radius: Math.min(12 + p.detection_count * 0.15, 22),
                fillColor: "transparent",
                color: "#38bdf8",
                weight: 1.8,
                dashArray: "4, 4",
                opacity: 0.85,
            });

            ringMarker.bindTooltip(`Persistent Source #${p.source_cluster_id}<br/>${p.dominant_class} (${p.detection_count} detections)`, {
                direction: "top",
                className: "custom-leaflet-tooltip"
            });

            ringMarker.on("click", () => {
                showDetectionDetails({
                    predicted_class: p.dominant_class,
                    prediction_confidence: p.avg_confidence,
                    latitude: lat,
                    longitude: lon,
                    frp: p.avg_frp,
                    source_cluster_id: p.source_cluster_id,
                    n_detections_at_source: p.detection_count,
                    unique_days_active: p.active_days,
                    days_active_span: `${p.first_seen} to ${p.last_seen}`,
                });
            });

            state.sourcesLayer.addLayer(ringMarker);
        });
    }

    /**
     * Show Selected Detection in Right Inspector Panel
     */
    function showDetectionDetails(p) {
        state.selectedDetection = p;

        const panel = document.getElementById("inspector-panel");
        const emptyState = document.getElementById("detail-empty-state");
        const detailCard = document.getElementById("detail-card");

        panel.classList.remove("hidden");
        emptyState.classList.add("hidden");
        detailCard.classList.remove("hidden");

        // Activate Details Tab
        switchInspectorTab("tab-details");

        // Header info
        const classBadge = document.getElementById("detail-class-badge");
        classBadge.textContent = p.predicted_class || "Unknown";
        classBadge.style.backgroundColor = CLASS_COLORS[p.predicted_class] || "#06b6d4";

        const confVal = p.prediction_confidence ? (p.prediction_confidence * 100).toFixed(1) : "95.0";
        document.getElementById("detail-conf-badge").textContent = `${confVal}% Conf`;

        document.getElementById("detail-id").textContent = p.source_cluster_id || p.acq_time || "4092";
        document.getElementById("detail-coords").textContent = `${p.latitude ? p.latitude.toFixed(4) : '--'}° N, ${p.longitude ? p.longitude.toFixed(4) : '--'}° E`;

        // Thermal Metrics
        document.getElementById("detail-frp").textContent = `${p.frp ? parseFloat(p.frp).toFixed(1) : '--'} MW`;
        document.getElementById("detail-ti4").textContent = `${p.bright_ti4 ? parseFloat(p.bright_ti4).toFixed(1) : '--'} K`;
        document.getElementById("detail-ti5").textContent = `${p.bright_ti5 ? parseFloat(p.bright_ti5).toFixed(1) : '--'} K`;

        const tiDiff = p.bright_ti4 && p.bright_ti5 ? (parseFloat(p.bright_ti4) - parseFloat(p.bright_ti5)).toFixed(1) : (p.ti_diff ? parseFloat(p.ti_diff).toFixed(1) : '--');
        document.getElementById("detail-ti-diff").textContent = `${tiDiff} K`;

        // Landcover & OSM Context
        document.getElementById("detail-landcover").textContent = p.worldcover_name || "Built-up / Bare";
        document.getElementById("detail-osm-name").textContent = p.nearest_osm_name || "Industrial Facility / Kiln";
        document.getElementById("detail-osm-dist").textContent = p.distance_to_landuse_m ? `${Math.round(p.distance_to_landuse_m)} meters` : "Adjacent (< 300m)";

        // Persistence
        document.getElementById("detail-persist-count").textContent = p.n_detections_at_source || (p.detection_count || "12");
        document.getElementById("detail-persist-days").textContent = p.unique_days_active || (p.active_days || "6");
        document.getElementById("detail-persist-span").textContent = typeof p.days_active_span === "number" ? `${Math.round(p.days_active_span)}d` : (p.days_active_span || "30d");

        // Probabilities
        renderProbabilityBars("detail-prob-bars", p);
    }

    /**
     * Render Probability Mini Bars
     */
    function renderProbabilityBars(targetId, p) {
        const container = document.getElementById(targetId);
        if (!container) return;

        container.innerHTML = "";

        const classKeys = [
            { label: "Industrial", key: "prob_industrial", defaultProb: 0.85 },
            { label: "Forest fire", key: "prob_forest_fire", defaultProb: 0.05 },
            { label: "Quarry/Mining", key: "prob_quarry_mining", defaultProb: 0.06 },
            { label: "Agri burning", key: "prob_agricultural_burning", defaultProb: 0.02 },
            { label: "Vegetation", key: "prob_vegetation_fire_openscrub", defaultProb: 0.02 },
        ];

        classKeys.forEach(item => {
            let prob = 0.0;
            if (p[item.key] !== undefined) {
                prob = parseFloat(p[item.key]);
            } else if (p.predicted_class === item.label || (item.label === "Agri burning" && p.predicted_class === "Agricultural burning")) {
                prob = p.prediction_confidence ? parseFloat(p.prediction_confidence) : 0.85;
            } else {
                prob = (1.0 - (p.prediction_confidence || 0.85)) / 4;
            }

            const pct = (prob * 100).toFixed(1);
            const color = CLASS_COLORS[item.label] || CLASS_COLORS["Agricultural burning"] || "#06b6d4";

            const row = document.createElement("div");
            row.className = "prob-row";
            row.innerHTML = `
                <div class="prob-label-row">
                    <span>${item.label}</span>
                    <strong>${pct}%</strong>
                </div>
                <div class="prob-track">
                    <div class="prob-fill" style="width: ${pct}%; background-color: ${color};"></div>
                </div>
            `;
            container.appendChild(row);
        });
    }

    /**
     * Toggle Real-Time NASA FIRMS View
     */
    async function toggleRealtimeView(forceState) {
        state.isRealtimeMode = forceState !== undefined ? forceState : !state.isRealtimeMode;
        const btn = document.getElementById("btn-realtime-toggle");
        const label = document.getElementById("realtime-btn-label");
        const banner = document.getElementById("realtime-status-banner");
        const bannerMsg = document.getElementById("realtime-banner-msg");

        if (state.isRealtimeMode) {
            btn.classList.add("active-live");
            label.textContent = "🌐 Full Baseline";
            banner.classList.remove("hidden");
            bannerMsg.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Fetching live anomalies from NASA FIRMS VIIRS NOAA-21 (URT+NRT) (last ${state.realtimeDays} days)...`;
            showToast(`Connecting to real-time NASA FIRMS VIIRS NOAA-21 feed (${state.realtimeDays}d)...`, "info");

            try {
                const res = await fetch(`/api/detections/realtime?days=${state.realtimeDays}&source=VIIRS_NOAA21_NRT`);
                const data = await res.json();
                state.realtimeData = data;

                const count = data.metadata ? data.metadata.count : (data.features ? data.features.length : 0);
                if (count > 0) {
                    bannerMsg.textContent = `Displaying ${count} live thermal anomalies detected in the last ${state.realtimeDays} days by VIIRS NOAA-21 (URT+NRT).`;
                    showToast(`NASA FIRMS NOAA-21: ${count} live thermal anomalies found!`, "success");
                } else {
                    bannerMsg.textContent = `NASA FIRMS VIIRS NOAA-21: 0 active thermal anomalies in Jharkhand in the past ${state.realtimeDays} days.`;
                    showToast(`NASA FIRMS NOAA-21: 0 active anomalies in past ${state.realtimeDays} days.`, "info");
                }

                // Render real-time feed on map
                renderRealtimeFeed(data);

            } catch (err) {
                console.error("Live feed fetch error:", err);
                bannerMsg.textContent = "Error fetching live feed from NASA FIRMS API.";
                showToast("Failed to fetch live NASA FIRMS feed", "error");
            }
        } else {
            // Return to Full Baseline
            btn.classList.remove("active-live");
            label.textContent = "🔴 Live FIRMS Feed";
            banner.classList.add("hidden");
            showToast("Switched back to Full Baseline (31k anomalies)", "info");

            // Restore baseline stats
            if (state.statsData) {
                document.getElementById("val-total-count").textContent = (state.statsData.total_detections || 0).toLocaleString();
                document.getElementById("val-industrial-count").textContent = (state.statsData.by_class?.Industrial || 0).toLocaleString();
                document.getElementById("val-forest-count").textContent = (state.statsData.by_class?.["Forest fire"] || 0).toLocaleString();
                document.getElementById("val-quarry-count").textContent = (state.statsData.by_class?.["Quarry/Mining"] || 0).toLocaleString();
                document.getElementById("val-agri-count").textContent = (state.statsData.by_class?.["Agricultural burning"] || 0).toLocaleString();
                document.getElementById("val-max-frp").textContent = `${state.statsData.max_frp || 0} MW`;
            }

            applyFiltersAndRender();
            if (state.sourcesLayer) state.sourcesLayer.addTo(state.map);
        }
    }

    /**
     * Render Real-Time Feed on Map
     */
    function renderRealtimeFeed(geojson) {
        state.detectionsLayer.clearLayers();
        if (state.heatLayer) {
            state.map.removeLayer(state.heatLayer);
            state.heatLayer = null;
        }

        const features = geojson.features || [];
        const classCounts = {
            "Industrial": 0,
            "Forest fire": 0,
            "Quarry/Mining": 0,
            "Agricultural burning": 0,
            "Vegetation fire (open/scrub)": 0,
        };
        let maxFrp = 0;
        const latLngs = [];

        features.forEach((feat) => {
            const p = feat.properties;
            const [lon, lat] = feat.geometry.coordinates;
            latLngs.push([lat, lon]);

            if (p.predicted_class && classCounts[p.predicted_class] !== undefined) {
                classCounts[p.predicted_class]++;
            }
            if (p.frp && p.frp > maxFrp) {
                maxFrp = p.frp;
            }

            const color = CLASS_COLORS[p.predicted_class] || "#ef4444";
            const marker = L.circleMarker([lat, lon], {
                radius: 8,
                fillColor: color,
                color: "#ffffff",
                weight: 2,
                opacity: 1,
                fillOpacity: 0.85,
            });

            const popupHtml = `
                <div style="min-width: 210px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 6px;">
                        <span style="background:${color}; color:#fff; font-size:10px; font-weight:700; padding:2px 6px; border-radius:4px; text-transform:uppercase;">
                            ${p.predicted_class}
                        </span>
                        <span style="background:rgba(239,68,68,0.2); color:#fca5a5; font-size:9px; font-weight:700; padding:1px 5px; border-radius:3px;">
                            LIVE URT
                        </span>
                    </div>
                    <div style="font-size:11px; color:#cbd5e1; margin-bottom:4px;">
                        <strong>Location:</strong> ${lat.toFixed(4)}° N, ${lon.toFixed(4)}° E
                    </div>
                    <div style="font-size:11px; color:#cbd5e1; margin-bottom:4px;">
                        <strong>FRP:</strong> <span style="color:#f87171; font-weight:700;">${p.frp || 'N/A'} MW</span> | 
                        <strong>TI4:</strong> ${p.bright_ti4 || 'N/A'} K
                    </div>
                    <div style="font-size:11px; color:#cbd5e1; margin-bottom:4px;">
                        <strong>Confidence:</strong> ${(p.prediction_confidence * 100).toFixed(1)}%
                    </div>
                    <div style="font-size:10px; color:#94a3b8; margin-top:6px; border-top:1px solid rgba(255,255,255,0.1); padding-top:4px;">
                        ${p.acq_date || 'Today'} ${p.acq_time ? '(' + p.acq_time + ' UTC)' : ''} • Satellite: VIIRS NOAA-21 (URT+NRT)
                    </div>
                </div>
            `;

            marker.bindPopup(popupHtml, { closeButton: true });
            marker.on("click", () => {
                showDetectionDetails({ ...p, latitude: lat, longitude: lon });
            });

            state.detectionsLayer.addLayer(marker);
        });

        // Update KPI Ticker with Real-Time Values
        document.getElementById("val-total-count").textContent = features.length.toLocaleString();
        document.getElementById("val-industrial-count").textContent = classCounts["Industrial"].toLocaleString();
        document.getElementById("val-forest-count").textContent = classCounts["Forest fire"].toLocaleString();
        document.getElementById("val-quarry-count").textContent = classCounts["Quarry/Mining"].toLocaleString();
        document.getElementById("val-agri-count").textContent = classCounts["Agricultural burning"].toLocaleString();
        document.getElementById("val-max-frp").textContent = `${maxFrp.toFixed(1)} MW`;

        document.getElementById("rendered-features-count").textContent = `${features.length} real-time items rendered`;

        // Fit map bounds if points present
        if (latLngs.length > 0) {
            state.map.fitBounds(L.latLngBounds(latLngs), { padding: [50, 50], maxZoom: 11 });
        }
    }

    /**
     * UI Event Listeners
     */
    function initUIEventListeners() {
        // Real-Time Live Feed Toggle Button
        const realtimeBtn = document.getElementById("btn-realtime-toggle");
        if (realtimeBtn) {
            realtimeBtn.addEventListener("click", () => toggleRealtimeView());
        }

        const exitRealtimeBtn = document.getElementById("btn-exit-realtime");
        if (exitRealtimeBtn) {
            exitRealtimeBtn.addEventListener("click", () => toggleRealtimeView(false));
        }

        const realtimeDaysBtn = document.getElementById("btn-realtime-days-toggle");
        if (realtimeDaysBtn) {
            realtimeDaysBtn.addEventListener("click", () => {
                state.realtimeDays = state.realtimeDays === 1 ? 5 : (state.realtimeDays === 5 ? 2 : 1);
                document.getElementById("label-realtime-days").textContent = `${state.realtimeDays} Day${state.realtimeDays > 1 ? 's' : ''} Window`;
                if (state.isRealtimeMode) {
                    toggleRealtimeView(true);
                }
            });
        }

        // Class Checkbox Toggles
        document.querySelectorAll(".sidebar-content input[type='checkbox'][data-class]").forEach((cb) => {
            cb.addEventListener("change", () => {
                const cls = cb.getAttribute("data-class");
                if (cb.checked) {
                    state.activeClasses.add(cls);
                } else {
                    state.activeClasses.delete(cls);
                }
                document.getElementById("visible-layers-count").textContent = `${state.activeClasses.size} Active`;
                applyFiltersAndRender();
            });
        });

        // Confidence Slider
        const confSlider = document.getElementById("slider-confidence");
        const confBadge = document.getElementById("conf-val-badge");
        confSlider.addEventListener("input", (e) => {
            state.minConfidence = parseInt(e.target.value) / 100;
            confBadge.textContent = `≥ ${e.target.value}%`;
            applyFiltersAndRender();
        });

        // FRP Slider
        const frpSlider = document.getElementById("slider-frp");
        const frpBadge = document.getElementById("frp-val-badge");
        frpSlider.addEventListener("input", (e) => {
            state.minFRP = parseFloat(e.target.value);
            frpBadge.textContent = `≥ ${e.target.value} MW`;
            applyFiltersAndRender();
        });

        // Day / Night Toggle
        document.querySelectorAll("#btn-group-daynight .btn-toggle").forEach((btn) => {
            btn.addEventListener("click", () => {
                document.querySelectorAll("#btn-group-daynight .btn-toggle").forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
                state.daynight = btn.getAttribute("data-val");
                fetchDetections();
            });
        });

        // District Jump
        const districtSelect = document.getElementById("select-district-jump");
        districtSelect.addEventListener("change", (e) => {
            const dest = DISTRICT_BOUNDS[e.target.value] || DISTRICT_BOUNDS.ALL;
            state.map.flyTo(dest.center, dest.zoom, { duration: 1.5 });
        });

        // Basemap Cards
        document.querySelectorAll(".basemap-card").forEach((card) => {
            card.addEventListener("click", () => {
                document.querySelectorAll(".basemap-card").forEach(c => c.classList.remove("active"));
                card.classList.add("active");
                const mapType = card.getAttribute("data-map");

                // Switch basemap layer
                Object.values(state.baseLayers).forEach(layer => state.map.removeLayer(layer));
                if (state.baseLayers[mapType]) {
                    state.baseLayers[mapType].addTo(state.map);
                    state.baseLayers[mapType].bringToBack();
                }
            });
        });

        // Jharkhand State Border Toggle
        const boundaryToggle = document.getElementById("toggle-boundary");
        if (boundaryToggle) {
            boundaryToggle.addEventListener("change", (e) => {
                if (!state.boundaryLayer) return;
                if (e.target.checked) {
                    state.boundaryLayer.addTo(state.map);
                    state.boundaryLayer.bringToBack();
                } else {
                    state.map.removeLayer(state.boundaryLayer);
                }
            });
        }

        // Heatmap Toggle
        document.getElementById("toggle-heatmap").addEventListener("change", () => {
            applyFiltersAndRender();
        });

        // Persistent Sources Toggle
        document.getElementById("toggle-sources").addEventListener("change", (e) => {
            if (e.target.checked) {
                state.sourcesLayer.addTo(state.map);
            } else {
                state.map.removeLayer(state.sourcesLayer);
            }
        });

        // OSM Overlay Toggle
        document.getElementById("toggle-osm-overlay").addEventListener("change", async (e) => {
            if (e.target.checked) {
                if (state.osmLayer.getLayers().length === 0) {
                    showToast("Loading OSM infrastructure outlines...", "info");
                    try {
                        const res = await fetch("/api/osm/features?limit=1500");
                        const data = await res.json();
                        L.geoJSON(data, {
                            style: {
                                color: "#38bdf8",
                                weight: 1.5,
                                fillOpacity: 0.15,
                                fillColor: "#0284c7",
                            },
                            onEachFeature: (feature, layer) => {
                                const p = feature.properties || {};
                                layer.bindTooltip(`${p.name || 'Industrial Facility'} (${p.landuse || p.natural || 'site'})`);
                            }
                        }).addTo(state.osmLayer);
                    } catch (err) {
                        showToast("Failed to load OSM overlay", "error");
                    }
                }
                state.osmLayer.addTo(state.map);
            } else {
                state.map.removeLayer(state.osmLayer);
            }
        });

        // Reset Filters
        document.getElementById("btn-reset-filters").addEventListener("click", () => {
            state.activeClasses = new Set(["Industrial", "Forest fire", "Quarry/Mining", "Agricultural burning", "Vegetation fire (open/scrub)"]);
            document.querySelectorAll(".sidebar-content input[type='checkbox'][data-class]").forEach(cb => cb.checked = true);
            const bToggle = document.getElementById("toggle-boundary");
            if (bToggle) bToggle.checked = true;
            if (state.boundaryLayer) {
                state.boundaryLayer.addTo(state.map);
                state.boundaryLayer.bringToBack();
            }
            confSlider.value = 50;
            state.minConfidence = 0.5;
            confBadge.textContent = "≥ 50%";
            frpSlider.value = 0;
            state.minFRP = 0;
            frpBadge.textContent = "≥ 0 MW";
            districtSelect.value = "ALL";
            if (state.boundaryLayer && state.boundaryLayer.getBounds().isValid()) {
                state.map.fitBounds(state.boundaryLayer.getBounds(), { padding: [20, 20] });
            } else {
                state.map.flyTo(DISTRICT_BOUNDS.ALL.center, DISTRICT_BOUNDS.ALL.zoom);
            }
            applyFiltersAndRender();
            showToast("Filters reset to default", "info");
        });

        // Real-time FIRMS Fetch Button
        document.getElementById("btn-fetch-firms").addEventListener("click", async () => {
            const btn = document.getElementById("btn-fetch-firms");
            btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Ingesting...`;
            btn.disabled = true;

            try {
                const res = await fetch("/api/fetch-firms?days=1&source=VIIRS_NOAA21_NRT", { method: "POST" });
                const result = await res.json();

                if (result.new_detections_count > 0) {
                    showToast(`Ingested ${result.new_detections_count} real-time VIIRS NOAA-21 anomalies!`, "success");
                    await fetchStats();
                    await fetchDetections();
                } else {
                    showToast(result.message || "FIRMS queried: 0 active anomalies in past 24h", "info");
                }
            } catch (err) {
                showToast("Failed to fetch real-time FIRMS data", "error");
            } finally {
                btn.innerHTML = `<i class="fa-solid fa-satellite-dish"></i> Sync NASA FIRMS`;
                btn.disabled = false;
            }
        });

        // Toggle Analytics Drawer
        const drawer = document.getElementById("analytics-drawer");
        const toggleDrawer = () => {
            state.isDrawerCollapsed = !state.isDrawerCollapsed;
            if (state.isDrawerCollapsed) {
                drawer.classList.add("collapsed");
                document.getElementById("btn-drawer-collapse").innerHTML = `<i class="fa-solid fa-chevron-up"></i>`;
            } else {
                drawer.classList.remove("collapsed");
                document.getElementById("btn-drawer-collapse").innerHTML = `<i class="fa-solid fa-chevron-down"></i>`;
            }
        };

        document.getElementById("drawer-toggle-bar").addEventListener("click", toggleDrawer);
        document.getElementById("btn-toggle-analytics").addEventListener("click", toggleDrawer);

        // Toggle Inspector Panel
        const inspector = document.getElementById("inspector-panel");
        document.getElementById("btn-toggle-inspector").addEventListener("click", () => {
            inspector.classList.toggle("hidden");
            if (!inspector.classList.contains("hidden")) {
                switchInspectorTab("tab-simulator");
            }
        });

        document.getElementById("btn-close-inspector").addEventListener("click", () => {
            inspector.classList.add("hidden");
        });

        // Inspector Tabs
        document.querySelectorAll(".inspector-tabs .tab-btn").forEach((btn) => {
            btn.addEventListener("click", () => {
                switchInspectorTab(btn.getAttribute("data-tab"));
            });
        });

        // Simulator Form Submit
        document.getElementById("form-simulator").addEventListener("submit", async (e) => {
            e.preventDefault();
            const submitBtn = document.getElementById("btn-run-sim");
            submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Inferencing...`;
            submitBtn.disabled = true;

            const payload = {
                latitude: parseFloat(document.getElementById("sim-lat").value),
                longitude: parseFloat(document.getElementById("sim-lon").value),
                frp: parseFloat(document.getElementById("sim-frp").value),
                confidence: document.getElementById("sim-conf").value,
                bright_ti4: parseFloat(document.getElementById("sim-ti4").value),
                bright_ti5: parseFloat(document.getElementById("sim-ti5").value),
            };

            try {
                const res = await fetch("/api/classify-point", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                });
                const result = await res.json();

                // Display results
                const resultBox = document.getElementById("sim-result-box");
                resultBox.classList.remove("hidden");

                const predBadge = document.getElementById("sim-predicted-class");
                predBadge.textContent = result.predicted_class;
                predBadge.style.backgroundColor = result.color;

                document.getElementById("sim-conf-score").textContent = `${(result.prediction_confidence * 100).toFixed(1)}%`;
                document.getElementById("sim-landcover").textContent = result.worldcover_name;
                document.getElementById("sim-osm").textContent = `${result.nearest_osm_name || result.nearest_osm_type} (${Math.round(result.distance_to_landuse_m)}m)`;

                // Render probabilities
                renderProbabilityBars("sim-prob-bars", result);

                // Add simulated marker on map
                const simMarker = L.circleMarker([payload.latitude, payload.longitude], {
                    radius: 9,
                    fillColor: result.color,
                    color: "#ffffff",
                    weight: 3,
                    opacity: 1,
                    fillOpacity: 0.9,
                }).addTo(state.map);

                simMarker.bindPopup(`<strong>Simulated Point</strong><br/>Class: ${result.predicted_class}<br/>Confidence: ${(result.prediction_confidence * 100).toFixed(1)}%`).openPopup();
                state.map.flyTo([payload.latitude, payload.longitude], 12);

                showToast(`Inference Complete: Classified as ${result.predicted_class}`, "success");
            } catch (err) {
                showToast("Classification inference failed", "error");
            } finally {
                submitBtn.innerHTML = `<i class="fa-solid fa-microchip"></i> Run AI Classification`;
                submitBtn.disabled = false;
            }
        });
    }

    /**
     * Switch Tab inside Inspector
     */
    function switchInspectorTab(tabId) {
        document.querySelectorAll(".inspector-tabs .tab-btn").forEach(btn => {
            btn.classList.toggle("active", btn.getAttribute("data-tab") === tabId);
        });
        document.querySelectorAll(".inspector-body .tab-content").forEach(content => {
            content.classList.toggle("active", content.id === tabId);
        });
    }

    /**
     * Toast Notifications
     */
    function showToast(message, type = "info") {
        const container = document.getElementById("toast-container");
        if (!container) return;

        const toast = document.createElement("div");
        toast.className = `toast ${type}`;

        let icon = "fa-circle-info";
        if (type === "success") icon = "fa-circle-check";
        if (type === "warning") icon = "fa-triangle-exclamation";
        if (type === "error") icon = "fa-circle-xmark";

        toast.innerHTML = `<i class="fa-solid ${icon}"></i><span>${message}</span>`;
        container.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = "0";
            toast.style.transform = "translateX(100%)";
            toast.style.transition = "all 0.3s ease";
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }

})();
