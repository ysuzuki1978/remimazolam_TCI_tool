// Remimazolam TCI V3.3 - Bolus + Continuous Infusion Application Logic
// Main application interface for bolus optimization system

class RemimazolamBolusApp {
    constructor() {
        this.calculator = null;
        this.protocolCalculator = new RemimazolamV33.BolusProtocolCalculator();
        this.alertManager = new RemimazolamV33.BolusAlertManager();
        this.concentrationChart = null;
        this.currentPatient = null;
        this.currentResults = null;
        
        this.initializeApp();
    }
    
    initializeApp() {
        this.handleDisclaimer();
        this.setupEventListeners();
        this.initializeOptimizationPreview();
        this.requestNotificationPermission();
    }
    
    handleDisclaimer() {
        const disclaimerModal = document.getElementById('disclaimerModal');
        const acceptBtn = document.getElementById('acceptDisclaimer');
        const mainApp = document.getElementById('mainApp');
        
        acceptBtn.addEventListener('click', () => {
            disclaimerModal.classList.remove('active');
            mainApp.classList.remove('hidden');
            this.enableAudio();
        });
    }
    
    async enableAudio() {
        await this.alertManager.enableAudio();
        this.alertManager.enableBolusAlerts(true);
    }
    
    requestNotificationPermission() {
        this.alertManager.requestNotificationPermission();
    }
    
    setupEventListeners() {
        // Patient information updates
        const patientInputs = ['age', 'weight', 'height', 'patientId'];
        patientInputs.forEach(inputId => {
            const element = document.getElementById(inputId);
            if (element) {
                element.addEventListener('input', () => this.updatePatientInfo());
            }
        });
        
        // Radio button changes
        document.querySelectorAll('input[type="radio"]').forEach(radio => {
            radio.addEventListener('change', () => this.updatePatientInfo());
        });
        
        // Bolus and target concentration changes
        const optimizationInputs = ['bolusDose', 'targetCe', 'targetReachTime'];
        optimizationInputs.forEach(inputId => {
            const element = document.getElementById(inputId);
            if (element) {
                element.addEventListener('input', () => this.updateOptimizationPreview());
            }
        });
        
        // Protocol parameters
        const protocolInputs = ['upperThresholdRatio', 'reductionFactor'];
        protocolInputs.forEach(inputId => {
            const element = document.getElementById(inputId);
            if (element) {
                element.addEventListener('input', () => this.updateOptimizationPreview());
            }
        });
        
        // Generate optimization button
        document.getElementById('generateOptimizationBtn').addEventListener('click', () => {
            this.generateBolusOptimization();
        });
        
        // Modal controls
        this.setupModalControls();
        
        // Export controls
        this.setupExportControls();
        
        // Audio controls
        this.setupAudioControls();
    }
    
    setupModalControls() {
        const optimizationInfoModal = document.getElementById('optimizationInfoModal');
        const closeOptimizationInfo = document.getElementById('closeOptimizationInfo');
        
        // Close modal
        if (closeOptimizationInfo) {
            closeOptimizationInfo.addEventListener('click', () => {
                optimizationInfoModal.classList.remove('active');
            });
        }
        
        // Click outside to close
        optimizationInfoModal.addEventListener('click', (e) => {
            if (e.target === optimizationInfoModal) {
                optimizationInfoModal.classList.remove('active');
            }
        });
    }
    
    setupExportControls() {
        document.getElementById('printScheduleBtn')?.addEventListener('click', () => {
            this.printProtocol();
        });
        
        document.getElementById('exportCsvBtn')?.addEventListener('click', () => {
            this.exportToCSV();
        });
    }
    
    setupAudioControls() {
        document.getElementById('enableAudio')?.addEventListener('change', (e) => {
            if (e.target.checked) {
                this.enableAudio();
            }
        });
        
        document.getElementById('enableBolusAlert')?.addEventListener('change', (e) => {
            this.alertManager.enableBolusAlerts(e.target.checked);
        });
    }
    
    updatePatientInfo() {
        const patient = this.collectPatientData();
        
        if (patient) {
            // Update BMI display
            const bmi = patient.getBMI();
            document.getElementById('bmiDisplay').textContent = bmi.toFixed(1);
            
            // Update patient status
            const validation = patient.validate();
            const statusElement = document.getElementById('patientStatus');
            statusElement.textContent = validation.isValid ? '正常範囲' : '要確認';
            statusElement.className = `calculated-value ${validation.isValid ? 'valid' : 'invalid'}`;
            
            this.currentPatient = patient;
            this.updateOptimizationPreview();
        }
    }
    
