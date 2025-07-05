// Remimazolam TCI V3.3 - Bolus + Continuous Infusion Optimization
// Context7 Math.NET Numerics Enhanced Algorithm

class MasuiModelConstants {
    static THETA_1 = 3.57;
    static THETA_2 = 11.3;
    static THETA_3 = 27.2;
    static THETA_4 = 1.03;
    static THETA_5 = 1.10;
    static THETA_6 = 0.401;
    static THETA_8 = 0.308;
    static THETA_9 = 0.146;
    static THETA_10 = -0.184;
    
    static STANDARD_WEIGHT = 67.3;
    static STANDARD_AGE = 54.0;
    
    // V3.3 Bolus + Continuous Constants
    static DEFAULT_TARGET_REACH_TIME = 20.0; // Default target reach time after bolus
    static DEFAULT_UPPER_THRESHOLD_RATIO = 1.2; // Target * 1.2 = Upper threshold
    static OPTIMIZED_REDUCTION_FACTOR = 0.70; // 30% reduction - optimized value from V3.2
    static SIMULATION_DURATION = 180.0; // 3 hours simulation
    static TIME_STEP = 0.1; // 0.1 minute precision
    
    // Safety limits
    static MIN_INFUSION_RATE = 0.1; // mg/kg/hr
    static MAX_INFUSION_RATE = 6.0; // mg/kg/hr
    static MIN_BOLUS_DOSE = 1.0; // mg
    static MAX_BOLUS_DOSE = 15.0; // mg
    
    // Optimization parameters
    static OPTIMIZATION_STEP = 0.1; // mg/kg/hr step for rate optimization
    static OPTIMIZATION_MIN_RATE = 0.3; // mg/kg/hr
    static OPTIMIZATION_MAX_RATE = 4.0; // mg/kg/hr
}

class Patient {
    constructor(patientId, age, weight, height, sex, asaPS) {
        this.patientId = patientId;
        this.age = age;
        this.weight = weight;
        this.height = height;
        this.sex = sex; // 0 = male, 1 = female
        this.asaPS = asaPS; // 0 = ASA I-II, 1 = ASA III-IV
    }
    
    getBMI() {
        return this.weight / Math.pow(this.height / 100, 2);
    }
    
    validate() {
        const errors = [];
        
        if (!this.patientId || this.patientId.trim().length === 0) {
            errors.push("患者IDが入力されていません");
        }
        
        if (this.age < 18 || this.age > 80) {
            errors.push("年齢は18歳から80歳の範囲で入力してください");
        }
        
        if (this.weight < 40.0 || this.weight > 120.0) {
            errors.push("体重は40kgから120kgの範囲で入力してください");
        }
        
        const bmi = this.getBMI();
        if (bmi < 16.0 || bmi > 40.0) {
            errors.push(`BMIが範囲外です（計算値: ${bmi.toFixed(1)}）`);
        }
        
        return {
            isValid: errors.length === 0,
            errors: errors
        };
    }
}

class PKParameters {
    constructor(v1, v2, v3, cl, q2, q3, ke0) {
        this.v1 = v1;
        this.v2 = v2;
        this.v3 = v3;
        this.cl = cl;
        this.q2 = q2;
        this.q3 = q3;
        this.ke0 = ke0;
    }
    
    getK10() { return this.cl / this.v1; }
    getK12() { return this.q2 / this.v1; }
    getK21() { return this.q2 / this.v2; }
    getK13() { return this.q3 / this.v1; }
    getK31() { return this.q3 / this.v3; }
}

class PKParameterCalculator {
    calculatePKParameters(patient) {
        const weightRatio = patient.weight / MasuiModelConstants.STANDARD_WEIGHT;
        const ageRatio = patient.age / MasuiModelConstants.STANDARD_AGE;
        
        // Individual PK parameters (Masui 2022 model)
        const v1 = MasuiModelConstants.THETA_1 * Math.pow(weightRatio, 0.75) * 
                   (1 + MasuiModelConstants.THETA_8 * patient.sex);
        
        const v2 = MasuiModelConstants.THETA_2 * Math.pow(weightRatio, MasuiModelConstants.THETA_4) * 
                   (1 + MasuiModelConstants.THETA_9 * (ageRatio - 1));
        
        const v3 = MasuiModelConstants.THETA_3 * Math.pow(weightRatio, MasuiModelConstants.THETA_5);
        
        const cl = MasuiModelConstants.THETA_6 * Math.pow(weightRatio, 0.75) * 
                   (1 + MasuiModelConstants.THETA_10 * patient.asaPS);
        
        // Inter-compartmental clearances
        const q2 = 0.8 * cl;
        const q3 = 0.3 * cl;
        
        // 個別化Ke0計算（正解アプリと同じロジック）
        const ke0Result = MasuiKe0Calculator.calculateKe0(patient.age, patient.weight, patient.height, patient.sex, patient.asaPS);
        const ke0 = ke0Result.ke0;
        
        return new PKParameters(v1, v2, v3, cl, q2, q3, ke0);
    }
}

