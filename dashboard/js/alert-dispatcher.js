/**
 * THERMALINTELL — Automated Alert Dispatcher
 * Severity-based triage engine for emergency notification dispatch.
 *
 * Severity Levels:
 *   CRITICAL  — FRP >= 50 MW  OR  (Forest fire / Industrial) with conf >= 0.85
 *   HIGH      — FRP >= 15 MW  OR  conf >= 0.75
 *   MODERATE  — everything else above minimum threshold
 */

(function () {
    "use strict";

    /* ------------------------------------------------------------------ */
    /*  SEVERITY CONFIG                                                      */
    /* ------------------------------------------------------------------ */

    const SEVERITY = {
        CRITICAL: {
            key: "CRITICAL",
            label: "CRITICAL",
            color: "#b84226",
            bgClass: "sev-critical",
            icon: "fa-triangle-exclamation",
            agencies: ["NDRF Command", "Jharkhand DFO", "District Collector", "State PCB", "SDRF Operations", "Police Control Room"],
            channels: ["SMS Broadcast", "IVR Alert Call", "WhatsApp Emergency Group", "Dashboard Push Notification"],
            slaMinutes: 5,
            escalationText: "Immediate field deployment required. National Disaster Response Force notified.",
        },
        HIGH: {
            key: "HIGH",
            label: "HIGH",
            color: "#a86e35",
            bgClass: "sev-high",
            icon: "fa-fire-flame-curved",
            agencies: ["Jharkhand DFO", "District Collector", "State PCB", "Local Fire Brigade"],
            channels: ["SMS Broadcast", "Dashboard Push Notification", "Email Alert"],
            slaMinutes: 15,
            escalationText: "Field assessment team dispatch authorised. Containment resources on standby.",
        },
        MODERATE: {
            key: "MODERATE",
            label: "MODERATE",
            color: "#8f7b2c",
            bgClass: "sev-moderate",
            icon: "fa-circle-exclamation",
            agencies: ["Local Fire Brigade", "Block Development Officer", "State PCB Monitoring Cell"],
            channels: ["Dashboard Push Notification", "Email Alert"],
            slaMinutes: 45,
            escalationText: "Situation logged. Monitoring team alerted for enhanced observation.",
        },
    };

    const CLASS_PRIORITY = {
        "Forest fire": 3,
        "Industrial": 3,
        "Vegetation fire (open/scrub)": 2,
        "Quarry/Mining": 1,
        "Agricultural burning": 1,
    };

    /* ------------------------------------------------------------------ */
    /*  TRIAGE ENGINE                                                        */
    /* ------------------------------------------------------------------ */

    function computeSeverity(detection) {
        const frp = parseFloat(detection.frp) || 0;
        const conf = parseFloat(detection.prediction_confidence) || 0;
        const cls = detection.predicted_class || "";
        const classPriority = CLASS_PRIORITY[cls] || 1;

        if (frp >= 50 || (classPriority === 3 && conf >= 0.85) || (frp >= 30 && conf >= 0.80)) {
            return "CRITICAL";
        }
        if (frp >= 15 || conf >= 0.75 || classPriority === 3) {
            return "HIGH";
        }
        return "MODERATE";
    }

    function buildIncidentId(detection) {
        const ts = Date.now().toString(36).toUpperCase();
        const cls = (detection.predicted_class || "UNK").replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 3);
        return "JH-" + cls + "-" + ts;
    }

    function formatCoord(val) {
        return (val !== undefined && val !== null) ? parseFloat(val).toFixed(4) : "--";
    }

    function getDistrictEstimate(lat, lon) {
        var lat_ = parseFloat(lat) || 23.65;
        var lon_ = parseFloat(lon) || 85.60;
        if (lat_ > 23.6 && lon_ > 86.1) return "Dhanbad / Bokaro";
        if (lat_ < 23.0) return "Jamshedpur / Seraikela";
        if (lon_ < 85.2) return "Chatra / Palamu";
        if (lat_ > 24.0) return "Giridih / Godda";
        return "Ranchi / Ramgarh";
    }

    /* ------------------------------------------------------------------ */
    /*  DISPATCH SIMULATION                                                  */
    /* ------------------------------------------------------------------ */

    var _dispatchLog = [];
    var _logCounter = 0;

    function simulateDispatch(incidentId, severityKey, agencies, channels, onProgress) {
        var allRecipients = agencies.map(function(a) { return { name: a, type: "agency" }; })
            .concat(channels.map(function(c) { return { name: c, type: "channel" }; }));
        var total = allRecipients.length;
        var step = 0;
        var results = [];

        function next() {
            if (step >= total) return;
            var recipient = allRecipients[step];
            var delay = 280 + Math.random() * 450;
            setTimeout(function() {
                var ok = Math.random() > 0.07;
                results.push({ name: recipient.name, type: recipient.type, ok: ok });
                step++;
                var done = (step === total);
                onProgress(results, step, total, done);
                if (done) {
                    _logCounter++;
                    _dispatchLog.unshift({
                        seq: _logCounter,
                        incidentId: incidentId,
                        severity: severityKey,
                        agencies: agencies.length,
                        channels: channels.length,
                        successCount: results.filter(function(r) { return r.ok; }).length,
                        timestamp: new Date().toLocaleTimeString("en-IN", { hour12: false }),
                    });
                    updateDispatchLogBadge();
                } else {
                    next();
                }
            }, delay);
        }
        next();
    }

    function updateDispatchLogBadge() {
        var badge = document.getElementById("alert-log-badge");
        if (badge) {
            badge.textContent = _dispatchLog.length;
            badge.classList.remove("hidden");
        }
    }

    /* ------------------------------------------------------------------ */
    /*  MODAL OPEN                                                           */
    /* ------------------------------------------------------------------ */

    function openAlertModal(detection) {
        var severityKey = computeSeverity(detection);
        var sev = SEVERITY[severityKey];
        var incidentId = buildIncidentId(detection);
        var frp = parseFloat(detection.frp) || 0;
        var confRaw = detection.prediction_confidence ? (parseFloat(detection.prediction_confidence) * 100).toFixed(1) : "--";
        var cls = detection.predicted_class || "Unknown";
        var lat = formatCoord(detection.latitude);
        var lon = formatCoord(detection.longitude);
        var district = getDistrictEstimate(detection.latitude, detection.longitude);
        var dateStr = detection.acq_date ? String(detection.acq_date).split(" ")[0] : new Date().toISOString().split("T")[0];
        var timeStr = detection.acq_time || new Date().toLocaleTimeString("en-IN", { hour12: false });

        var modal = document.getElementById("alert-dispatch-modal");
        if (!modal) return;

        // Severity header
        var sevBadge = modal.querySelector("#adm-severity-badge");
        sevBadge.textContent = sev.label;
        sevBadge.className = "adm-severity-badge " + sev.bgClass;

        modal.querySelector("#adm-severity-icon").className = "fa-solid " + sev.icon;
        modal.querySelector("#adm-incident-id").textContent = incidentId;
        modal.querySelector("#adm-sla").textContent = "Response SLA: " + sev.slaMinutes + " min";

        var escEl = modal.querySelector("#adm-escalation");
        escEl.textContent = sev.escalationText;
        escEl.style.borderLeftColor = sev.color;

        // Detection summary
        modal.querySelector("#adm-class").textContent = cls;
        modal.querySelector("#adm-frp").textContent = frp.toFixed(1) + " MW";
        modal.querySelector("#adm-conf").textContent = confRaw + "%";
        modal.querySelector("#adm-coords").textContent = lat + "\u00b0N, " + lon + "\u00b0E";
        modal.querySelector("#adm-district").textContent = district;
        modal.querySelector("#adm-datetime").textContent = dateStr + " " + timeStr + " UTC";

        // Agency rows
        var agencyList = modal.querySelector("#adm-agency-list");
        agencyList.innerHTML = sev.agencies.map(function(a) {
            return '<div class="adm-recipient-item" data-name="' + a + '">' +
                '<span class="adm-recipient-icon"><i class="fa-solid fa-building-shield"></i></span>' +
                '<span class="adm-recipient-name">' + a + '</span>' +
                '<span class="adm-recipient-status pending"><i class="fa-solid fa-clock"></i> Pending</span>' +
                '</div>';
        }).join("");

        // Channel rows
        var channelList = modal.querySelector("#adm-channel-list");
        channelList.innerHTML = sev.channels.map(function(c) {
            return '<div class="adm-recipient-item" data-name="' + c + '">' +
                '<span class="adm-recipient-icon"><i class="fa-solid ' + channelIcon(c) + '"></i></span>' +
                '<span class="adm-recipient-name">' + c + '</span>' +
                '<span class="adm-recipient-status pending"><i class="fa-solid fa-clock"></i> Pending</span>' +
                '</div>';
        }).join("");

        // Progress bar + buttons reset
        var progressBar = modal.querySelector("#adm-progress-fill");
        var progressLabel = modal.querySelector("#adm-progress-label");
        var dispatchBtn = modal.querySelector("#adm-btn-dispatch");
        var donePanel = modal.querySelector("#adm-done-panel");

        progressBar.style.width = "0%";
        progressBar.style.backgroundColor = sev.color;
        progressLabel.textContent = "Ready to dispatch";
        donePanel.classList.add("hidden");
        dispatchBtn.disabled = false;
        dispatchBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Dispatch All Alerts';
        dispatchBtn.style.borderColor = sev.color;
        dispatchBtn.style.color = sev.color;

        // Dispatch button handler
        dispatchBtn.onclick = function() {
            dispatchBtn.disabled = true;
            dispatchBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Dispatching\u2026';
            progressLabel.textContent = "Contacting agencies & channels\u2026";

            simulateDispatch(incidentId, severityKey, sev.agencies, sev.channels, function(results, step, total, done) {
                var pct = Math.round((step / total) * 100);
                progressBar.style.width = pct + "%";
                progressLabel.textContent = done
                    ? "Dispatch complete \u2014 " + results.filter(function(r) { return r.ok; }).length + "/" + total + " confirmed"
                    : "Notifying\u2026 (" + step + "/" + total + ")";

                // Update individual status badges
                results.forEach(function(r) {
                    var el = modal.querySelector('[data-name="' + r.name + '"] .adm-recipient-status');
                    if (el) {
                        el.className = "adm-recipient-status " + (r.ok ? "sent" : "failed");
                        el.innerHTML = r.ok
                            ? '<i class="fa-solid fa-circle-check"></i> Sent'
                            : '<i class="fa-solid fa-circle-xmark"></i> Failed';
                    }
                });

                if (done) {
                    donePanel.classList.remove("hidden");
                    var failCount = results.filter(function(r) { return !r.ok; }).length;
                    modal.querySelector("#adm-done-text").textContent = failCount === 0
                        ? "All " + total + " recipients notified successfully."
                        : results.filter(function(r) { return r.ok; }).length + "/" + total + " notifications delivered. " + failCount + " failed.";
                }
            });
        };

        modal.classList.add("active");
        document.body.classList.add("modal-open");
    }

    function channelIcon(channel) {
        var map = {
            "SMS Broadcast": "fa-sms",
            "IVR Alert Call": "fa-phone-volume",
            "WhatsApp Emergency Group": "fa-message",
            "Dashboard Push Notification": "fa-bell",
            "Email Alert": "fa-envelope",
        };
        return map[channel] || "fa-share-nodes";
    }

    /* ------------------------------------------------------------------ */
    /*  DISPATCH LOG PANEL                                                   */
    /* ------------------------------------------------------------------ */

    function openDispatchLog() {
        var log = document.getElementById("alert-log-modal");
        if (!log) return;

        var tbody = log.querySelector("#alm-log-body");
        if (_dispatchLog.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:24px 0;">No dispatches yet. Select a detection and press Dispatch Alerts.</td></tr>';
        } else {
            tbody.innerHTML = _dispatchLog.map(function(entry) {
                var sev = SEVERITY[entry.severity] || SEVERITY.MODERATE;
                return '<tr>' +
                    '<td><span class="adm-severity-badge ' + sev.bgClass + '" style="font-size:9px;padding:2px 7px;">' + entry.severity + '</span></td>' +
                    '<td style="font-family:var(--font-mono);font-size:11px;">' + entry.incidentId + '</td>' +
                    '<td>' + entry.agencies + '</td>' +
                    '<td>' + entry.channels + '</td>' +
                    '<td style="color:var(--color-sage);">' + entry.successCount + '/' + (entry.agencies + entry.channels) + '</td>' +
                    '<td style="color:var(--text-muted);">' + entry.timestamp + '</td>' +
                    '</tr>';
            }).join("");
        }

        log.classList.add("active");
        document.body.classList.add("modal-open");
    }

    /* ------------------------------------------------------------------ */
    /*  PUBLIC API                                                           */
    /* ------------------------------------------------------------------ */

    window.AlertDispatcher = {
        openForDetection: openAlertModal,
        openLog: openDispatchLog,
        computeSeverity: computeSeverity,
    };

    /* ------------------------------------------------------------------ */
    /*  DOM READY                                                            */
    /* ------------------------------------------------------------------ */

    document.addEventListener("DOMContentLoaded", function() {
        // Alert dispatch modal close
        var closeAdm = document.getElementById("adm-btn-close");
        if (closeAdm) {
            closeAdm.addEventListener("click", function() {
                document.getElementById("alert-dispatch-modal").classList.remove("active");
                document.body.classList.remove("modal-open");
            });
        }
        var admModal = document.getElementById("alert-dispatch-modal");
        if (admModal) {
            admModal.addEventListener("click", function(e) {
                if (e.target === admModal) {
                    admModal.classList.remove("active");
                    document.body.classList.remove("modal-open");
                }
            });
        }

        // Alert log modal close
        var closeAlm = document.getElementById("alm-btn-close");
        if (closeAlm) {
            closeAlm.addEventListener("click", function() {
                document.getElementById("alert-log-modal").classList.remove("active");
                document.body.classList.remove("modal-open");
            });
        }
        var almModal = document.getElementById("alert-log-modal");
        if (almModal) {
            almModal.addEventListener("click", function(e) {
                if (e.target === almModal) {
                    almModal.classList.remove("active");
                    document.body.classList.remove("modal-open");
                }
            });
        }

        // Dispatch log navbar button
        var logBtn = document.getElementById("btn-alert-log");
        if (logBtn) {
            logBtn.addEventListener("click", function() { window.AlertDispatcher.openLog(); });
        }
    });

})();