    updateOptimizationPreview() {
        if (!this.currentPatient) return;
        
        try {
            const bolusDose = parseFloat(document.getElementById('bolusDose').value) || 7;
            const targetCe = parseFloat(document.getElementById('targetCe').value) || 1.0;
            const targetReachTime = parseFloat(document.getElementById('targetReachTime').value) || 20;
            
            // Update preview values
            document.getElementById('previewBolusValue').textContent = `${bolusDose} mg`;
            
            // Quick optimization preview
            const pkCalculator = new RemimazolamV33.PKParameterCalculator();
            const pkParams = pkCalculator.calculatePKParameters(this.currentPatient);
            const optimizer = new RemimazolamV33.BolusOptimizer(this.currentPatient, pkParams);
            
            // Calculate initial concentration
            const bolusState = optimizer.calculateBolusInitialState(bolusDose);
            document.getElementById('previewInitialConc').textContent = 
                `${bolusState.plasmaConc.toFixed(2)} μg/mL`;
            
            // Quick optimization
            const optimizationResult = optimizer.optimizeContinuousRate(bolusDose, targetCe, targetReachTime);
            document.getElementById('previewOptimalRate').textContent = 
                `${optimizationResult.optimalRate.toFixed(2)} mg/kg/hr`;
            document.getElementById('previewTargetReach').textContent = 
                `${optimizationResult.predictedCe.toFixed(3)} μg/mL`;
                
        } catch (error) {
            console.warn('Preview calculation error:', error);
            document.getElementById('previewInitialConc').textContent = '計算エラー';
            document.getElementById('previewOptimalRate').textContent = '計算エラー';
            document.getElementById('previewTargetReach').textContent = '計算エラー';
        }
    }
    
    initializeOptimizationPreview() {
        // Set initial values
        this.updatePatientInfo();
    }
    
    collectPatientData() {
        try {
            const patientId = document.getElementById('patientId').value.trim();
            const age = parseFloat(document.getElementById('age').value);
            const weight = parseFloat(document.getElementById('weight').value);
            const height = parseFloat(document.getElementById('height').value);
            const sex = parseInt(document.querySelector('input[name="sex"]:checked')?.value || '0');
            const asaPS = parseInt(document.querySelector('input[name="asa"]:checked')?.value || '0');
            
            return new RemimazolamV33.Patient(patientId, age, weight, height, sex, asaPS);
        } catch (error) {
            console.error('Patient data collection error:', error);
            return null;
        }
    }
    
    generateBolusOptimization() {
        this.showLoading(true);
        
        try {
            const patient = this.collectPatientData();
            if (!patient) {
                throw new Error('患者データの取得に失敗しました');
            }
            
            const validation = patient.validate();
            if (!validation.isValid) {
                throw new Error('患者データのバリデーションエラー: ' + validation.errors.join(', '));
            }
            
            const bolusDose = parseFloat(document.getElementById('bolusDose').value);
            const targetCe = parseFloat(document.getElementById('targetCe').value);
            const targetReachTime = parseFloat(document.getElementById('targetReachTime').value) || 20;
            const upperThresholdRatio = parseFloat(document.getElementById('upperThresholdRatio').value) || 1.2;
            const reductionFactor = parseFloat(document.getElementById('reductionFactor').value) || 0.70;
            
            const protocolParams = {
                targetReachTime: targetReachTime,
                upperThresholdRatio: upperThresholdRatio,
                reductionFactor: reductionFactor
            };
            
            // Calculate bolus protocol
            const results = this.protocolCalculator.calculateBolusProtocol(
                patient, bolusDose, targetCe, protocolParams
            );
            
            this.currentResults = results;
            this.displayResults(results);
            this.hideWarning();
            
        } catch (error) {
            console.error('Optimization error:', error);
            this.showWarning(error.message);
        } finally {
            this.showLoading(false);
        }
    }
    
