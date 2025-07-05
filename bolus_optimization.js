// Remimazolam V3.3 - Bolus + Continuous Infusion Optimization
// Context7 Math.NET Numerics inspired numerical methods

class BolusOptimizationCalculator {
    constructor() {
        // 基本PKパラメータ (標準的な70kg, 55歳男性)
        this.v1 = 3.57;
        this.v2 = 11.3;
        this.v3 = 27.2;
        this.cl = 0.401;
        this.q2 = 0.8 * this.cl;
        this.q3 = 0.3 * this.cl;
        this.ke0 = 0.12;
        this.weight = 70;
        
        // 制御パラメータ
        this.targetCe = 1.0;
        this.upperThreshold = 1.2;
        this.reductionFactor = 0.70;
        this.timeStep = 0.1;
        this.simulationDuration = 180;
    }
    
    // PKパラメータから速度定数を計算
    getK10() { return this.cl / this.v1; }
    getK12() { return this.q2 / this.v1; }
    getK21() { return this.q2 / this.v2; }
    getK13() { return this.q3 / this.v1; }
    getK31() { return this.q3 / this.v3; }
    
    // ボーラス投与後の初期血中濃度を計算
    calculateBolusInitialConcentration(bolusDoseMg) {
        // ボーラス投与は瞬時にV1に分布すると仮定
        const bolusDosePerKg = bolusDoseMg / this.weight;
        const initialPlasmaConc = bolusDosePerKg / this.v1;
        return {
            a1: bolusDoseMg, // mg
            a2: 0.0,
            a3: 0.0,
            plasmaConc: initialPlasmaConc, // μg/mL
            effectSiteConc: 0.0 // 効果部位は時間かけて上昇
        };
    }
    
    // 目標濃度到達のための持続投与量を逆算
    // Context7 Math.NET Numerics: 線形方程式求解手法を参考
    optimizeContinuousInfusionRate(bolusDoseMg, targetCe, timeToTarget = 20) {
        console.log(`=== ボーラス後持続投与量最適化 ===`);
        console.log(`ボーラス投与量: ${bolusDoseMg} mg`);
        console.log(`目標濃度: ${targetCe} μg/mL`);
        console.log(`目標到達時間: ${timeToTarget} 分`);
        console.log("");
        
        // テスト範囲の持続投与量
        const testRates = [];
        for (let rate = 0.5; rate <= 4.0; rate += 0.1) {
            testRates.push(rate);
        }
        
        let bestRate = 1.0;
        let bestError = Infinity;
        const results = [];
        
        for (const testRate of testRates) {
            const ceAtTarget = this.simulateBolusAndContinuous(bolusDoseMg, testRate, timeToTarget);
            const error = Math.abs(ceAtTarget - targetCe);
            
            results.push({
                rate: testRate,
                ceAtTarget: ceAtTarget,
                error: error,
                relativeError: (error / targetCe) * 100
            });
            
            if (error < bestError) {
                bestError = error;
                bestRate = testRate;
            }
        }
        
        // 結果表示
        console.log("持続投与量最適化結果:");
        results.filter((r, i) => i % 5 === 0).forEach(result => {
            console.log(`  ${result.rate.toFixed(1)} mg/kg/hr → Ce=${result.ceAtTarget.toFixed(3)} μg/mL (誤差: ${result.relativeError.toFixed(1)}%)`);
        });
        
        console.log("");
        console.log(`最適持続投与量: ${bestRate.toFixed(2)} mg/kg/hr`);
        console.log(`予測到達濃度: ${this.simulateBolusAndContinuous(bolusDoseMg, bestRate, timeToTarget).toFixed(3)} μg/mL`);
        console.log(`誤差: ${bestError.toFixed(4)} μg/mL (${(bestError/targetCe*100).toFixed(2)}%)`);
        
        return {
            optimalRate: bestRate,
            predictedCe: this.simulateBolusAndContinuous(bolusDoseMg, bestRate, timeToTarget),
            error: bestError,
            allResults: results
        };
    }
    
    // ボーラス+持続投与の指定時間での効果部位濃度を計算
    simulateBolusAndContinuous(bolusDoseMg, continuousRate, targetTime) {
        const bolusState = this.calculateBolusInitialConcentration(bolusDoseMg);
        let state = { a1: bolusState.a1, a2: bolusState.a2, a3: bolusState.a3 };
        let currentCe = bolusState.effectSiteConc;
        
        const infusionRateMgMin = (continuousRate * this.weight) / 60.0;
        const numSteps = Math.floor(targetTime / this.timeStep);
        
        for (let i = 0; i < numSteps; i++) {
            const plasmaConc = state.a1 / this.v1;
            
            // 効果部位濃度更新
            const dCedt = this.ke0 * (plasmaConc - currentCe);
            currentCe = currentCe + this.timeStep * dCedt;
            
            // システム状態更新 (Context7 Math.NET: ルンゲ・クッタ法参考)
            state = this.updateSystemStateRK4(state, infusionRateMgMin, this.timeStep);
        }
        
        return currentCe;
    }
    