class BolusOptimizer {
    constructor(patient, pkParams) {
        this.patient = patient;
        this.pkParams = pkParams;
        this.timeStep = MasuiModelConstants.TIME_STEP;
    }
    
    // Calculate initial concentration after bolus dose
    calculateBolusInitialState(bolusDoseMg) {
        // Bolus is instantly distributed in V1 compartment
        const initialA1 = bolusDoseMg; // mg
        const initialPlasmaConc = initialA1 / this.pkParams.v1; // μg/mL
        
        return {
            a1: initialA1,
            a2: 0.0,
            a3: 0.0,
            plasmaConc: initialPlasmaConc,
            effectSiteConc: 0.0 // Effect site starts at 0, builds up over time
        };
    }
    
    // Optimize continuous infusion rate for target concentration
    optimizeContinuousRate(bolusDoseMg, targetCe, targetReachTime = 20.0) {
        const testRates = [];
        for (let rate = MasuiModelConstants.OPTIMIZATION_MIN_RATE; 
             rate <= MasuiModelConstants.OPTIMIZATION_MAX_RATE; 
             rate += MasuiModelConstants.OPTIMIZATION_STEP) {
            testRates.push(rate);
        }
        
        let bestRate = 1.0;
        let bestError = Infinity;
        const optimizationResults = [];
        
        for (const testRate of testRates) {
            const ceAtTarget = this.simulateBolusAndContinuous(bolusDoseMg, testRate, targetReachTime);
            const error = Math.abs(ceAtTarget - targetCe);
            const relativeError = (error / targetCe) * 100;
            
            optimizationResults.push({
                rate: testRate,
                ceAtTarget: ceAtTarget,
                error: error,
                relativeError: relativeError
            });
            
            if (error < bestError) {
                bestError = error;
                bestRate = testRate;
            }
        }
        
        const predictedCe = this.simulateBolusAndContinuous(bolusDoseMg, bestRate, targetReachTime);
        
        return {
            optimalRate: bestRate,
            predictedCe: predictedCe,
            error: bestError,
            relativeError: (bestError / targetCe) * 100,
            allResults: optimizationResults
        };
    }
    
    // Simulate bolus + continuous infusion for specified time
    simulateBolusAndContinuous(bolusDoseMg, continuousRate, targetTime) {
        const bolusState = this.calculateBolusInitialState(bolusDoseMg);
        let state = { a1: bolusState.a1, a2: bolusState.a2, a3: bolusState.a3 };
        let currentCe = bolusState.effectSiteConc;
        
        const infusionRateMgMin = (continuousRate * this.patient.weight) / 60.0;
        const numSteps = Math.floor(targetTime / this.timeStep);
        
        for (let i = 0; i < numSteps; i++) {
            const plasmaConc = state.a1 / this.pkParams.v1;
            
            // Update effect-site concentration
            const dCedt = this.pkParams.ke0 * (plasmaConc - currentCe);
            currentCe = currentCe + this.timeStep * dCedt;
            
            // Update system state using RK4
            state = this.updateSystemStateRK4(state, infusionRateMgMin, this.timeStep);
        }
        
        return currentCe;
    }
    