    displayResults(results) {
        // Show results section
        const resultsSection = document.getElementById('resultsSection');
        resultsSection.classList.remove('hidden');
        resultsSection.scrollIntoView({ behavior: 'smooth' });
        
        // Update summary
        this.updateOptimizationSummary(results);
        
        // Update protocol table
        this.updateProtocolTable(results.clinicalProtocol);
        
        // Update performance metrics
        this.updatePerformanceMetrics(results);
        
        // Update comparison table
        this.updateComparisonTable(results.comparisonData);
        
        // Create concentration chart
        this.createConcentrationChart(results.simulationData, results.dosageAdjustments, results.protocolParams);
        
        // Generate alerts
        this.generateProtocolAlerts(results.dosageAdjustments, results.clinicalProtocol);
    }
    
    updateOptimizationSummary(results) {
        document.getElementById('summaryBolusAmount').textContent = `${results.bolusDose} mg`;
        document.getElementById('summaryOptimalRate').textContent = 
            `${results.optimalContinuousRate.toFixed(2)} mg/kg/hr`;
        document.getElementById('summaryTargetCe').textContent = `${results.targetCe} μg/mL`;
        document.getElementById('summaryFinalCe').textContent = 
            `${results.performance.finalCe.toFixed(3)} μg/mL`;
    }
    