    // 完全なボーラス+閾値ベース漸減シミュレーション
    simulateCompleteBolusProtocol(bolusDoseMg, initialContinuousRate) {
        console.log(`=== 完全ボーラス+閾値ベースプロトコル ===`);
        
        const bolusState = this.calculateBolusInitialConcentration(bolusDoseMg);
        let state = { a1: bolusState.a1, a2: bolusState.a2, a3: bolusState.a3 };
        let currentCe = bolusState.effectSiteConc;
        let currentRate = initialContinuousRate;
        
        const timeSeriesData = [];
        const dosageAdjustments = [];
        let lastAdjustmentTime = -5; // 最初の調整を許可
        let adjustmentCount = 0;
        
        const numSteps = Math.floor(this.simulationDuration / this.timeStep) + 1;
        
        for (let i = 0; i < numSteps; i++) {
            const currentTime = i * this.timeStep;
            const infusionRateMgMin = (currentRate * this.weight) / 60.0;
            
            // 血漿濃度計算
            const plasmaConc = state.a1 / this.v1;
            
            // 効果部位濃度更新
            if (i > 0) {
                const dCedt = this.ke0 * (plasmaConc - currentCe);
                currentCe = currentCe + this.timeStep * dCedt;
            }
            
            // 閾値チェックと投与量調整
            if (currentCe >= this.upperThreshold && 
                currentTime - lastAdjustmentTime >= 5.0 && // 5分間隔制限
                currentRate > 0.1) {
                
                const oldRate = currentRate;
                currentRate = Math.max(0.1, currentRate * this.reductionFactor);
                
                dosageAdjustments.push({
                    time: currentTime,
                    type: 'threshold_reduction',
                    oldRate: oldRate,
                    newRate: currentRate,
                    ceAtEvent: currentCe,
                    adjustmentNumber: ++adjustmentCount
                });
                
                lastAdjustmentTime = currentTime;
                console.log(`${currentTime.toFixed(1)}分: 閾値到達 Ce=${currentCe.toFixed(3)} → 投与量 ${oldRate.toFixed(2)} → ${currentRate.toFixed(2)} mg/kg/hr`);
            }
            
            // データ記録
            timeSeriesData.push({
                time: parseFloat(currentTime.toFixed(1)),
                ce: currentCe,
                plasma: plasmaConc,
                infusionRate: currentRate,
                targetCe: this.targetCe,
                upperThreshold: this.upperThreshold,
                adjustmentNumber: adjustmentCount,
                isBolus: i === 0
            });
            
            // システム状態更新
            if (i < numSteps - 1) {
                state = this.updateSystemStateRK4(state, infusionRateMgMin, this.timeStep);
            }
        }
        
        // 性能評価
        const performance = this.evaluateBolusPerformance(timeSeriesData, dosageAdjustments);
        
        console.log("");
        console.log("=== 性能評価結果 ===");
        console.log(`最終効果部位濃度: ${performance.finalCe.toFixed(3)} μg/mL`);
        console.log(`平均偏差: ${performance.avgDeviation.toFixed(4)} μg/mL`);
        console.log(`目標精度: ${performance.targetAccuracy.toFixed(1)}%`);
        console.log(`調整回数: ${performance.totalAdjustments} 回`);
        console.log(`最大濃度: ${performance.maxCe.toFixed(3)} μg/mL`);
        
        return {
            timeSeriesData: timeSeriesData,
            dosageAdjustments: dosageAdjustments,
            performance: performance,
            bolusDose: bolusDoseMg,
            initialContinuousRate: initialContinuousRate
        };
    }
    