    // 4th order Runge-Kutta integration (Context7 Math.NET inspired)
    updateSystemStateRK4(state, infusionRateMgMin, dt) {
        const k10 = this.pkParams.getK10();
        const k12 = this.pkParams.getK12();
        const k21 = this.pkParams.getK21();
        const k13 = this.pkParams.getK13();
        const k31 = this.pkParams.getK31();
        
        const derivatives = (s) => ({
            da1dt: infusionRateMgMin - (k10 + k12 + k13) * s.a1 + k21 * s.a2 + k31 * s.a3,
            da2dt: k12 * s.a1 - k21 * s.a2,
            da3dt: k13 * s.a1 - k31 * s.a3
        });
        
        // 4th order Runge-Kutta integration
        const k1 = derivatives(state);
        const k2 = derivatives({
            a1: state.a1 + 0.5 * dt * k1.da1dt,
            a2: state.a2 + 0.5 * dt * k1.da2dt,
            a3: state.a3 + 0.5 * dt * k1.da3dt
        });
        const k3 = derivatives({
            a1: state.a1 + 0.5 * dt * k2.da1dt,
            a2: state.a2 + 0.5 * dt * k2.da2dt,
            a3: state.a3 + 0.5 * dt * k2.da3dt
        });
        const k4 = derivatives({
            a1: state.a1 + dt * k3.da1dt,
            a2: state.a2 + dt * k3.da2dt,
            a3: state.a3 + dt * k3.da3dt
        });
        
        return {
            a1: state.a1 + (dt / 6.0) * (k1.da1dt + 2*k2.da1dt + 2*k3.da1dt + k4.da1dt),
            a2: state.a2 + (dt / 6.0) * (k1.da2dt + 2*k2.da2dt + 2*k3.da2dt + k4.da2dt),
            a3: state.a3 + (dt / 6.0) * (k1.da3dt + 2*k2.da3dt + 2*k3.da3dt + k4.da3dt)
        };
    }
}

class BolusThresholdSimulator {
    constructor(patient, pkParams) {
        this.patient = patient;
        this.pkParams = pkParams;
        this.timeStep = MasuiModelConstants.TIME_STEP;
        this.optimizer = new BolusOptimizer(patient, pkParams);
    }
    
    // Complete bolus + threshold-based protocol simulation
    simulateCompleteProtocol(bolusDoseMg, initialContinuousRate, thresholdParams) {
        const upperThreshold = thresholdParams.targetCe * thresholdParams.upperThresholdRatio;
        const reductionFactor = thresholdParams.reductionFactor;
        const minimumInterval = 5.0; // 5 minutes minimum between adjustments
        
        const bolusState = this.optimizer.calculateBolusInitialState(bolusDoseMg);
        let state = { a1: bolusState.a1, a2: bolusState.a2, a3: bolusState.a3 };
        let currentCe = bolusState.effectSiteConc;
        let currentRate = initialContinuousRate;
        
        const timeSeriesData = [];
        const dosageAdjustments = [];
        let lastAdjustmentTime = -minimumInterval; // Allow first adjustment
        let adjustmentCount = 0;
        
        const numSteps = Math.floor(MasuiModelConstants.SIMULATION_DURATION / this.timeStep) + 1;
        
        for (let i = 0; i < numSteps; i++) {
            const currentTime = i * this.timeStep;
            const infusionRateMgMin = (currentRate * this.patient.weight) / 60.0;
            
            // Calculate plasma concentration
            const plasmaConc = state.a1 / this.pkParams.v1;
            
            // Update effect-site concentration
            if (i > 0) {
                const dCedt = this.pkParams.ke0 * (plasmaConc - currentCe);
                currentCe = currentCe + this.timeStep * dCedt;
            }
            
            // Threshold checking and dose adjustment
            if (currentCe >= upperThreshold && 
                currentTime - lastAdjustmentTime >= minimumInterval &&
                currentRate > MasuiModelConstants.MIN_INFUSION_RATE) {
                
                const oldRate = currentRate;
                currentRate = Math.max(MasuiModelConstants.MIN_INFUSION_RATE, currentRate * reductionFactor);
                
                dosageAdjustments.push({
                    time: currentTime,
                    type: 'threshold_reduction',
                    oldRate: oldRate,
                    newRate: currentRate,
                    ceAtEvent: currentCe,
                    reductionPercent: ((oldRate - currentRate) / oldRate) * 100,
                    adjustmentNumber: ++adjustmentCount
                });
                
                lastAdjustmentTime = currentTime;
            }
            
            // Store data point
            timeSeriesData.push({
                time: parseFloat(currentTime.toFixed(1)),
                ce: currentCe,
                plasma: plasmaConc,
                infusionRate: currentRate,
                targetCe: thresholdParams.targetCe,
                upperThreshold: upperThreshold,
                adjustmentNumber: adjustmentCount,
                isBolus: i === 0,
                timeSinceLastAdjustment: currentTime - lastAdjustmentTime
            });
            
            // Update system state
            if (i < numSteps - 1) {
                state = this.optimizer.updateSystemStateRK4(state, infusionRateMgMin, this.timeStep);
            }
        }
        
        return {
            timeSeriesData: timeSeriesData,
            dosageAdjustments: dosageAdjustments,
            performance: this.evaluatePerformance(timeSeriesData, thresholdParams.targetCe),
            bolusDose: bolusDoseMg,
            initialContinuousRate: initialContinuousRate,
            thresholdParams: thresholdParams
        };
    }
    
