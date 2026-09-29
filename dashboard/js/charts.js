/**
 * AGNI-VISION — GIS Analytics & Charts Module
 * Powered by Chart.js 4.x
 * Cowboy Space Dark-Warm Palette
 */

class DashboardCharts {
    constructor() {
        this.classChart = null;
        this.timelineChart = null;
        this.frpChart = null;

        // Cowboy Space dark-warm classification palette
        this.colors = {
            "Industrial": "#c14f09",                    // Burnt sienna orange
            "Forest fire": "#6b9956",                   // Forest green
            "Quarry/Mining": "#c49a3c",                 // Warm gold ochre
            "Agricultural burning": "#a8863e",          // Harvest amber
            "Vegetation fire (open/scrub)": "#7a9e7e",  // Sage green
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
                    borderColor: "#1f1509",
                    borderWidth: 2,
                    hoverOffset: 4,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: "bottom",
                        labels: {
                            color: "#c4b89a",
                            boxWidth: 9,
                            font: { size: 10, family: "Inter" },
                            padding: 8,
                        }
                    },
                    tooltip: {
                        backgroundColor: "#2a1f0e",
                        titleColor: "#f9f7f3",
                        bodyColor: "#c4b89a",
                        borderColor: "rgba(196,184,154,0.2)",
                        borderWidth: 1,
                        padding: 8,
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
                        backgroundColor: "#c14f09",
                        borderRadius: 3,
                    },
                    {
                        label: "Forest Fire",
                        data: [210, 580, 1850, 2410, 1120, 180, 45, 30, 85, 220, 310, 387],
                        backgroundColor: "#6b9956",
                        borderRadius: 3,
                    },
                    {
                        label: "Quarry/Mining",
                        data: [580, 620, 710, 740, 690, 580, 520, 540, 610, 680, 590, 475],
                        backgroundColor: "#c49a3c",
                        borderRadius: 3,
                    },
                    {
                        label: "Agri Burning",
                        data: [40, 65, 120, 280, 190, 50, 20, 15, 35, 160, 95, 49],
                        backgroundColor: "#a8863e",
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
                        ticks: { color: "#9c9180", font: { size: 9.5 } }
                    },
                    y: {
                        stacked: true,
                        grid: { color: "rgba(196, 184, 154, 0.08)" },
                        ticks: { color: "#9c9180", font: { size: 9.5 } }
                    }
                },
                plugins: {
                    legend: {
                        position: "top",
                        align: "end",
                        labels: {
                            color: "#c4b89a",
                            boxWidth: 8,
                            font: { size: 9 },
                            padding: 6,
                        }
                    },
                    tooltip: {
                        backgroundColor: "#2a1f0e",
                        titleColor: "#f9f7f3",
                        bodyColor: "#c4b89a",
                        borderColor: "rgba(196,184,154,0.2)",
                        borderWidth: 1,
                        padding: 8
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
                            "#b84226",
                            "#3b4039",
                            "#a86e35",
                            "#8f7b2c",
                            "#5e5469",
                        ],
                        borderRadius: 3,
                    }
                ]
            },
            options: {
                indexAxis: "y",
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        grid: { color: "rgba(59, 64, 57, 0.15)" },
                        ticks: { color: "#3b4039", font: { size: 9.5 } }
                    },
                    y: {
                        grid: { display: false },
                        ticks: { color: "#3b4039", font: { size: 9.5 } }
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: "#10120f",
                        titleColor: "#f5f5f5",
                        bodyColor: "#c2cabb",
                        borderColor: "#3b4039",
                        borderWidth: 1,
                        padding: 8
                    }
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

        if (this.frpChart && stats.frp_by_class) {
            const frpLabels = Object.keys(stats.frp_by_class);
            const frpVals = Object.values(stats.frp_by_class);
            if (frpLabels.length > 0) {
                this.frpChart.data.labels = frpLabels;
                this.frpChart.data.datasets[0].data = frpVals;
                this.frpChart.data.datasets[0].backgroundColor = frpLabels.map(l => this.colors[l] || "#b84226");
                this.frpChart.update();
            }
        }
    }

    updateTimelineFromData(features) {
        if (!this.timelineChart || !features || features.length === 0) return;

        const dateMap = {};
        features.forEach(f => {
            const p = f.properties || {};
            const rawDate = p.acq_date ? String(p.acq_date).split(" ")[0] : "Recent";
            if (!dateMap[rawDate]) {
                dateMap[rawDate] = { "Industrial": 0, "Forest fire": 0, "Quarry/Mining": 0, "Agricultural burning": 0, "Vegetation fire (open/scrub)": 0 };
            }
            if (p.predicted_class && dateMap[rawDate][p.predicted_class] !== undefined) {
                dateMap[rawDate][p.predicted_class]++;
            }
        });

        const sortedDates = Object.keys(dateMap).sort();
        if (sortedDates.length === 0) return;

        this.timelineChart.data.labels = sortedDates;
        this.timelineChart.data.datasets = [
            {
                label: "Industrial",
                data: sortedDates.map(d => dateMap[d]["Industrial"]),
                backgroundColor: "#b84226",
                borderRadius: 3,
            },
            {
                label: "Forest Fire",
                data: sortedDates.map(d => dateMap[d]["Forest fire"]),
                backgroundColor: "#3b4039",
                borderRadius: 3,
            },
            {
                label: "Mining/Quarry",
                data: sortedDates.map(d => dateMap[d]["Quarry/Mining"]),
                backgroundColor: "#a86e35",
                borderRadius: 3,
            },
            {
                label: "Agri Burning",
                data: sortedDates.map(d => dateMap[d]["Agricultural burning"]),
                backgroundColor: "#8f7b2c",
                borderRadius: 3,
            }
        ];
        this.timelineChart.update();
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

            const badgeColor = this.colors[p.dominant_class] || "#b84226";

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
