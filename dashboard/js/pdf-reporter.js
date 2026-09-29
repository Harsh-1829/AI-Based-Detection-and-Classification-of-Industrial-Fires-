/**
 * THERMALINTELL — Official PDF Incident Report Generator
 * Pure browser-native: styled popup + window.print() → Save as PDF
 * No external CDN or library required.
 */

(function () {
    "use strict";

    /* ------------------------------------------------------------------ */
    /*  HELPERS                                                              */
    /* ------------------------------------------------------------------ */

    function fv(val, unit, decimals) {
        if (val === undefined || val === null || val === "" || val === "--") return "N/A";
        var n = parseFloat(val);
        if (isNaN(n)) return String(val);
        return (decimals !== undefined ? n.toFixed(decimals) : n) + (unit ? " " + unit : "");
    }

    function fc(val) {
        if (val === undefined || val === null || val === "") return "N/A";
        return String(val);
    }

    function nowString() {
        var d = new Date();
        return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) +
            " " + d.toLocaleTimeString("en-IN", { hour12: false });
    }

    function incidentRef(detection) {
        var ts = Date.now().toString(36).toUpperCase();
        var cls = (detection.predicted_class || "UNK").replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 3);
        return "THRM-JH-" + cls + "-" + ts;
    }

    function severityLevel(detection) {
        var frp = parseFloat(detection.frp) || 0;
        var conf = parseFloat(detection.prediction_confidence) || 0;
        var cls = detection.predicted_class || "";
        var highClass = cls === "Forest fire" || cls === "Industrial";
        if (frp >= 50 || (highClass && conf >= 0.85) || (frp >= 30 && conf >= 0.80)) return "CRITICAL";
        if (frp >= 15 || conf >= 0.75 || highClass) return "HIGH";
        return "MODERATE";
    }

    function severityColor(sev) {
        return { CRITICAL: "#b84226", HIGH: "#c49a3c", MODERATE: "#6b9956" }[sev] || "#888";
    }

    function probBars(detection) {
        var classes = [
            { label: "Industrial",                     key: "prob_industrial",                       def: 0.1 },
            { label: "Forest Fire",                    key: "prob_forest_fire",                      def: 0.1 },
            { label: "Quarry / Mining",                key: "prob_quarry_mining",                    def: 0.1 },
            { label: "Agricultural Burning",           key: "prob_agricultural_burning",             def: 0.1 },
            { label: "Vegetation Fire",                key: "prob_vegetation_fire_openscrub",         def: 0.1 },
        ];
        var colors = ["#c14f09", "#6b9956", "#c49a3c", "#a8863e", "#7a9e7e"];
        var conf = parseFloat(detection.prediction_confidence) || 0.85;
        var rows = "";
        classes.forEach(function (item, i) {
            var prob = detection[item.key] !== undefined ? parseFloat(detection[item.key]) :
                (detection.predicted_class === item.label || (item.label === "Industrial" && detection.predicted_class === "Industrial") ? conf : (1 - conf) / 4);
            var pct = Math.min(100, Math.max(0, prob * 100)).toFixed(1);
            rows += '<tr>' +
                '<td style="padding:3px 6px; font-size:10px; color:#444;">' + item.label + '</td>' +
                '<td style="padding:3px 6px; width:55%;">' +
                '<div style="background:#e8e2d8; border-radius:3px; height:7px; overflow:hidden;">' +
                '<div style="background:' + colors[i] + '; width:' + pct + '%; height:100%; border-radius:3px;"></div></div></td>' +
                '<td style="padding:3px 6px; font-size:10px; color:' + colors[i] + '; font-weight:700; text-align:right;">' + pct + '%</td>' +
                '</tr>';
        });
        return rows;
    }

    /* ------------------------------------------------------------------ */
    /*  HTML TEMPLATE                                                        */
    /* ------------------------------------------------------------------ */

    function buildReportHTML(d, ref, sev, ts) {
        var sevColor = severityColor(sev);
        var lat = d.latitude ? parseFloat(d.latitude).toFixed(5) : "N/A";
        var lon = d.longitude ? parseFloat(d.longitude).toFixed(5) : "N/A";
        var frp = fv(d.frp, "MW", 2);
        var ti4 = fv(d.bright_ti4, "K", 1);
        var ti5 = fv(d.bright_ti5, "K", 1);
        var tiDiff = (d.bright_ti4 && d.bright_ti5) ? fv(parseFloat(d.bright_ti4) - parseFloat(d.bright_ti5), "K", 1) : "N/A";
        var conf = d.prediction_confidence ? (parseFloat(d.prediction_confidence) * 100).toFixed(1) + "%" : "N/A";
        var acqDate = fc(d.acq_date ? String(d.acq_date).split(" ")[0] : null);
        var acqTime = fc(d.acq_time);
        var daynight = d.daynight === "D" ? "Daytime" : d.daynight === "N" ? "Nighttime" : "N/A";
        var landcover = fc(d.worldcover_name || d.dominant_class);
        var osmName = fc(d.nearest_osm_name);
        var osmDist = d.distance_to_landuse_m ? Math.round(d.distance_to_landuse_m) + " m" : "N/A";
        var detectionCount = fc(d.n_detections_at_source || d.detection_count);
        var activeDays = fc(d.unique_days_active || d.active_days);
        var daysSpan = d.days_active_span !== undefined ? Math.round(d.days_active_span) + " days" : "N/A";
        var clusterId = fc(d.source_cluster_id || d.acq_time || "—");

        /* Weather fields (populated if weather API ran) */
        var wTemp = fv(d._w_temp, "°C", 1);
        var wRH = fv(d._w_rh, "%", 0);
        var wRain = fv(d._w_rain, "mm", 1);
        var wWind = fv(d._w_wind, "km/h", 1);

        return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">' +
            '<title>THERMALINTELL Incident Report \u2014 ' + ref + '</title>' +
            '<style>' +
            '*{box-sizing:border-box;margin:0;padding:0;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}' +
            'body{font-family:"Segoe UI",Arial,sans-serif;font-size:11px;color:#1f1509;background:#fff;padding:0;}' +
            '@page{size:A4;margin:18mm 15mm 18mm 15mm;}' +
            '@media print{body{padding:0;}button,.no-print{display:none!important;}.page-break{page-break-before:always;}}' +

            /* Print button (visible on screen only) */
            '.print-btn{display:block;margin:20px auto 0;padding:10px 32px;background:#c14f09;color:#fff;border:none;' +
            'border-radius:6px;font-size:14px;font-weight:700;cursor:pointer;letter-spacing:.5px;}' +
            '.print-btn:hover{background:#e05a0a;}' +

            /* Document chrome */
            '.report-wrap{max-width:780px;margin:0 auto;padding:0 0 30px;}' +
            '.report-header{background:#1f1509;color:#f9f7f3;padding:22px 28px 18px;display:flex;justify-content:space-between;align-items:flex-start;}' +
            '.rh-left{display:flex;flex-direction:column;gap:4px;}' +
            '.rh-logo{font-size:20px;font-weight:900;letter-spacing:2px;color:#ff7443;}' +
            '.rh-subtitle{font-size:9.5px;color:#c4b89a;letter-spacing:.8px;text-transform:uppercase;}' +
            '.rh-doctype{font-size:11px;color:#f9f7f3;margin-top:8px;font-weight:600;letter-spacing:.4px;}' +
            '.rh-right{text-align:right;display:flex;flex-direction:column;gap:3px;}' +
            '.rh-ref{font-family:monospace;font-size:11px;color:#ff7443;font-weight:700;letter-spacing:.5px;}' +
            '.rh-ts{font-size:9px;color:#9c9180;}' +

            /* Severity banner */
            '.sev-banner{padding:8px 28px;font-size:11px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:#fff;display:flex;align-items:center;gap:8px;}' +

            /* Content */
            '.report-body{padding:18px 28px 0;}' +
            '.section{margin-bottom:16px;}' +
            '.section-title{font-size:9px;font-weight:800;letter-spacing:.9px;text-transform:uppercase;color:#9c9180;' +
            'border-bottom:1.5px solid #e8e2d8;padding-bottom:4px;margin-bottom:9px;}' +
            '.data-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:1px;background:#e8e2d8;border:1px solid #e8e2d8;border-radius:6px;overflow:hidden;}' +
            '.data-grid-2{grid-template-columns:1fr 1fr;}' +
            '.data-grid-4{grid-template-columns:1fr 1fr 1fr 1fr;}' +
            '.data-item{background:#fff;padding:8px 10px;display:flex;flex-direction:column;gap:2px;}' +
            '.data-key{font-size:8.5px;color:#9c9180;text-transform:uppercase;letter-spacing:.5px;font-weight:600;}' +
            '.data-val{font-size:12px;font-weight:700;color:#1f1509;font-family:monospace;}' +
            '.data-val.accent{color:#c14f09;}' +

            /* Class badge */
            '.class-badge{display:inline-block;padding:3px 10px;border-radius:4px;font-size:11px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:#fff;}' +

            /* Prob bars table */
            'table.prob-table{width:100%;border-collapse:collapse;}' +

            /* Info box */
            '.info-box{background:#fdf8f3;border:1px solid #e8e2d8;border-left:3px solid ' + sevColor + ';' +
            'border-radius:0 6px 6px 0;padding:8px 12px;font-size:10.5px;color:#444;line-height:1.5;}' +
            '.info-box strong{color:#1f1509;}' +

            /* Footer */
            '.report-footer{margin-top:22px;padding:12px 28px;background:#f5f2ed;border-top:1px solid #e8e2d8;' +
            'display:flex;justify-content:space-between;align-items:center;}' +
            '.footer-left{font-size:9px;color:#9c9180;line-height:1.6;}' +
            '.footer-right{font-size:8.5px;color:#c4b89a;text-align:right;line-height:1.6;font-family:monospace;}' +
            '.classif-box{background:#1f1509;color:#f9f7f3;padding:6px 12px;border-radius:5px;font-size:9px;' +
            'letter-spacing:.5px;margin-top:6px;display:inline-block;}' +
            '</style></head><body>' +

            '<div class="report-wrap">' +

            /* ── HEADER ── */
            '<div class="report-header">' +
            '<div class="rh-left">' +
            '<div class="rh-logo">THERMALINTELL</div>' +
            '<div class="rh-subtitle">AI Thermal Intelligence Platform \u2022 SIH 26162</div>' +
            '<div class="rh-doctype">OFFICIAL FIRE INCIDENT REPORT</div>' +
            '</div>' +
            '<div class="rh-right">' +
            '<div class="rh-ref">' + ref + '</div>' +
            '<div class="rh-ts">Generated: ' + ts + '</div>' +
            '<div class="rh-ts">Jurisdiction: Jharkhand, India</div>' +
            '<div class="rh-ts">Data Source: NASA FIRMS VIIRS NOAA-21</div>' +
            '</div>' +
            '</div>' +

            /* ── SEVERITY BANNER ── */
            '<div class="sev-banner" style="background:' + sevColor + ';">' +
            '<span>\u26a0\ufe0f</span> SEVERITY: ' + sev +
            ' &nbsp;&nbsp;&bull;&nbsp;&nbsp; Classification: ' + fc(d.predicted_class) +
            ' &nbsp;&nbsp;&bull;&nbsp;&nbsp; AI Confidence: ' + conf +
            '</div>' +

            '<div class="report-body">' +

            /* ── SECTION 1: INCIDENT OVERVIEW ── */
            '<div class="section">' +
            '<div class="section-title">1. Incident Overview</div>' +
            '<div class="data-grid data-grid-4">' +
            '<div class="data-item"><div class="data-key">Incident Ref</div><div class="data-val accent">' + ref + '</div></div>' +
            '<div class="data-item"><div class="data-key">Detection Date</div><div class="data-val">' + acqDate + '</div></div>' +
            '<div class="data-item"><div class="data-key">Detection Time</div><div class="data-val">' + acqTime + ' UTC</div></div>' +
            '<div class="data-item"><div class="data-key">Pass Type</div><div class="data-val">' + daynight + '</div></div>' +
            '</div>' +
            '</div>' +

            /* ── SECTION 2: GEOSPATIAL LOCATION ── */
            '<div class="section">' +
            '<div class="section-title">2. Geospatial Location</div>' +
            '<div class="data-grid data-grid-4">' +
            '<div class="data-item"><div class="data-key">Latitude</div><div class="data-val">' + lat + '\u00b0 N</div></div>' +
            '<div class="data-item"><div class="data-key">Longitude</div><div class="data-val">' + lon + '\u00b0 E</div></div>' +
            '<div class="data-item"><div class="data-key">ESA WorldCover</div><div class="data-val">' + landcover + '</div></div>' +
            '<div class="data-item"><div class="data-key">Cluster ID</div><div class="data-val">' + clusterId + '</div></div>' +
            '</div>' +
            '<div style="margin-top:8px;" class="data-grid data-grid-2">' +
            '<div class="data-item"><div class="data-key">Nearest OSM Entity</div><div class="data-val" style="font-size:11px;">' + osmName + '</div></div>' +
            '<div class="data-item"><div class="data-key">Proximity to Industrial Source</div><div class="data-val">' + osmDist + '</div></div>' +
            '</div>' +
            '</div>' +

            /* ── SECTION 3: AI CLASSIFICATION ── */
            '<div class="section">' +
            '<div class="section-title">3. AI Classification (XGBoost Model B)</div>' +
            '<div style="display:flex;gap:12px;align-items:flex-start;">' +
            '<div style="flex:1;">' +
            '<div class="data-grid data-grid-2" style="margin-bottom:8px;">' +
            '<div class="data-item"><div class="data-key">Predicted Class</div>' +
            '<div style="margin-top:4px;"><span class="class-badge" style="background:' + sevColor + ';">' + fc(d.predicted_class) + '</span></div></div>' +
            '<div class="data-item"><div class="data-key">Model Confidence</div><div class="data-val accent">' + conf + '</div></div>' +
            '</div>' +
            '<div class="info-box">Classification driven by 18 engineered features including Fire Radiative Power, ' +
            'brightness temperature differential (TI4-TI5), ESA WorldCover land class, and OSM infrastructure proximity. ' +
            'Model trained on validated 2021\u20132022 Jharkhand thermal archive.</div>' +
            '</div>' +
            '<div style="width:240px;">' +
            '<div class="data-key" style="margin-bottom:6px;">Class Probability Distribution</div>' +
            '<table class="prob-table">' + probBars(d) + '</table>' +
            '</div>' +
            '</div>' +
            '</div>' +

            /* ── SECTION 4: THERMAL METRICS ── */
            '<div class="section">' +
            '<div class="section-title">4. Satellite Thermal Metrics (VIIRS NOAA-21, 375m)</div>' +
            '<div class="data-grid data-grid-4">' +
            '<div class="data-item"><div class="data-key">Fire Radiative Power</div><div class="data-val accent">' + frp + '</div></div>' +
            '<div class="data-item"><div class="data-key">Brightness Temp TI4</div><div class="data-val">' + ti4 + '</div></div>' +
            '<div class="data-item"><div class="data-key">Brightness Temp TI5</div><div class="data-val">' + ti5 + '</div></div>' +
            '<div class="data-item"><div class="data-key">TI4 \u2212 TI5 Differential</div><div class="data-val">' + tiDiff + '</div></div>' +
            '</div>' +
            '</div>' +

            /* ── SECTION 5: TEMPORAL PERSISTENCE ── */
            '<div class="section">' +
            '<div class="section-title">5. Temporal Persistence & Recurrence</div>' +
            '<div class="data-grid">' +
            '<div class="data-item"><div class="data-key">Total Detections at Source</div><div class="data-val">' + detectionCount + '</div></div>' +
            '<div class="data-item"><div class="data-key">Unique Active Days</div><div class="data-val">' + activeDays + '</div></div>' +
            '<div class="data-item"><div class="data-key">Total Observation Span</div><div class="data-val">' + daysSpan + '</div></div>' +
            '</div>' +
            '</div>' +

            /* ── SECTION 6: METEOROLOGICAL CONTEXT ── */
            '<div class="section">' +
            '<div class="section-title">6. Meteorological Context (at Detection Site)</div>' +
            '<div class="data-grid data-grid-4">' +
            '<div class="data-item"><div class="data-key">Ambient Temperature</div><div class="data-val">' + wTemp + '</div></div>' +
            '<div class="data-item"><div class="data-key">Relative Humidity</div><div class="data-val">' + wRH + '</div></div>' +
            '<div class="data-item"><div class="data-key">Precipitation</div><div class="data-val">' + wRain + '</div></div>' +
            '<div class="data-item"><div class="data-key">Wind Speed</div><div class="data-val">' + wWind + '</div></div>' +
            '</div>' +
            '</div>' +

            /* ── SECTION 7: RESPONSE RECOMMENDATION ── */
            '<div class="section">' +
            '<div class="section-title">7. Response Recommendation</div>' +
            '<div class="info-box">' +
            (sev === "CRITICAL"
                ? '<strong>IMMEDIATE ACTION REQUIRED.</strong> FRP and classification confidence indicate a high-intensity active thermal event. ' +
                  'Recommend immediate NDRF deployment, state DFO notification, PCB field assessment, and police control room alert. ' +
                  'Response SLA: 5 minutes from detection timestamp.'
                : sev === "HIGH"
                ? '<strong>URGENT ASSESSMENT REQUIRED.</strong> Thermal signature indicates significant fire activity. ' +
                  'Notify Jharkhand DFO, District Collector, PCB monitoring cell, and local fire brigade. ' +
                  'Deploy field assessment team. Response SLA: 15 minutes.'
                : '<strong>MONITORING RECOMMENDED.</strong> Moderate thermal signature detected. ' +
                  'Notify local fire brigade and Block Development Officer. Enhance satellite observation cadence. ' +
                  'Response SLA: 45 minutes.') +
            '</div>' +
            '</div>' +

            '</div>' + /* end report-body */

            /* ── FOOTER ── */
            '<div class="report-footer">' +
            '<div class="footer-left">' +
            '<strong>THERMALINTELL</strong> \u2014 AI-Enabled Geospatial Thermal Intelligence System<br>' +
            'SIH Problem Statement 26162 \u2022 Jharkhand Industrial Fire Detection<br>' +
            'Data: NASA FIRMS VIIRS NOAA-21 (URT+NRT) \u2022 Model: XGBoost Pipeline B \u2022 Enrichment: ESA WorldCover + OSM' +
            '</div>' +
            '<div class="footer-right">' +
            ref + '<br>' +
            ts + ' IST<br>' +
            '<div class="classif-box">CONFIDENTIAL \u2022 OFFICIAL USE ONLY</div>' +
            '</div>' +
            '</div>' +

            '</div>' + /* end report-wrap */

            /* Screen-only print button */
            '<div class="no-print" style="text-align:center;padding:16px 0 24px;">' +
            '<button class="print-btn" onclick="window.print()">&#x1F4BE; Save as PDF / Print Report</button>' +
            '<p style="font-size:11px;color:#9c9180;margin-top:8px;">In the print dialog, choose <strong>Save as PDF</strong> as the destination.</p>' +
            '</div>' +

            '<script>' +
            'window.addEventListener("DOMContentLoaded", function() { setTimeout(function() { window.print(); }, 400); });' +
            'setTimeout(function() { if (!window._printed) { window._printed = true; window.print(); } }, 900);' +
            '<\/script>' +
            '</body></html>';
    }

    /* ------------------------------------------------------------------ */
    /*  WEATHER DATA INJECTION                                               */
    /* ------------------------------------------------------------------ */

    /* Try to read the weather fields that were displayed in the inspector   */
    function enrichWithWeather(detection) {
        var tempEl  = document.getElementById("detail-weather-temp");
        var rhEl    = document.getElementById("detail-weather-rh");
        var rainEl  = document.getElementById("detail-weather-rain");
        var windEl  = document.getElementById("detail-weather-wind");

        function parseVal(el) {
            if (!el) return null;
            var t = (el.textContent || "").replace(/[^\d.\-]/g, "");
            var n = parseFloat(t);
            return isNaN(n) ? null : n;
        }

        var copy = Object.assign({}, detection);
        copy._w_temp  = parseVal(tempEl);
        copy._w_rh    = parseVal(rhEl);
        copy._w_rain  = parseVal(rainEl);
        copy._w_wind  = parseVal(windEl);
        return copy;
    }

    /* ------------------------------------------------------------------ */
    /*  DETECTION RESOLVER                                                   */
    /* ------------------------------------------------------------------ */

    function resolveDetection(detection) {
        if (detection && detection.predicted_class) return detection;
        if (window.__lastDetection && window.__lastDetection.predicted_class) return window.__lastDetection;
        if (window.__appState) {
            if (window.__appState.selectedDetection) return window.__appState.selectedDetection;
            var list = (window.__appState.realtimeData && window.__appState.realtimeData.features) ||
                       (window.__appState.detectionsData && window.__appState.detectionsData.features);
            if (list && list.length > 0) {
                var sorted = list.slice().sort(function (a, b) {
                    return (b.properties.frp || 0) - (a.properties.frp || 0);
                });
                return Object.assign({}, sorted[0].properties, {
                    latitude: sorted[0].geometry.coordinates[1],
                    longitude: sorted[0].geometry.coordinates[0]
                });
            }
        }
        return null;
    }

    /* ------------------------------------------------------------------ */
    /*  PUBLIC API                                                           */
    /* ------------------------------------------------------------------ */

    function generateReport(detection) {
        var d = resolveDetection(detection);
        if (!d) {
            alert("No anomaly selected yet. Please click any fire detection on the map first.");
            return;
        }

        var enriched = enrichWithWeather(d);
        var ref      = incidentRef(enriched);
        var sev      = severityLevel(enriched);
        var ts       = nowString();
        var html     = buildReportHTML(enriched, ref, sev, ts);

        /* Open in new popup window and trigger print */
        var w = window.open("", "_blank",
            "width=900,height=750,scrollbars=yes,resizable=yes,toolbar=no,menubar=yes,status=no");
        if (!w) {
            alert("Pop-up was blocked. Please allow pop-ups for this site and try again.");
            return;
        }
        w.document.open();
        w.document.write(html);
        w.document.close();
        try {
            w.focus();
        } catch (e) {}
    }

    window.PDFReporter = {
        generate: generateReport,
    };

})();