    // Evaluate protocol performance
    evaluatePerformance(timeSeriesData, targetCe) {
        // Evaluate maintenance period (after 60 minutes)
        const maintenanceData = timeSeriesData.filter(point => point.time >= 60);
        
        if (maintenanceData.length === 0) {
            return {
                finalCe: 0,
                maxCe: 0,
                avgDeviation: Infinity,
                targetAccuracy: 0,
                stabilityIndex: 0,
                convergenceTime: Infinity
            };
        }
        
        // Final concentration
        const finalCe = timeSeriesData[timeSeriesData.length - 1].ce;
        
        // Maximum concentration
        const maxCe = Math.max(...timeSeriesData.map(point => point.ce));
        
        // Average deviation from target
        const deviations = maintenanceData.map(point => Math.abs(point.ce - targetCe));
        const avgDeviation = deviations.reduce((sum, dev) => sum + dev, 0) / deviations.length;
        
        // Target accuracy (percentage of time within ±10% of target)
        const tolerance = targetCe * 0.1;
        const withinTolerance = maintenanceData.filter(point => 
            Math.abs(point.ce - targetCe) <= tolerance
        ).length;
        const targetAccuracy = (withinTolerance / maintenanceData.length) * 100;
        
        // Stability index (low concentration variation)
        let totalVariation = 0;
        for (let i = 1; i < maintenanceData.length; i++) {
            totalVariation += Math.abs(maintenanceData[i].ce - maintenanceData[i-1].ce);
        }
        const avgVariation = totalVariation / (maintenanceData.length - 1);
        const stabilityIndex = Math.max(0, 100 - (avgVariation * 1000));
        
        // Convergence time (time to reach within ±5% of target)
        const convergenceThreshold = targetCe * 0.05;
        let convergenceTime = Infinity;
        for (const point of timeSeriesData) {
            if (Math.abs(point.ce - targetCe) <= convergenceThreshold) {
                convergenceTime = point.time;
                break;
            }
        }
        
        return {
            finalCe: finalCe,
            maxCe: maxCe,
            avgDeviation: avgDeviation,
            targetAccuracy: targetAccuracy,
            stabilityIndex: stabilityIndex,
            convergenceTime: convergenceTime
        };
    }
}

class BolusProtocolCalculator {
    constructor() {
        this.pkCalculator = new PKParameterCalculator();
    }
    