    updateProtocolTable(clinicalProtocol) {
        const tbody = document.querySelector('#protocolTable tbody');
        tbody.innerHTML = '';
        
        clinicalProtocol.forEach(protocol => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${protocol.step}</td>
                <td>${protocol.method}</td>
                <td>${protocol.dose}</td>
                <td>${protocol.totalDose}</td>
                <td>${protocol.timing}</td>
                <td>${protocol.notes}</td>
            `;
            tbody.appendChild(row);
        });
    }
    
    updatePerformanceMetrics(results) {
        document.getElementById('calculationTime').textContent = `${results.calculationTimeMs}ms`;
        document.getElementById('targetAccuracy').textContent = 
            `${results.performance.targetAccuracy.toFixed(1)}%`;
        document.getElementById('avgDeviation').textContent = 
            `${results.performance.avgDeviation.toFixed(3)} μg/mL`;
        document.getElementById('maxConcentration').textContent = 
            `${results.performance.maxCe.toFixed(3)} μg/mL`;
        document.getElementById('adjustmentCount').textContent = 
            `${results.dosageAdjustments.length} 回`;
        document.getElementById('stabilityIndex').textContent = 
            `${results.performance.stabilityIndex.toFixed(1)}`;
    }
    
    updateComparisonTable(comparisonData) {
        const tbody = document.querySelector('#comparisonTable tbody');
        tbody.innerHTML = '';
        
        comparisonData.forEach(comparison => {
            const row = document.createElement('tr');
            row.className = comparison.recommendation === '推奨' ? 'recommended' : '';
            row.innerHTML = `
                <td>${comparison.bolusDose} mg</td>
                <td>${comparison.optimalRate.toFixed(2)} mg/kg/hr</td>
                <td>${comparison.finalCe.toFixed(3)} μg/mL</td>
                <td>${comparison.targetAccuracy.toFixed(1)}%</td>
                <td>${comparison.adjustmentCount} 回</td>
                <td><span class="recommendation ${comparison.recommendation}">${comparison.recommendation}</span></td>
            `;
            tbody.appendChild(row);
        });
    }
    
    createConcentrationChart(simulationData, dosageAdjustments, protocolParams) {
        const ctx = document.getElementById('concentrationChart').getContext('2d');
        
        if (this.concentrationChart) {
            this.concentrationChart.destroy();
        }
        
        // Prepare datasets
        const timeLabels = simulationData.map(point => point.time);
        const ceData = simulationData.map(point => point.ce);
        const plasmaData = simulationData.map(point => point.plasma);
        const infusionData = simulationData.map(point => point.infusionRate);
        const targetData = new Array(simulationData.length).fill(protocolParams.targetCe);
        const thresholdData = new Array(simulationData.length).fill(protocolParams.targetCe * protocolParams.upperThresholdRatio);
        
        // Bolus markers
        const bolusMarker = simulationData.find(point => point.isBolus);
        const bolusAnnotations = bolusMarker ? [{
            type: 'line',
            mode: 'vertical',
            scaleID: 'x',
            value: bolusMarker.time,
            borderColor: '#FF6B6B',
            borderWidth: 2,
            label: {
                content: 'ボーラス投与',
                enabled: true,
                position: 'top'
            }
        }] : [];
        
        // Adjustment markers
        const adjustmentAnnotations = dosageAdjustments.map(adj => ({
            type: 'line',
            mode: 'vertical',
            scaleID: 'x',
            value: adj.time,
            borderColor: '#FFA726',
            borderWidth: 2,
            borderDash: [5, 5],
            label: {
                content: `${adj.reductionPercent.toFixed(0)}%減量`,
                enabled: true,
                position: 'top'
            }
        }));
        
        this.concentrationChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: timeLabels,
                datasets: [
                    {
                        label: '効果部位濃度',
                        data: ceData,
                        borderColor: '#4ECDC4',
                        backgroundColor: 'rgba(78, 205, 196, 0.1)',
                        borderWidth: 3,
                        fill: true,
                        tension: 0.2,
                        yAxisID: 'y'
                    },
                    {
                        label: '血漿濃度',
                        data: plasmaData,
                        borderColor: '#45B7D1',
                        backgroundColor: 'rgba(69, 183, 209, 0.1)',
                        borderWidth: 2,
                        fill: false,
                        tension: 0.2,
                        yAxisID: 'y'
                    },
                    {
                        label: '目標濃度',
                        data: targetData,
                        borderColor: '#2ECC71',
                        borderWidth: 2,
                        borderDash: [10, 5],
                        fill: false,
                        pointRadius: 0,
                        yAxisID: 'y'
                    },
                    {
                        label: '上限閾値',
                        data: thresholdData,
                        borderColor: '#E74C3C',
                        borderWidth: 2,
                        borderDash: [5, 5],
                        fill: false,
                        pointRadius: 0,
                        yAxisID: 'y'
                    },
                    {
                        label: '投与量',
                        data: infusionData,
                        borderColor: '#9B59B6',
                        backgroundColor: 'rgba(155, 89, 182, 0.1)',
                        borderWidth: 2,
                        fill: true,
                        tension: 0,
                        yAxisID: 'y1'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: '時間 (分)'
                        }
                    },
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        title: {
                            display: true,
                            text: '濃度 (μg/mL)'
                        },
                        min: 0
                    },
                    y1: {
                        type: 'linear',
                        display: true,
                        position: 'right',
                        title: {
                            display: true,
                            text: '投与量 (mg/kg/hr)'
                        },
                        grid: {
                            drawOnChartArea: false
                        },
                        min: 0
                    }
                },
                plugins: {
                    legend: {
                        display: true,
                        position: 'bottom'
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        callbacks: {
                            label: function(context) {
                                const label = context.dataset.label || '';
                                const value = context.parsed.y;
                                const unit = context.datasetIndex === 4 ? ' mg/kg/hr' : ' μg/mL';
                                return `${label}: ${value.toFixed(3)}${unit}`;
                            }
                        }
                    },
                    annotation: {
                        annotations: [...bolusAnnotations, ...adjustmentAnnotations]
                    }
                },
                interaction: {
                    mode: 'nearest',
                    axis: 'x',
                    intersect: false
                }
            }
        });
    }
    
    generateProtocolAlerts(dosageAdjustments, clinicalProtocol) {
        const alerts = this.alertManager.generateBolusAlerts(dosageAdjustments, clinicalProtocol);
        
        // Display alert summary
        if (alerts.length > 0) {
            console.log(`Generated ${alerts.length} protocol alerts`);
            
            // Show first bolus alert if enabled
            const bolusAlert = alerts.find(alert => alert.type === 'bolus');
            if (bolusAlert && document.getElementById('enableBolusAlert')?.checked) {
                this.showAlert(bolusAlert.title, bolusAlert.message, 'info');
                this.alertManager.playBolusAlert('bolus');
            }
        }
    }
    
    printProtocol() {
        if (!this.currentResults) return;
        
        const printWindow = window.open('', '_blank');
        const printContent = this.generatePrintContent(this.currentResults);
        
        printWindow.document.write(printContent);
        printWindow.document.close();
        printWindow.print();
    }
    
    generatePrintContent(results) {
        return `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Remimazolam TCI V3.3 - ボーラス+持続投与プロトコル</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 20px; }
                .header { text-align: center; margin-bottom: 30px; }
                .protocol-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
                .protocol-table th, .protocol-table td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                .protocol-table th { background-color: #f2f2f2; }
                .summary { background: #f9f9f9; padding: 15px; margin: 20px 0; }
                .footer { margin-top: 30px; font-size: 12px; color: #666; }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>Remimazolam TCI V3.3</h1>
                <h2>ボーラス+持続投与最適化プロトコル</h2>
                <p>患者ID: ${results.patient.patientId} | 生成日時: ${new Date().toLocaleString('ja-JP')}</p>
            </div>
            
            <div class="summary">
                <h3>投与サマリー</h3>
                <p><strong>ボーラス投与量:</strong> ${results.bolusDose} mg</p>
                <p><strong>最適持続投与量:</strong> ${results.optimalContinuousRate.toFixed(2)} mg/kg/hr</p>
                <p><strong>目標濃度:</strong> ${results.targetCe} μg/mL</p>
                <p><strong>予測最終濃度:</strong> ${results.performance.finalCe.toFixed(3)} μg/mL</p>
            </div>
            
            <table class="protocol-table">
                <thead>
                    <tr>
                        <th>ステップ</th>
                        <th>投与方法</th>
                        <th>投与量</th>
                        <th>総投与量</th>
                        <th>実行タイミング</th>
                        <th>備考</th>
                    </tr>
                </thead>
                <tbody>
                    ${results.clinicalProtocol.map(protocol => `
                        <tr>
                            <td>${protocol.step}</td>
                            <td>${protocol.method}</td>
                            <td>${protocol.dose}</td>
                            <td>${protocol.totalDose}</td>
                            <td>${protocol.timing}</td>
                            <td>${protocol.notes}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            
            <div class="footer">
                <p>本プロトコルは教育・研究目的専用です。臨床使用は医師の責任において実施してください。</p>
                <p>開発者: YASUYUKI SUZUKI | 科学的根拠: Masui, K., et al. (2022). Journal of Anesthesia</p>
            </div>
        </body>
        </html>
        `;
    }
    
    exportToCSV() {
        if (!this.currentResults) return;
        
        const csvData = this.convertToCSV(this.currentResults.simulationData);
        const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        
        link.setAttribute('href', url);
        link.setAttribute('download', `remimazolam_v3.3_${this.currentResults.patient.patientId}_${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
    
    convertToCSV(data) {
        const headers = ['時間(分)', '効果部位濃度(μg/mL)', '血漿濃度(μg/mL)', '投与量(mg/kg/hr)', '目標濃度(μg/mL)', '上限閾値(μg/mL)'];
        const csvContent = [
            headers.join(','),
            ...data.map(row => [
                row.time,
                row.ce.toFixed(4),
                row.plasma.toFixed(4),
                row.infusionRate.toFixed(2),
                row.targetCe.toFixed(1),
                row.upperThreshold.toFixed(1)
            ].join(','))
        ].join('\n');
        
        return '\uFEFF' + csvContent; // Add BOM for Excel compatibility
    }
    
    showLoading(show) {
        const button = document.getElementById('generateOptimizationBtn');
        if (show) {
            button.disabled = true;
            button.innerHTML = '<span class="btn-icon">⏳</span><span class="btn-text">最適化計算中...</span>';
        } else {
            button.disabled = false;
            button.innerHTML = '<span class="btn-icon">🧮</span><span class="btn-text">ボーラス+持続投与最適化実行</span>';
        }
    }
    
    showWarning(message) {
        const warningSection = document.getElementById('warningSection');
        const warningMessage = document.getElementById('warningMessage');
        
        warningMessage.textContent = message;
        warningSection.classList.remove('hidden');
        warningSection.scrollIntoView({ behavior: 'smooth' });
        
        // Hide results if showing
        document.getElementById('resultsSection').classList.add('hidden');
    }
    
    hideWarning() {
        document.getElementById('warningSection').classList.add('hidden');
    }
    
    showAlert(title, message, type = 'info') {
        const alertContainer = document.getElementById('alertContainer');
        const alertElement = document.createElement('div');
        alertElement.className = `alert alert-${type}`;
        alertElement.innerHTML = `
            <div class="alert-content">
                <div class="alert-title">${title}</div>
                <div class="alert-message">${message}</div>
            </div>
            <button class="alert-close">&times;</button>
        `;
        
        // Add close functionality
        alertElement.querySelector('.alert-close').addEventListener('click', () => {
            alertElement.remove();
        });
        
        alertContainer.appendChild(alertElement);
        
        // Auto-remove after 10 seconds
        setTimeout(() => {
            if (alertElement.parentNode) {
                alertElement.remove();
            }
        }, 10000);
    }
}

// Initialize application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new RemimazolamBolusApp();
});

// Export for potential external use
window.RemimazolamBolusApp = RemimazolamBolusApp;