    // 4次ルンゲ・クッタ法での状態更新 (Context7 Math.NET参考)
    updateSystemStateRK4(state, infusionRateMgMin, dt) {
        const k10 = this.getK10();
        const k12 = this.getK12();
        const k21 = this.getK21();
        const k13 = this.getK13();
        const k31 = this.getK31();
        
        const derivatives = (s) => ({
            da1dt: infusionRateMgMin - (k10 + k12 + k13) * s.a1 + k21 * s.a2 + k31 * s.a3,
            da2dt: k12 * s.a1 - k21 * s.a2,
            da3dt: k13 * s.a1 - k31 * s.a3
        });
        
        // 4次ルンゲ・クッタ積分法
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
    
    // ボーラスプロトコルの性能評価
    evaluateBolusPerformance(timeSeriesData, dosageAdjustments) {
        // 維持期データ（60分以降）を評価
        const maintenanceData = timeSeriesData.filter(point => point.time >= 60);
        
        if (maintenanceData.length === 0) {
            return {
                finalCe: 0,
                avgDeviation: Infinity,
                targetAccuracy: 0,
                totalAdjustments: dosageAdjustments.length,
                maxCe: 0
            };
        }
        
        // 最終濃度
        const finalCe = timeSeriesData[timeSeriesData.length - 1].ce;
        
        // 最大濃度
        const maxCe = Math.max(...timeSeriesData.map(point => point.ce));
        
        // 平均偏差
        const deviations = maintenanceData.map(point => Math.abs(point.ce - this.targetCe));
        const avgDeviation = deviations.reduce((sum, dev) => sum + dev, 0) / deviations.length;
        
        // 目標精度（±10%以内の時間割合）
        const tolerance = this.targetCe * 0.1;
        const withinTolerance = maintenanceData.filter(point => 
            Math.abs(point.ce - this.targetCe) <= tolerance
        ).length;
        const targetAccuracy = (withinTolerance / maintenanceData.length) * 100;
        
        return {
            finalCe: finalCe,
            avgDeviation: avgDeviation,
            targetAccuracy: targetAccuracy,
            totalAdjustments: dosageAdjustments.length,
            maxCe: maxCe
        };
    }
    
    // 複数のボーラス投与量をテスト
    testBolusOptimization() {
        console.log("=== ボーラス投与量最適化テスト ===");
        console.log("");
        
        const testBolusDoses = [3, 5, 7, 10]; // mg
        const results = [];
        
        for (const bolusDose of testBolusDoses) {
            console.log(`--- ボーラス投与量: ${bolusDose} mg ---`);
            
            // 最適持続投与量を計算
            const optimizationResult = this.optimizeContinuousInfusionRate(bolusDose, this.targetCe, 20);
            
            // 完全プロトコルシミュレーション
            const protocolResult = this.simulateCompleteBolusProtocol(bolusDose, optimizationResult.optimalRate);
            
            results.push({
                bolusDose: bolusDose,
                optimalContinuousRate: optimizationResult.optimalRate,
                finalCe: protocolResult.performance.finalCe,
                maxCe: protocolResult.performance.maxCe,
                avgDeviation: protocolResult.performance.avgDeviation,
                targetAccuracy: protocolResult.performance.targetAccuracy,
                totalAdjustments: protocolResult.performance.totalAdjustments
            });
            
            console.log("");
        }
        
        // 比較結果
        console.log("=== ボーラス投与量比較結果 ===");
        console.log("投与量(mg) | 持続(mg/kg/hr) | 最終Ce | 最大Ce | 平均偏差 | 精度(%) | 調整回数");
        console.log("-----------|---------------|--------|--------|----------|---------|----------");
        
        results.forEach(r => {
            console.log(`${r.bolusDose.toString().padStart(9)} | ${r.optimalContinuousRate.toFixed(2).padStart(13)} | ${r.finalCe.toFixed(3).padStart(6)} | ${r.maxCe.toFixed(3).padStart(6)} | ${r.avgDeviation.toFixed(4).padStart(8)} | ${r.targetAccuracy.toFixed(1).padStart(7)} | ${r.totalAdjustments.toString().padStart(8)}`);
        });
        
        // 推奨を選択
        const bestResult = results.reduce((best, current) => {
            // 最終濃度が目標に近く、調整回数が少ない方を優先
            const bestScore = Math.abs(best.finalCe - this.targetCe) + (best.totalAdjustments * 0.1);
            const currentScore = Math.abs(current.finalCe - this.targetCe) + (current.totalAdjustments * 0.1);
            return currentScore < bestScore ? current : best;
        });
        
        console.log("");
        console.log(`推奨ボーラス投与量: ${bestResult.bolusDose} mg`);
        console.log(`推奨持続投与量: ${bestResult.optimalContinuousRate.toFixed(2)} mg/kg/hr`);
        console.log(`期待される最終濃度: ${bestResult.finalCe.toFixed(3)} μg/mL`);
        
        return {
            allResults: results,
            recommendedBolus: bestResult.bolusDose,
            recommendedContinuous: bestResult.optimalContinuousRate,
            bestPerformance: bestResult
        };
    }
}

// 最適化実行
const bolusOptimizer = new BolusOptimizationCalculator();
const optimizationResults = bolusOptimizer.testBolusOptimization();

// 結果のエクスポート
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        BolusOptimizationCalculator,
        optimizationResults
    };
}