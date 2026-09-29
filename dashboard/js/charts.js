/**
 * AGNI-VISION — GIS Analytics & Charts Module
 * Powered by Chart.js 4.x
 */

class DashboardCharts {
    constructor() {
        this.classChart = null;
        this.timelineChart = null;
        this.frpChart = null;

        this.colors = {
            "Industrial": "#ef4444",
            "Forest fire": "#22c55e",
            "Quarry/Mining": "#f97316",
            "Agricultural burning": "#eab308",
            "Vegetation fire (open/scrub)": "#a855f7",
        };
    }

    init() {
        this.initClassDistribution();
        this.initTimelineChart();
        this.initFrpChart();
    }

    initClassDistribution() {
        const ctx = document.getElementById("chart-class-distribution");
        if (!ctx) return;

        this.classChart = new Chart(ctx, {
            type: "doughnut",
            data: {
                labels: Object.keys(this.colors),
                datasets: [{
                    data: [10106, 7427, 7335, 1114, 5140],
                    backgroundColor: Object.values(this.colors),
                    borderColor: "#0e1322",
                    borderWidth: 2,
                    hoverOffset: 6,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: "bottom",
                        labels: {
                            color: "#94a3b8",
                            boxWidth: 10,
                            font: { size: 10, family: "Inter" },
                            padding: 8,
                        }
                    },
                    tooltip: {
                        backgroundColor: "rgba(15, 23, 42, 0.95)",
                        titleColor: "#f8fafc",
                        bodyColor: "#cbd5e1",
                        borderColor: "rgba(255, 255, 255, 0.1)",
                        borderWidth: 1,
                        callbacks: {
                            label: function(context) {
                                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                const val = context.parsed;
                                const pct = ((val / total) * 100).toFixed(1);
                                return ` ${context.label}: ${val.toLocaleString()} (${pct}%)`;
                            }
                        }
                    }
                },
                cutout: "68%",
            }
        });
    }

    initTimelineChart() {
        const ctx = document.getElementById("chart-timeline");
        if (!ctx) return;

        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

        this.timelineChart = new Chart(ctx, {
            type: "bar",
            data: {
                labels: months,
                datasets: [
                    {
                        label: "Industrial",
                        data: [750, 810, 890, 920, 860, 780, 820, 850, 890, 940, 880, 916],
                        backgroundColor: "rgba(239, 68, 68, 0.8)",
                        borderRadius: 3,
                    },
                    {
                        label: "Forest Fire",
                        data: [210, 580, 1850, 2410, 1120, 180, 45, 30, 85, 220, 310, 387],
                        backgroundColor: "rgba(34, 197, 94, 0.8)",
                        borderRadius: 3,
                    },
                    {
                        label: "Quarry/Mining",
                        data: [580, 620, 710, 740, 690, 580, 520, 540, 610, 680, 590, 475],
                        backgroundColor: "rgba(249, 115, 22, 0.8)",
                        borderRadius: 3,
                    },
                    {
                        label: "Agri Burning",
                        data: [40, 65, 120, 280, 190, 50, 20, 15, 35, 160, 95, 49],
                        backgroundColor: "rgba(234, 179, 8, 0.8)",
                        borderRadius: 3,
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        stacked: true,
                        grid: { display: false },
                        ticks: { color: "#64748b", font: { size: 10 } }
                    },
                    y: {
                        stacked: true,
                        grid: { color: "rgba(255, 255, 255, 0.05)" },
                        ticks: { color: "#64748b", font: { size: 10 } }
                    }
                },
                plugins: {
                    legend: {
                        position: "top",
                        align: "end",
                        labels: {
                            color: "#94a3b8",
                            boxWidth: 8,
                            font: { size: 9 },
                            padding: 6,
                        }
                    }
                }
            }
        });
    }

    initFrpChart() {
        const ctx = document.getElementById("chart-frp-by-class");
        if (!ctx) return;

        this.frpChart = new Chart(ctx, {
            type: "bar",
            data: {
                labels: ["Industrial", "Forest Fire", "Quarry/Mining", "Agri Burning", "Vegetation"],
                datasets: [
                    {
                        label: "Average FRP (MW)",
                        data: [4.8, 8.2, 3.4, 2.6, 3.1],
                        backgroundColor: [
                            "rgba(239, 68, 68, 0.7)",
                            "rgba(34, 197, 94, 0.7)",
                            "rgba(249, 115, 22, 0.7)",
                            "rgba(234, 179, 8, 0.7)",
                            "rgba(168, 85, 247, 0.7)",
                        ],
                        borderRadius: 4,
                    }
                ]
            },
            options: {
                indexAxis: "y",
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        grid: { color: "rgba(255, 255, 255, 0.05)" },
                        ticks: { color: "#64748b", font: { size: 10 } }
                    },
                    y: {
                        grid: { display: false },
                        ticks: { color: "#94a3b8", font: { size: 10 } }
                    }
                },
                plugins: {
                    legend: { display: false }
                }
            }
        });
    }

    updateFromStats(stats) {
        if (!stats || !stats.by_class) return;

        const labels = Object.keys(stats.by_class);
        const data = Object.values(stats.by_class);

        if (this.classChart) {
            this.classChart.data.labels = labels;
            this.classChart.data.datasets[0].data = data;
            this.classChart.update();
        }
    }

    populateHotspots(sourcesGeojson, onSelectRow) {
        const tbody = document.getElementById("hotspot-table-body");
        if (!tbody || !sourcesGeojson || !sourcesGeojson.features) return;

        tbody.innerHTML = "";
        const topSources = sourcesGeojson.features.slice(0, 15);

        topSources.forEach(feat => {
            const p = feat.properties;
            const coords = feat.geometry.coordinates;
            const tr = document.createElement("tr");

            const badgeColor = this.colors[p.dominant_class] || "#06b6d4";

            tr.innerHTML = `
                <td><strong>#${p.source_cluster_id}</strong></td>
                <td><span style="color: ${badgeColor}; font-weight: 600;">${p.dominant_class}</span></td>
                <td>${coords[1].toFixed(3)}°, ${coords[0].toFixed(3)}°</td>
                <td><strong>${p.detection_count}</strong></td>
                <td>${p.max_frp ? p.max_frp.toFixed(1) : '--'} MW</td>
                <td>${p.active_days}d</td>
            `;

            tr.addEventListener("click", () => {
                if (onSelectRow) {
                    onSelectRow(coords[1], coords[0], p);
                }
            });

            tbody.appendChild(tr);
        });
    }
}

window.dashboardCharts = new DashboardCharts();