    calculateBolusProtocol(patient, bolusDoseMg, targetCe, protocolParams = {}) {
        const startTime = performance.now();
        
        // Patient validation
        const validation = patient.validate();
        if (!validation.isValid) {
            throw new Error("Patient validation failed: " + validation.errors.join(", "));
        }
        
        // Bolus dose validation
        if (bolusDoseMg < MasuiModelConstants.MIN_BOLUS_DOSE || 
            bolusDoseMg > MasuiModelConstants.MAX_BOLUS_DOSE) {
            throw new Error(`ボーラス投与量は${MasuiModelConstants.MIN_BOLUS_DOSE}-${MasuiModelConstants.MAX_BOLUS_DOSE}mgの範囲で入力してください`);
        }
        
        // Target concentration validation
        if (targetCe < 0.5 || targetCe > 3.0) {
            throw new Error("目標効果部位濃度は0.5-3.0 μg/mLの範囲で入力してください");
        }
        
        // Set default protocol parameters
        const defaultParams = {
            targetReachTime: MasuiModelConstants.DEFAULT_TARGET_REACH_TIME,
            upperThresholdRatio: MasuiModelConstants.DEFAULT_UPPER_THRESHOLD_RATIO,
            reductionFactor: MasuiModelConstants.OPTIMIZED_REDUCTION_FACTOR,
            targetCe: targetCe
        };
        const finalParams = { ...defaultParams, ...protocolParams };
        
        // Calculate PK parameters
        const pkParams = this.pkCalculator.calculatePKParameters(patient);
        
        // Optimize continuous infusion rate
        const optimizer = new BolusOptimizer(patient, pkParams);
        const optimizationResult = optimizer.optimizeContinuousRate(
            bolusDoseMg, targetCe, finalParams.targetReachTime
        );
        
        // Simulate complete protocol
        const simulator = new BolusThresholdSimulator(patient, pkParams);
        const simulationResult = simulator.simulateCompleteProtocol(
            bolusDoseMg, optimizationResult.optimalRate, finalParams
        );
        
        // Generate clinical protocol
        const clinicalProtocol = this.generateClinicalProtocol(
            bolusDoseMg, optimizationResult.optimalRate, simulationResult.dosageAdjustments, patient
        );
        
        // Generate comparison data
        const comparisonData = this.generateBolusComparison(patient, targetCe, finalParams);
        
        const endTime = performance.now();
        const calculationTime = Math.round(endTime - startTime);
        
        return {
            patient: patient,
            pkParams: pkParams,
            bolusDose: bolusDoseMg,
            targetCe: targetCe,
            optimalContinuousRate: optimizationResult.optimalRate,
            optimizationResult: optimizationResult,
            simulationData: simulationResult.timeSeriesData,
            dosageAdjustments: simulationResult.dosageAdjustments,
            performance: simulationResult.performance,
            clinicalProtocol: clinicalProtocol,
            comparisonData: comparisonData,
            protocolParams: finalParams,
            calculationTimeMs: calculationTime
        };
    }
    
    generateClinicalProtocol(bolusDoseMg, continuousRate, adjustments, patient) {
        const protocol = [];
        
        // Step 1: Bolus dose
        protocol.push({
            step: 1,
            method: 'ボーラス投与',
            dose: `${bolusDoseMg} mg`,
            totalDose: `${bolusDoseMg} mg`,
            timing: '麻酔導入時（即座）',
            notes: '瞬時静脈内投与'
        });
        
        // Step 2: Initial continuous infusion
        protocol.push({
            step: 2,
            method: '持続投与開始',
            dose: `${continuousRate.toFixed(2)} mg/kg/hr`,
            totalDose: `${(continuousRate * patient.weight).toFixed(1)} mg/hr`,
            timing: 'ボーラス投与直後',
            notes: '最適化された投与量'
        });
        
        // Step 3+: Threshold adjustments
        adjustments.forEach((adjustment, index) => {
            protocol.push({
                step: index + 3,
                method: '閾値ベース減量',
                dose: `${adjustment.newRate.toFixed(2)} mg/kg/hr`,
                totalDose: `${(adjustment.newRate * patient.weight).toFixed(1)} mg/hr`,
                timing: `${adjustment.time.toFixed(0)}分後`,
                notes: `${adjustment.reductionPercent.toFixed(0)}%減量`
            });
        });
        
        return protocol;
    }
    
    generateBolusComparison(patient, targetCe, protocolParams) {
        const testBolusDoses = [3, 5, 7, 10]; // mg
        const comparisonResults = [];
        
        const pkParams = this.pkCalculator.calculatePKParameters(patient);
        
        for (const testBolus of testBolusDoses) {
            try {
                const optimizer = new BolusOptimizer(patient, pkParams);
                const optimizationResult = optimizer.optimizeContinuousRate(
                    testBolus, targetCe, protocolParams.targetReachTime
                );
                
                const simulator = new BolusThresholdSimulator(patient, pkParams);
                const simulationResult = simulator.simulateCompleteProtocol(
                    testBolus, optimizationResult.optimalRate, protocolParams
                );
                
                const adjustmentCount = simulationResult.dosageAdjustments.length;
                const recommendation = this.getRecommendationLevel(simulationResult.performance, adjustmentCount);
                
                comparisonResults.push({
                    bolusDose: testBolus,
                    optimalRate: optimizationResult.optimalRate,
                    finalCe: simulationResult.performance.finalCe,
                    targetAccuracy: simulationResult.performance.targetAccuracy,
                    adjustmentCount: adjustmentCount,
                    recommendation: recommendation
                });
            } catch (error) {
                // Skip if calculation fails
                console.warn(`Comparison calculation failed for ${testBolus}mg:`, error);
            }
        }
        
        return comparisonResults;
    }
    
