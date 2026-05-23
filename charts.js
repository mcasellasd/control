// Franklin Finances - Configuració de Gràfics amb Chart.js
// Aquest fitxer s'encarrega d'inicialitzar i actualitzar els gràfics de l'aplicació.

window.FranklinCharts = {
  allocationChart: null,
  evolutionChart: null,
  globalPerformanceChart: null,
  accionsPerformanceChart: null,
  etfsPerformanceChart: null,
  fonsPerformanceChart: null,
  fundHistoryChart: null,

  // Inicialització global
  init() {
    // Configurar defectes globals de Chart.js per adaptar-los al mode fosc
    Chart.defaults.font.family = "'Plus Jakarta Sans', -apple-system, sans-serif";
    Chart.defaults.font.size = 12;
    Chart.defaults.color = '#9ca3af'; // text-muted
    Chart.defaults.plugins.tooltip.backgroundColor = '#0f1424';
    Chart.defaults.plugins.tooltip.titleFont = { family: 'Outfit', weight: 'bold', size: 13 };
    Chart.defaults.plugins.tooltip.bodyFont = { family: 'Plus Jakarta Sans', size: 12 };
    Chart.defaults.plugins.tooltip.borderColor = 'rgba(255, 255, 255, 0.1)';
    Chart.defaults.plugins.tooltip.borderWidth = 1;
    Chart.defaults.plugins.tooltip.padding = 10;
    Chart.defaults.plugins.tooltip.cornerRadius = 8;
    Chart.defaults.plugins.tooltip.displayColors = true;

    this.initAllocationChart();
    this.initEvolutionChart();
    
    // Inicialitzar els gràfics de rendiment
    this.globalPerformanceChart = this.initBarChart('globalPerformanceChartCanvas', 'Rendibilitat Global (%)', 45); // Marge ample només per al resum
    this.accionsPerformanceChart = this.initBarChart('accionsPerformanceChartCanvas', 'Rendiment Accions (%)', 20); // Marge estàndard per a la resta
    this.etfsPerformanceChart = this.initBarChart('etfsPerformanceChartCanvas', 'Rendiment ETFs (%)', 20);
    this.fonsPerformanceChart = this.initBarChart('fonsPerformanceChartCanvas', 'Rendiment Fons (%)', 20);
  },

  // Inicialitzador genèric de gràfics de barres horitzontals premium
  initBarChart(canvasId, labelText, leftPadding = 20) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;
    
    return new Chart(ctx, {
      type: 'bar',
      data: {
        labels: [],
        datasets: [{
          label: labelText,
          data: [],
          backgroundColor: function(context) {
            const value = context.raw || 0;
            return value >= 0 ? 'rgba(16, 185, 129, 0.25)' : 'rgba(244, 63, 94, 0.25)';
          },
          borderColor: function(context) {
            const value = context.raw || 0;
            return value >= 0 ? '#10b981' : '#f43f5e';
          },
          borderWidth: 1.5,
          borderRadius: 6
        }]
      },
      options: {
        indexAxis: 'y', // Gràfic de barres horitzontal
        responsive: true,
        maintainAspectRatio: false,
        layout: {
          padding: {
            left: leftPadding, // Safety space on the left for tick labels to avoid truncation
            right: 15,
            top: 5,
            bottom: 5
          }
        },
        plugins: {
          legend: {
            display: false // No cal llegenda
          },
          tooltip: {
            callbacks: {
              label: function(context) {
                const val = context.raw || 0;
                const sign = val >= 0 ? '+' : '';
                return ` Rendiment: ${sign}${val.toFixed(2)}%`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: {
              color: 'rgba(255, 255, 255, 0.04)',
              drawBorder: false
            },
            ticks: {
              callback: function(value) {
                return (value >= 0 ? '+' : '') + value + '%';
              }
            }
          },
          y: {
            grid: {
              display: false
            },
            ticks: {
              font: {
                family: 'Outfit',
                weight: 'bold',
                size: 11
              },
              color: '#f3f4f6',
              autoSkip: false // Force all asset names to render
            }
          }
        }
      }
    });
  },

  // 1. Gràfic de Distribució d'Actius (Donut)
  initAllocationChart() {
    const ctx = document.getElementById('allocationChartCanvas');
    if (!ctx) return;

    this.allocationChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Accions', 'ETFs', 'Fons d\'Inversió', 'Efectiu'],
        datasets: [{
          data: [0, 0, 0, 0], // S'actualitzarà dinàmicament des de app.js
          backgroundColor: [
            '#6366f1', // Indigo (Accions)
            '#a855f7', // Purple (ETFs)
            '#f59e0b', // Amber (Fons)
            '#10b981'  // Emerald (Efectiu)
          ],
          borderWidth: 2,
          borderColor: '#0b0f19', // Fons fosc per donar espai
          hoverOffset: 12,
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '75%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              padding: 20,
              usePointStyle: true,
              pointStyle: 'circle',
              font: {
                family: 'Outfit',
                weight: '500',
                size: 13
              },
              color: '#f3f4f6' // text-main
            }
          },
          tooltip: {
            callbacks: {
              label: function(context) {
                const label = context.label || '';
                const value = context.parsed || 0;
                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                return ` ${label}: ${value.toLocaleString('ca-ES', { style: 'currency', currency: 'EUR' })} (${percentage}%)`;
              }
            }
          }
        }
      }
    });
  },

  // 2. Gràfic d'Evolució de la Cartera (Line)
  initEvolutionChart() {
    const ctx = document.getElementById('evolutionChartCanvas');
    if (!ctx) return;

    // Crear un gradient de fons per a sota de la línia
    const gradient = ctx.getContext('2d').createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, 'rgba(99, 102, 241, 0.35)');
    gradient.addColorStop(0.5, 'rgba(168, 85, 247, 0.12)');
    gradient.addColorStop(1, 'rgba(4, 5, 8, 0)');

    this.evolutionChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: ['Desembre', 'Gener', 'Febrer', 'Març', 'Abril', 'Maig'],
        datasets: [{
          label: 'Valor Total de la Cartera',
          data: [0, 0, 0, 0, 0, 0], // S'actualitzarà dinàmicament
          borderColor: '#6366f1',
          borderWidth: 3,
          backgroundColor: gradient,
          fill: true,
          tension: 0.4, // Suavitza la línia (Spline)
          pointBackgroundColor: '#6366f1',
          pointBorderColor: '#ffffff',
          pointBorderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointHoverBorderWidth: 3,
          shadowColor: 'rgba(99, 102, 241, 0.5)',
          shadowBlur: 10
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false // No cal llegenda per a una sola línia descriptiva
          },
          tooltip: {
            callbacks: {
              label: function(context) {
                const value = context.parsed.y || 0;
                return ` Patrimoni: ${value.toLocaleString('ca-ES', { style: 'currency', currency: 'EUR' })}`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: {
              display: false // Treu les línies de quadrícula verticals
            },
            ticks: {
              font: {
                family: 'Outfit',
                weight: '500'
              }
            }
          },
          y: {
            grid: {
              color: 'rgba(255, 255, 255, 0.04)', // Quadrícula horitzontal molt subtil
              drawBorder: false
            },
            ticks: {
              font: {
                family: 'Plus Jakarta Sans'
              },
              callback: function(value) {
                if (value >= 1000) {
                  return (value / 1000) + 'k €';
                }
                return value + ' €';
              }
            }
          }
        }
      }
    });
  },

  // 3. Mètode Públic per actualitzar el Gràfic de Distribució
  updateAllocation(accionsVal, etfsVal, fonsVal, cashVal) {
    if (!this.allocationChart) return;
    
    this.allocationChart.data.datasets[0].data = [
      Math.max(0, accionsVal),
      Math.max(0, etfsVal),
      Math.max(0, fonsVal),
      Math.max(0, cashVal)
    ];
    this.allocationChart.update('active'); // actualització suau
  },

  // 4. Mètode Públic per actualitzar el Gràfic d'Evolució
  updateEvolution(labels, values) {
    if (!this.evolutionChart) return;

    this.evolutionChart.data.labels = labels;
    this.evolutionChart.data.datasets[0].data = values;
    this.evolutionChart.update('active');
  },

  // 5. Mètode Públic per actualitzar els Gràfics de Rendiment (Barres)
  updatePerformance(chart, labels, values) {
    if (!chart) return;
    chart.data.labels = labels;
    chart.data.datasets[0].data = values;
    chart.update('active');
  },

  // 6. Dibuixar o actualitzar el Gràfic Històric Anual de Fons
  renderFundHistoryChart(canvasId, labels, dataPoints) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    // Destruir el gràfic existent si ja s'havia creat per evitar solapaments
    if (this.fundHistoryChart) {
      this.fundHistoryChart.destroy();
    }

    const gradient = ctx.getContext('2d').createLinearGradient(0, 0, 0, 260);
    gradient.addColorStop(0, 'rgba(245, 158, 11, 0.35)'); // Amber amb opacitat superior a dalt
    gradient.addColorStop(0.5, 'rgba(245, 158, 11, 0.12)');
    gradient.addColorStop(1, 'rgba(4, 5, 8, 0)');

    this.fundHistoryChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Preu liquidatiu (VNA)',
          data: dataPoints,
          borderColor: '#f59e0b', // Amber premium
          borderWidth: 2.5,
          backgroundColor: gradient,
          fill: true,
          tension: 0.35,
          pointBackgroundColor: '#f59e0b',
          pointBorderColor: '#ffffff',
          pointBorderWidth: 1.5,
          pointRadius: 3,
          pointHoverRadius: 5
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function(context) {
                const value = context.raw || 0;
                return ` Preu VNA: ${value.toLocaleString('ca-ES', { style: 'currency', currency: 'EUR' })}`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              font: { family: 'Outfit', size: 10 }
            }
          },
          y: {
            grid: {
              color: 'rgba(255, 255, 255, 0.04)',
              drawBorder: false
            },
            ticks: {
              font: { family: 'Plus Jakarta Sans', size: 11 },
              callback: function(value) {
                return value.toLocaleString('ca-ES') + ' €';
              }
            }
          }
        }
      }
    });
  }
};
