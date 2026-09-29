/**
 * ThermalIntell — Main GIS Dashboard Application
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
        isRealtimeMode: true,
        realtimeData: null,
        realtimeDays: 5,
        realtimeSource: "VIIRS_NOAA21_NRT",
        autoSyncInterval: null,
        _initialBoundsFitted: false,
    };
    window.__appState = state;

    // Color definitions — Cowboy Space Dark-Warm Palette
    const CLASS_COLORS = {
        "Industrial": "#c14f09",
        "Forest fire": "#6b9956",
        "Quarry/Mining": "#c49a3c",
        "Agricultural burning": "#a8863e",
        "Vegetation fire (open/scrub)": "#7a9e7e",
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
        if (window.dashboardCharts) {
            window.dashboardCharts.init();
        }

        // 1. Render official Jharkhand administrative boundary
        await fetchBoundary();

        // 2. Load all 150 persistent industrial thermal source clusters across Jharkhand
        await fetchSources();

        // 3. Immediately fetch & display Live Real-Time NASA FIRMS Stream!
        await loadRealtimeData();

        // 4. Start auto-synchronization background polling
        startAutoSync();
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

            if (state.boundaryLayer) {
                state.map.removeLayer(state.boundaryLayer);
            }

            state.boundaryLayer = L.geoJSON(geojson, {
                style: {
                    color: "#00f0ff",
                    weight: 3.2,
                    opacity: 1.0,
                    dashArray: "10, 6",
                    fillColor: "#06b6d4",
                    fillOpacity: 0.05,
                },
                onEachFeature: (feature, layer) => {
                    layer.bindTooltip(
                        "<div style='font-family:Inter,sans-serif;padding:3px 6px;'><strong>State of Jharkhand</strong><br><span style='color:#38bdf8;font-size:10px;'>Official Thermal Monitoring Zone</span></div>",
                        { sticky: true }
                    );
                }
            }).addTo(state.map);

            if (state.boundaryLayer.getBounds().isValid()) {
                state.map.fitBounds(state.boundaryLayer.getBounds(), { padding: [25, 25] });
                state._initialBoundsFitted = true;
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
        if (state.isRealtimeMode && state.realtimeData) {
            renderRealtimeFeed(state.realtimeData);
            return;
        }
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
        if (!state.sourcesLayer) return;
        state.sourcesLayer.clearLayers();
        if (!geojson || !geojson.features) return;

        geojson.features.forEach((feat) => {
            const p = feat.properties;
            const [lon, lat] = feat.geometry.coordinates;

            const ringMarker = L.circleMarker([lat, lon], {
                radius: Math.min(13 + (p.detection_count || 1) * 0.12, 24),
                fillColor: "rgba(56, 189, 248, 0.08)",
                color: "#38bdf8",
                weight: 2.2,
                dashArray: "5, 5",
                opacity: 0.95,
                fillOpacity: 0.2,
            });

            ringMarker.bindTooltip(
                `<div style="font-family:Inter,sans-serif;padding:3px 6px;"><strong>Persistent Source #${p.source_cluster_id}</strong><br/><span style="color:#38bdf8;font-weight:600;">${p.dominant_class}</span> (${p.detection_count} detections, avg FRP: ${p.avg_frp} MW)</div>`,
                { direction: "top", className: "custom-leaflet-tooltip" }
            );

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

        const sourcesToggle = document.getElementById("toggle-sources");
        if ((!sourcesToggle || sourcesToggle.checked) && !state.map.hasLayer(state.sourcesLayer)) {
            state.sourcesLayer.addTo(state.map);
        }
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

        // Meteorological Intelligence & Wildfire Feasibility
        fetchAndRenderWeather(p.latitude, p.longitude, p.predicted_class);

        // Optical Footprint Validation (ESA WorldCover)
        fetchAndRenderSatelliteRecon(p.latitude, p.longitude, p.predicted_class);

        // Store for Alert Dispatcher access via inline button onclick
        window.__lastDetection = p;

        // Update dispatch hint with computed severity
        if (window.AlertDispatcher) {
            const sevKey = window.AlertDispatcher.computeSeverity(p);
            const hintEl = document.getElementById("dispatch-hint-text");
            const hintWrap = document.getElementById("dispatch-triage-hint");
            if (hintEl && hintWrap) {
                const sevColors = { CRITICAL: "#b84226", HIGH: "#a86e35", MODERATE: "#8f7b2c" };
                const sevLabels = {
                    CRITICAL: "⚠️ CRITICAL severity — FRP / class triggers immediate NDRF dispatch.",
                    HIGH: "🔥 HIGH severity — District agencies & fire brigade will be alerted.",
                    MODERATE: "🟡 MODERATE severity — Local brigade & PCB monitoring cell notified.",
                };
                hintEl.textContent = sevLabels[sevKey] || "Severity computed from FRP & AI confidence.";
                hintWrap.style.borderLeftColor = sevColors[sevKey] || "#8f7b2c";
                hintWrap.style.color = sevColors[sevKey] || "#8f7b2c";
            }
        }
    }

    /**
     * Fetch & Display Live Weather & Fire Feasibility
     */
    async function fetchAndRenderWeather(lat, lon, predictedClass) {
        const tempEl = document.getElementById("detail-weather-temp");
        const rhEl = document.getElementById("detail-weather-rh");
        const rainEl = document.getElementById("detail-weather-rain");
        const windEl = document.getElementById("detail-weather-wind");
        const badgeEl = document.getElementById("detail-weather-badge");
        const textEl = document.getElementById("detail-weather-text");

        if (!tempEl || !lat || !lon) return;

        // Loading state
        tempEl.textContent = "...";
        rhEl.textContent = "...";
        rainEl.textContent = "...";
        windEl.textContent = "...";
        badgeEl.className = "badge-weather badge-suppressed";
        badgeEl.textContent = "QUERYING WEATHER...";
        textEl.textContent = "Analyzing ambient humidity and fuel moisture content...";

        try {
            const res = await fetch(`/api/weather/evaluate?latitude=${lat}&longitude=${lon}&predicted_class=${encodeURIComponent(predictedClass || '')}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const w = await res.json();

            tempEl.textContent = `${w.temperature_c.toFixed(1)}°C`;
            rhEl.textContent = `${w.relative_humidity_pct}%`;
            rainEl.textContent = `${w.precipitation_mm.toFixed(1)} mm`;
            windEl.textContent = `${w.wind_speed_kmh.toFixed(1)} km/h`;

            if (w.is_suppressed) {
                badgeEl.className = "badge-weather badge-suppressed";
                badgeEl.innerHTML = `<i class="fa-solid fa-shield-halved"></i> ${w.status_badge}`;
            } else if (w.risk_level && (w.risk_level.includes("CRITICAL") || w.risk_level.includes("HIGH"))) {
                badgeEl.className = "badge-weather badge-danger";
                badgeEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> ${w.status_badge}`;
            } else {
                badgeEl.className = "badge-weather badge-independent";
                badgeEl.innerHTML = `<i class="fa-solid fa-industry"></i> ${w.status_badge}`;
            }

            textEl.innerHTML = `<strong>${w.reason}</strong><br/><span style="color:#cbd5e1; font-size:10.5px; margin-top:3px; display:inline-block;">${w.verdict_text}</span>`;
        } catch (err) {
            console.warn("Weather evaluation fetch failed:", err);
            badgeEl.className = "badge-weather badge-suppressed";
            badgeEl.textContent = "WEATHER UNAVAILABLE";
            textEl.textContent = "Could not retrieve meteorological telemetry.";
        }
    }

    /**
     * Fetch & Display ESA WorldCover Optical Footprint Validation
     */
    async function fetchAndRenderSatelliteRecon(lat, lon, predictedClass) {
        const loadingEl = document.getElementById("recon-loading");
        const resultEl  = document.getElementById("recon-result");
        const barsEl    = document.getElementById("recon-bars");
        const dominantEl = document.getElementById("recon-dominant");
        const badgeEl   = document.getElementById("recon-verdict-badge");
        const textEl    = document.getElementById("recon-verdict-text");
        const pixelsEl  = document.getElementById("recon-pixels");
        const mixedEl   = document.getElementById("recon-mixed-warning");
        const mixedTextEl = document.getElementById("recon-mixed-text");
        const cardEl    = document.getElementById("recon-verdict-card");

        if (!loadingEl || !lat || !lon) return;

        // Reset to loading state
        loadingEl.classList.remove("hidden");
        resultEl.classList.add("hidden");
        mixedEl.classList.add("hidden");

        // Colour palette for WorldCover classes — Max Milkin Palette
        const RECON_COLORS = {
            "Tree cover":             "#3b4039",
            "Shrubland":              "#525c4e",
            "Grassland":              "#6d7866",
            "Cropland":               "#8f7b2c",
            "Built-up":               "#b84226",
            "Bare/sparse vegetation": "#a86e35",
            "Permanent water bodies": "#425660",
            "Herbaceous wetland":     "#4c6158",
            "Mangroves":              "#344c3c",
            "Moss and lichen":        "#5e5469",
        };

        try {
            const url = `/api/landcover/validate?latitude=${lat}&longitude=${lon}&predicted_class=${encodeURIComponent(predictedClass || '')}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const d = await res.json();

            // Dominant cover
            dominantEl.textContent = d.dominant_class || "Unknown";

            // Composition bars — sorted descending
            barsEl.innerHTML = "";
            const sortedCounts = Object.entries(d.pixel_counts || {})
                .sort((a, b) => b[1] - a[1])
                .slice(0, 6);

            sortedCounts.forEach(([name, pct]) => {
                const color = RECON_COLORS[name] || "#94a3b8";
                const row = document.createElement("div");
                row.className = "recon-bar-row";
                row.innerHTML = `
                    <div class="recon-bar-label-row">
                        <span class="recon-bar-name">${name}</span>
                        <strong class="recon-bar-pct" style="color:${color};">${pct}%</strong>
                    </div>
                    <div class="recon-bar-track">
                        <div class="recon-bar-fill" style="width:${pct}%; background:${color};"></div>
                    </div>`;
                barsEl.appendChild(row);
            });

            // Verdict badge
            const vColor = d.verdict_color || "#94a3b8";
            badgeEl.textContent = (d.verdict || "UNVERIFIED").replace(/_/g, " ");
            badgeEl.style.background = vColor + "22";
            badgeEl.style.color = vColor;
            badgeEl.style.borderColor = vColor + "55";
            textEl.textContent = d.verdict_text || "";
            cardEl.style.borderColor = vColor + "44";

            // Pixels sampled
            pixelsEl.textContent = d.total_pixels_sampled
                ? `${d.total_pixels_sampled.toLocaleString()} px sampled (ESA WorldCover 10m)`
                : "";

            // Mixed pixel warning
            if (d.mixed_pixel_warning) {
                mixedTextEl.textContent = d.mixed_pixel_warning;
                mixedEl.classList.remove("hidden");
            }

            // Show result
            loadingEl.classList.add("hidden");
            resultEl.classList.remove("hidden");

            // Render/Update Satellite Visual Viewport
            updateReconSatelliteMap(lat, lon);

        } catch (err) {
            console.warn("Satellite recon fetch failed:", err);
            loadingEl.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> <span>Footprint scan unavailable</span>`;
        }
    }

    let reconSatMiniMap = null;
    let reconSatMiniMarker = null;

    /**
     * Render or Update Satellite Mini-Map inside Optical Footprint Validation
     */
    function updateReconSatelliteMap(lat, lon) {
        const mapContainer = document.getElementById("recon-sat-map");
        const linkEl = document.getElementById("recon-sat-link");
        const coordsEl = document.getElementById("recon-sat-coords");
        if (!mapContainer || !lat || !lon) return;

        const numLat = parseFloat(lat);
        const numLon = parseFloat(lon);
        if (isNaN(numLat) || isNaN(numLon)) return;

        if (coordsEl) {
            coordsEl.textContent = `${numLat.toFixed(4)}°N, ${numLon.toFixed(4)}°E`;
        }

        if (linkEl) {
            linkEl.href = `https://www.google.com/maps/@${numLat},${numLon},18z/data=!3m1!1e3`;
        }

        try {
            if (!reconSatMiniMap) {
                reconSatMiniMap = L.map("recon-sat-map", {
                    center: [numLat, numLon],
                    zoom: 17,
                    zoomControl: false,
                    attributionControl: false,
                    dragging: true,
                    scrollWheelZoom: false,
                    doubleClickZoom: true,
                    touchZoom: false
                });

                // High-resolution satellite tiles (Google Hybrid / Satellite)
                L.tileLayer("https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}&key=AIzaSyDIaBUtw8BvmtVZ2yBN4hmHXcEJZzUsHbk", {
                    subdomains: ["0", "1", "2", "3"],
                    maxZoom: 20
                }).addTo(reconSatMiniMap);

                const crosshairIcon = L.divIcon({
                    className: "sat-crosshair-icon",
                    html: '<div class="sat-crosshair-ring"><div class="sat-crosshair-dot"></div></div>',
                    iconSize: [26, 26],
                    iconAnchor: [13, 13]
                });
                reconSatMiniMarker = L.marker([numLat, numLon], { icon: crosshairIcon }).addTo(reconSatMiniMap);
            } else {
                reconSatMiniMap.setView([numLat, numLon], 17);
                if (reconSatMiniMarker) {
                    reconSatMiniMarker.setLatLng([numLat, numLon]);
                }
            }
            setTimeout(() => {
                if (reconSatMiniMap) reconSatMiniMap.invalidateSize();
            }, 180);
        } catch (e) {
            console.warn("Failed to render recon satellite mini-map:", e);
        }
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
     * Fetch & Display Live NASA FIRMS Real-Time Data
     */
    async function loadRealtimeData(forceRefresh = false) {
        state.isRealtimeMode = true;
        const banner = document.getElementById("realtime-status-banner");
        const bannerMsg = document.getElementById("realtime-banner-msg");
        const days = state.realtimeDays || 5;
        const source = state.realtimeSource || "VIIRS_NOAA21_NRT";

        if (banner) banner.classList.remove("hidden");
        if (bannerMsg) {
            bannerMsg.innerHTML = `<i class="fa-solid fa-satellite fa-spin"></i> Synchronizing live anomalies from NASA FIRMS VIIRS NOAA-21 (last ${days} days)...`;
        }
        showToast(`Connecting to real-time NASA FIRMS stream (${days}d window)...`, "info");

        // Show spinner on total KPI
        const totalCountEl = document.getElementById("val-total-count");
        if (totalCountEl) totalCountEl.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;

        try {
            const url = `/api/detections/realtime?days=${days}&source=${source}&force_refresh=${forceRefresh}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            state.realtimeData = data;
            state.detectionsData = data;

            const count = data.metadata ? data.metadata.count : (data.features ? data.features.length : 0);
            if (bannerMsg) {
                bannerMsg.textContent = count > 0
                    ? `Displaying ${count} live thermal anomalies detected in the last ${days} days across Jharkhand by VIIRS NOAA-21.`
                    : `NASA FIRMS: 0 active thermal anomalies detected in Jharkhand in past ${days} day(s).`;
            }

            renderRealtimeFeed(data);
            showToast(`NASA FIRMS: ${count} real-time anomalies loaded!`, "success");
        } catch (err) {
            console.error("Failed to load real-time FIRMS data:", err);
            if (bannerMsg) bannerMsg.textContent = "Error connecting to NASA FIRMS API.";
            showToast("Failed to fetch live NASA FIRMS feed", "error");
        }
    }

    /**
     * Render Real-Time Feed on Leaflet Map & Synchronize All UI Elements
     */
    function renderRealtimeFeed(geojson) {
        if (!geojson) return;

        // Clear ONLY the detection markers — NEVER clear the persistent sources layer!
        state.detectionsLayer.clearLayers();

        // Ensure persistent sources are on the map if they were loaded
        if (state.sourcesLayer && state.sourcesLayer.getLayers().length === 0 && state.sourcesData) {
            renderSourcesLayer(state.sourcesData);
        } else if (state.sourcesLayer && state.sourcesLayer.getLayers().length === 0 && !state.sourcesData) {
            fetchSources();
        }

        if (state.heatLayer) {
            state.map.removeLayer(state.heatLayer);
            state.heatLayer = null;
        }

        const features = geojson.features || [];
        const meta = geojson.metadata || {};
        const classCounts = {
            "Industrial": 0,
            "Forest fire": 0,
            "Quarry/Mining": 0,
            "Agricultural burning": 0,
            "Vegetation fire (open/scrub)": 0,
        };

        let maxFrp = 0;
        let renderedCount = 0;
        const heatPoints = [];

        // Count totals from all features
        features.forEach((feat) => {
            const p = feat.properties || {};
            if (p.predicted_class && classCounts[p.predicted_class] !== undefined) {
                classCounts[p.predicted_class]++;
            }
            if (p.frp && p.frp > maxFrp) {
                maxFrp = p.frp;
            }
        });

        // Filter and render live detection markers
        features.forEach((feat) => {
            const p = feat.properties || {};
            const coords = feat.geometry ? feat.geometry.coordinates : [0, 0];
            const [lon, lat] = coords;

            // Filter: Class
            if (!state.activeClasses.has(p.predicted_class)) return;

            // Filter: Confidence
            if (p.prediction_confidence && p.prediction_confidence < state.minConfidence) return;

            // Filter: FRP
            if (p.frp && p.frp < state.minFRP) return;

            // Filter: Day / Night
            if (state.daynight !== "ALL" && p.daynight && p.daynight !== state.daynight) return;

            heatPoints.push([lat, lon, Math.min((p.frp || 2) / 10, 1.0)]);

            const color = CLASS_COLORS[p.predicted_class] || "#ef4444";
            const isHighFrp = p.frp && p.frp >= 15;
            const radius = isHighFrp ? 8.5 : (p.predicted_class === "Industrial" ? 7.5 : 6);

            const marker = L.circleMarker([lat, lon], {
                radius: radius,
                fillColor: color,
                color: "#ffffff",
                weight: 1.8,
                opacity: 1.0,
                fillOpacity: 0.9,
            });

            const confPct = p.prediction_confidence ? (p.prediction_confidence * 100).toFixed(1) : "95.0";
            const dateStr = p.acq_date ? String(p.acq_date).split(" ")[0] : "Today";
            const timeStr = p.acq_time ? ` (${p.acq_time} UTC)` : "";

            const popupHtml = `
                <div style="min-width: 220px; font-family: Inter, sans-serif; background:#2a1f0e; padding:4px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 6px;">
                        <span style="background:${color}; color:#f9f7f3; font-size:10px; font-weight:700; padding:2px 7px; border-radius:4px; text-transform:uppercase;">
                            ${p.predicted_class}
                        </span>
                        <span style="background:rgba(107,153,86,0.2); color:#7ac470; font-size:9px; font-weight:700; padding:2px 6px; border-radius:3px; border:1px solid rgba(107,153,86,0.35);">
                            🟢 LIVE SATELLITE
                        </span>
                    </div>
                    <div style="font-size:11px; color:#c4b89a; margin-bottom:4px;">
                        <strong style="color:#f9f7f3;">Location:</strong> ${lat.toFixed(4)}° N, ${lon.toFixed(4)}° E
                    </div>
                    <div style="font-size:11px; color:#c4b89a; margin-bottom:4px;">
                        <strong style="color:#f9f7f3;">FRP:</strong> <span style="color:#ff7443; font-weight:700;">${p.frp ? p.frp.toFixed(1) : 'N/A'} MW</span> | 
                        <strong style="color:#f9f7f3;">Brightness:</strong> ${p.bright_ti4 ? p.bright_ti4.toFixed(1) : 'N/A'} K
                    </div>
                    <div style="font-size:11px; color:#c4b89a; margin-bottom:4px;">
                        <strong style="color:#f9f7f3;">AI Confidence:</strong> <span style="color:#7ac470; font-weight:700;">${confPct}%</span>
                    </div>
                    <div style="font-size:10.5px; color:#9c9180; margin-top:6px; border-top:1px solid rgba(196,184,154,0.12); padding-top:4px;">
                        📅 ${dateStr}${timeStr} • VIIRS NOAA-21 (${p.daynight === 'D' ? '☀️ Day' : '🌙 Night'})
                    </div>
                </div>
            `;

            marker.bindPopup(popupHtml, { closeButton: true });
            marker.bindTooltip(`<strong>${p.predicted_class}</strong> • FRP ${p.frp ? p.frp.toFixed(1) : 'N/A'} MW (Live)`, {
                direction: "top",
                className: "custom-leaflet-tooltip"
            });

            marker.on("click", () => {
                showDetectionDetails({ ...p, latitude: lat, longitude: lon });
            });

            state.detectionsLayer.addLayer(marker);
            renderedCount++;
        });

        // FRP Heatmap
        const heatmapCheckbox = document.getElementById("toggle-heatmap");
        if (heatmapCheckbox && heatmapCheckbox.checked && heatPoints.length > 0 && typeof L.heatLayer === "function") {
            state.heatLayer = L.heatLayer(heatPoints, {
                radius: 20,
                blur: 15,
                maxZoom: 14,
                gradient: { 0.2: "#3b82f6", 0.5: "#eab308", 0.8: "#f97316", 1.0: "#ef4444" },
            }).addTo(state.map);
        }

        // Update Top KPI Counters
        const totalCountEl = document.getElementById("val-total-count");
        if (totalCountEl) totalCountEl.textContent = features.length.toLocaleString();
        document.getElementById("val-industrial-count").textContent = (classCounts["Industrial"] || 0).toLocaleString();
        document.getElementById("val-forest-count").textContent = (classCounts["Forest fire"] || 0).toLocaleString();
        document.getElementById("val-quarry-count").textContent = (classCounts["Quarry/Mining"] || 0).toLocaleString();
        document.getElementById("val-agri-count").textContent = (classCounts["Agricultural burning"] || 0).toLocaleString();
        document.getElementById("val-max-frp").textContent = `${maxFrp.toFixed(1)} MW`;

        // Update Sidebar Layer Counts
        document.getElementById("count-industrial").textContent = (classCounts["Industrial"] || 0).toLocaleString();
        document.getElementById("count-forest").textContent = (classCounts["Forest fire"] || 0).toLocaleString();
        document.getElementById("count-quarry").textContent = (classCounts["Quarry/Mining"] || 0).toLocaleString();
        document.getElementById("count-agri").textContent = (classCounts["Agricultural burning"] || 0).toLocaleString();
        document.getElementById("count-vegetation").textContent = (classCounts["Vegetation fire (open/scrub)"] || 0).toLocaleString();

        // Update Pill & Item counts
        const pill = document.getElementById("stats-summary-pill");
        if (pill) pill.textContent = `🟢 NASA FIRMS Live Feed • ${features.length} Live Anomalies`;

        const renderedEl = document.getElementById("rendered-features-count");
        if (renderedEl) renderedEl.textContent = `${renderedCount.toLocaleString()} live items rendered`;

        // Update Analytics Charts
        if (window.dashboardCharts) {
            window.dashboardCharts.updateFromStats({
                by_class: classCounts,
                frp_by_class: meta.frp_by_class || {},
            });
            window.dashboardCharts.updateTimelineFromData(features);
        }

        // Keep map centered on Jharkhand boundary
        if (!state._initialBoundsFitted && state.boundaryLayer && state.boundaryLayer.getBounds().isValid()) {
            state.map.fitBounds(state.boundaryLayer.getBounds(), { padding: [25, 25] });
            state._initialBoundsFitted = true;
        }
    }

    /**
     * Toggle Between Live Feed and Historical Archive
     */
    async function toggleMode() {
        state.isRealtimeMode = !state.isRealtimeMode;
        const banner = document.getElementById("realtime-status-banner");
        const toggleBtnLabel = document.getElementById("label-mode-toggle");
        const indicator = document.getElementById("live-indicator-pill");

        if (state.isRealtimeMode) {
            if (toggleBtnLabel) toggleBtnLabel.textContent = "Archive Data";
            if (indicator) indicator.style.display = "inline-flex";
            if (banner) banner.classList.remove("hidden");
            showToast("Switched to Live Real-Time Satellite Feed", "info");
            await loadRealtimeData(false);
        } else {
            if (toggleBtnLabel) toggleBtnLabel.textContent = "🟢 Live Stream";
            if (indicator) indicator.style.display = "none";
            if (banner) banner.classList.add("hidden");
            showToast("Switched to Historical 2021-2022 Validation Archive", "info");

            await fetchStats();
            await fetchSources();
            await fetchDetections();
        }
    }

    /**
     * Setup Automatic Polling Synchronization
     */
    function startAutoSync() {
        if (state.autoSyncInterval) clearInterval(state.autoSyncInterval);
        state.autoSyncInterval = setInterval(() => {
            if (state.isRealtimeMode) {
                console.log("Auto-syncing real-time satellite anomalies...");
                loadRealtimeData(false);
            }
        }, 90000); // 90 seconds
    }

    /**
     * UI Event Listeners
     */
    function initUIEventListeners() {
        // Live Observation Window Dropdown
        const windowSelect = document.getElementById("select-live-window");
        if (windowSelect) {
            if (!windowSelect.value || windowSelect.value === "1") {
                windowSelect.value = "5";
            }
            state.realtimeDays = parseInt(windowSelect.value) || 5;
            const label = document.getElementById("label-realtime-days");
            if (label) label.textContent = `${state.realtimeDays} Day${state.realtimeDays > 1 ? 's' : ''} Window`;

            windowSelect.addEventListener("change", (e) => {
                state.realtimeDays = parseInt(e.target.value) || 5;
                if (label) label.textContent = `${state.realtimeDays} Day${state.realtimeDays > 1 ? 's' : ''} Window`;
                if (state.isRealtimeMode) {
                    loadRealtimeData(false);
                }
            });
        }

        // Sync Live Buttons
        const syncLiveBtn = document.getElementById("btn-sync-live");
        if (syncLiveBtn) {
            syncLiveBtn.addEventListener("click", () => loadRealtimeData(true));
        }

        const bannerSyncBtn = document.getElementById("btn-banner-sync");
        if (bannerSyncBtn) {
            bannerSyncBtn.addEventListener("click", () => loadRealtimeData(true));
        }

        // Mode Toggle Button (Live vs Archive)
        const modeToggleBtn = document.getElementById("btn-mode-toggle");
        if (modeToggleBtn) {
            modeToggleBtn.addEventListener("click", () => toggleMode());
        }

        // Realtime Days Banner Button
        const realtimeDaysBtn = document.getElementById("btn-realtime-days-toggle");
        if (realtimeDaysBtn) {
            realtimeDaysBtn.addEventListener("click", () => {
                const nextDays = state.realtimeDays === 1 ? 2 : (state.realtimeDays === 2 ? 5 : (state.realtimeDays === 5 ? 7 : 1));
                state.realtimeDays = nextDays;
                if (windowSelect) windowSelect.value = String(nextDays);
                document.getElementById("label-realtime-days").textContent = `${state.realtimeDays} Day${state.realtimeDays > 1 ? 's' : ''} Window`;
                if (state.isRealtimeMode) {
                    loadRealtimeData(false);
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
        if (confSlider && confBadge) {
            confSlider.addEventListener("input", (e) => {
                state.minConfidence = parseInt(e.target.value) / 100;
                confBadge.textContent = `≥ ${e.target.value}%`;
                applyFiltersAndRender();
            });
        }

        // FRP Slider
        const frpSlider = document.getElementById("slider-frp");
        const frpBadge = document.getElementById("frp-val-badge");
        if (frpSlider && frpBadge) {
            frpSlider.addEventListener("input", (e) => {
                state.minFRP = parseFloat(e.target.value);
                frpBadge.textContent = `≥ ${e.target.value} MW`;
                applyFiltersAndRender();
            });
        }

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
        if (districtSelect) {
            districtSelect.addEventListener("change", (e) => {
                const dest = DISTRICT_BOUNDS[e.target.value] || DISTRICT_BOUNDS.ALL;
                state.map.flyTo(dest.center, dest.zoom, { duration: 1.5 });
            });
        }

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
        const heatmapToggle = document.getElementById("toggle-heatmap");
        if (heatmapToggle) {
            heatmapToggle.addEventListener("change", () => {
                applyFiltersAndRender();
            });
        }

        // Persistent Sources Toggle
        const sourcesToggle = document.getElementById("toggle-sources");
        if (sourcesToggle) {
            sourcesToggle.addEventListener("change", (e) => {
                if (!state.sourcesLayer) return;
                if (e.target.checked) {
                    state.sourcesLayer.addTo(state.map);
                } else {
                    state.map.removeLayer(state.sourcesLayer);
                }
            });
        }

        // OSM Overlay Toggle
        const osmToggle = document.getElementById("toggle-osm-overlay");
        if (osmToggle) {
            osmToggle.addEventListener("change", async (e) => {
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
        }

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

        // Optional manual ingest button (if present)
        const fetchBtn = document.getElementById("btn-fetch-firms");
        if (fetchBtn) {
            fetchBtn.addEventListener("click", async () => {
                fetchBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Ingesting...`;
                fetchBtn.disabled = true;

                try {
                    const res = await fetch("/api/fetch-firms?days=1&source=VIIRS_NOAA21_NRT", { method: "POST" });
                    const result = await res.json();

                    if (result.new_detections_count > 0) {
                        showToast(`Ingested ${result.new_detections_count} real-time VIIRS NOAA-21 anomalies!`, "success");
                        await loadRealtimeData(true);
                    } else {
                        showToast(result.message || "FIRMS queried: 0 active anomalies in past 24h", "info");
                    }
                } catch (err) {
                    showToast("Failed to fetch real-time FIRMS data", "error");
                } finally {
                    fetchBtn.innerHTML = `<i class="fa-solid fa-satellite-dish"></i> Sync NASA FIRMS`;
                    fetchBtn.disabled = false;
                }
            });
        }

        // Toggle Analytics Drawer
        const drawer = document.getElementById("analytics-drawer");
        const toggleDrawer = () => {
            if (!drawer) return;
            state.isDrawerCollapsed = !state.isDrawerCollapsed;
            const collapseBtn = document.getElementById("btn-drawer-collapse");
            if (state.isDrawerCollapsed) {
                drawer.classList.add("collapsed");
                if (collapseBtn) collapseBtn.innerHTML = `<i class="fa-solid fa-chevron-up"></i>`;
            } else {
                drawer.classList.remove("collapsed");
                if (collapseBtn) collapseBtn.innerHTML = `<i class="fa-solid fa-chevron-down"></i>`;
            }
        };

        const drawerBar = document.getElementById("drawer-toggle-bar");
        if (drawerBar) drawerBar.addEventListener("click", toggleDrawer);
        const toggleAnalyticsBtn = document.getElementById("btn-toggle-analytics");
        if (toggleAnalyticsBtn) toggleAnalyticsBtn.addEventListener("click", toggleDrawer);

        // Toggle Inspector Panel
        const inspector = document.getElementById("inspector-panel");
        const toggleInspectorBtn = document.getElementById("btn-toggle-inspector");
        if (toggleInspectorBtn && inspector) {
            toggleInspectorBtn.addEventListener("click", () => {
                inspector.classList.toggle("hidden");
                if (!inspector.classList.contains("hidden")) {
                    switchInspectorTab("tab-simulator");
                }
            });
        }

        const closeInspectorBtn = document.getElementById("btn-close-inspector");
        if (closeInspectorBtn && inspector) {
            closeInspectorBtn.addEventListener("click", () => {
                inspector.classList.add("hidden");
            });
        }

        // Inspector Tabs
        document.querySelectorAll(".inspector-tabs .tab-btn").forEach((btn) => {
            btn.addEventListener("click", () => {
                switchInspectorTab(btn.getAttribute("data-tab"));
            });
        });

        // Simulator Form Submit
        const simForm = document.getElementById("form-simulator");
        if (simForm) {
            simForm.addEventListener("submit", async (e) => {
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