    getRecommendationLevel(performance, adjustmentCount) {
        const targetDeviation = Math.abs(performance.finalCe - 1.0);
        const accuracy = performance.targetAccuracy;
        
        // Score based on accuracy and simplicity
        let score = accuracy;
        if (adjustmentCount === 1) score += 10; // Bonus for simplicity
        if (targetDeviation < 0.1) score += 15; // Bonus for accuracy
        
        if (score >= 90) return '推奨';
        if (score >= 75) return '良好';
        if (score >= 60) return '可';
        return '要検討';
    }
}

class BolusAlertManager {
    constructor() {
        this.alerts = [];
        this.audioContext = null;
        this.isAudioEnabled = false;
        this.isBolusAlertEnabled = false;
    }
    
    async enableAudio() {
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.isAudioEnabled = true;
            return true;
        } catch (error) {
            console.warn('Audio not available:', error);
            return false;
        }
    }
    
    enableBolusAlerts(enable = true) {
        this.isBolusAlertEnabled = enable;
    }
    
    generateBolusAlerts(dosageAdjustments, clinicalProtocol) {
        this.alerts = [];
        
        // Bolus administration alert
        if (this.isBolusAlertEnabled) {
            this.alerts.push({
                time: 0,
                type: 'bolus',
                title: 'ボーラス投与実行',
                message: `${clinicalProtocol[0].dose}を瞬時静脈内投与してください。`,
                protocol: clinicalProtocol[0]
            });
            
            // Continuous infusion start alert
            this.alerts.push({
                time: 0.5, // 30 seconds after bolus
                type: 'continuous_start',
                title: '持続投与開始',
                message: `${clinicalProtocol[1].dose}で持続投与を開始してください。`,
                protocol: clinicalProtocol[1]
            });
        }
        
        // Threshold adjustment alerts
        dosageAdjustments.forEach((adjustment, index) => {
            this.alerts.push({
                time: adjustment.time - 2, // 2 minutes before
                type: 'warning',
                title: '投与量変更予告',
                message: `2分後に投与量を${adjustment.newRate.toFixed(2)} mg/kg/hrに減量してください。`,
                adjustment: adjustment
            });
            
            this.alerts.push({
                time: adjustment.time,
                type: 'adjustment',
                title: '投与量減量実行',
                message: `投与量を${adjustment.newRate.toFixed(2)} mg/kg/hrに変更してください（${adjustment.reductionPercent.toFixed(0)}%減量）。`,
                adjustment: adjustment
            });
        });
        
        return this.alerts;
    }
    
    playBolusAlert(type) {
        if (!this.audioContext) return;
        
        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(this.audioContext.destination);
        
        // Different tones for different alert types
        let frequency, duration, beeps;
        switch (type) {
            case 'bolus':
                frequency = 800;
                duration = 1.0;
                beeps = 3;
                break;
            case 'continuous_start':
                frequency = 600;
                duration = 0.5;
                beeps = 2;
                break;
            case 'adjustment':
                frequency = 1000;
                duration = 0.3;
                beeps = 2;
                break;
            default:
                frequency = 900;
                duration = 0.4;
                beeps = 1;
        }
        
        for (let i = 0; i < beeps; i++) {
            const beepStart = this.audioContext.currentTime + (i * 0.4);
            const beepEnd = beepStart + 0.2;
            
            oscillator.frequency.value = frequency;
            oscillator.type = 'sine';
            
            gainNode.gain.setValueAtTime(0, beepStart);
            gainNode.gain.linearRampToValueAtTime(0.3, beepStart + 0.01);
            gainNode.gain.exponentialRampToValueAtTime(0.01, beepEnd);
        }
        
        oscillator.start(this.audioContext.currentTime);
        oscillator.stop(this.audioContext.currentTime + duration);
    }
    
    requestNotificationPermission() {
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }
    }
}

// Export for use in main application
window.RemimazolamV33 = {
    MasuiModelConstants,
    Patient,
    PKParameters,
    PKParameterCalculator,
    BolusOptimizer,
    BolusThresholdSimulator,
    BolusProtocolCalculator,
    BolusAlertManager
};