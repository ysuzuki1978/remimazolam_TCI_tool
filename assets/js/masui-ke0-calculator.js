/**
 * Masui Ke0 Calculator for Remimazolam V3.4
 * 正解アプリのmasui-ke0-exact.jsから移植
 */

// Masui 2022 model constants (theta values)
const MASUI_THETA = {
    1: 3.57,   // V1 coefficient
    2: 11.3,   // V2 coefficient  
    3: 27.2,   // V3 coefficient
    4: 1.03,   // CL coefficient
    5: 1.10,   // Q2 coefficient
    6: 0.401,  // Q3 coefficient
    8: 0.308,  // V3 age coefficient
    9: 0.146,  // CL sex coefficient
    10: -0.184, // CL ASA coefficient
};

// Fixed parameters
const STANDARD_WEIGHT = 67.3; // kg
const STANDARD_AGE = 54.0;     // years
const T_PEAK = 2.6;            // minutes

/**
 * 3次方程式の解を求める（Cardanoの公式使用）
 */
class CubicSolver {
    static solve(a2, a1, a0) {
        // Depressed cubic transformation: t^3 + p*t + q = 0
        const p = a1 - (a2 * a2) / 3;
        const q = (2 * a2 * a2 * a2 - 9 * a2 * a1 + 27 * a0) / 27;
        
        // Discriminant
        const discriminant = Math.pow(q / 2, 2) + Math.pow(p / 3, 3);
        
        const roots = [];
        
        if (discriminant > 1e-10) {
            // One real root
            const sqrt_disc = Math.sqrt(discriminant);
            const u = Math.cbrt(-q / 2 + sqrt_disc);
            const v = Math.cbrt(-q / 2 - sqrt_disc);
            const t = u + v;
            const x = t - a2 / 3;
            roots.push(x);
        } else if (Math.abs(discriminant) < 1e-10) {
            // Two or three real roots (repeated)
            if (Math.abs(p) < 1e-10) {
                // Triple root
                const x = -a2 / 3;
                roots.push(x, x, x);
            } else {
                // Double root
                const t1 = 3 * q / p;
                const t2 = -3 * q / (2 * p);
                const x1 = t1 - a2 / 3;
                const x2 = t2 - a2 / 3;
                roots.push(x1, x2, x2);
            }
        } else {
            // Three distinct real roots
            const rho = Math.sqrt(-Math.pow(p / 3, 3));
            const theta = Math.acos(-q / (2 * rho));
            
            for (let k = 0; k < 3; k++) {
                const t = 2 * Math.cbrt(rho) * Math.cos((theta + 2 * Math.PI * k) / 3);
                const x = t - a2 / 3;
                roots.push(x);
            }
        }
        
        // Return only real roots, sorted by magnitude (descending)
        return roots
            .filter(root => typeof root === 'number' && isFinite(root))
            .map(root => Math.abs(root))
            .sort((a, b) => b - a);
    }
}

/**
 * 数値的根探索（ブレント法）
 */
class BrentSolver {
    static findRoot(func, a, b, tolerance = 1e-12, maxIterations = 100) {
        let fa = func(a);
        let fb = func(b);
        
        if (fa * fb > 0) {
            throw new Error('Function values at endpoints must have opposite signs');
        }
        
        if (Math.abs(fa) < Math.abs(fb)) {
            [a, b] = [b, a];
            [fa, fb] = [fb, fa];
        }
        
        let c = a;
        let fc = fa;
        let mflag = true;
        let d = 0;
        
        for (let iter = 0; iter < maxIterations; iter++) {
            if (Math.abs(b - a) < tolerance) {
                return b;
            }
            
            let s;
            
            if (fa !== fc && fb !== fc) {
                // Inverse quadratic interpolation
                s = a * fb * fc / ((fa - fb) * (fa - fc)) +
                    b * fa * fc / ((fb - fa) * (fb - fc)) +
                    c * fa * fb / ((fc - fa) * (fc - fb));
            } else {
                // Secant method
                s = b - fb * (b - a) / (fb - fa);
            }
            
            // Check if we should use bisection instead
            const condition1 = s < (3 * a + b) / 4 || s > b;
            const condition2 = mflag && Math.abs(s - b) >= Math.abs(b - c) / 2;
            const condition3 = !mflag && Math.abs(s - b) >= Math.abs(c - d) / 2;
            const condition4 = mflag && Math.abs(b - c) < tolerance;
            const condition5 = !mflag && Math.abs(c - d) < tolerance;
            
            if (condition1 || condition2 || condition3 || condition4 || condition5) {
                s = (a + b) / 2;
                mflag = true;
            } else {
                mflag = false;
            }
            
            const fs = func(s);
            d = c;
            c = b;
            fc = fb;
            
            if (fa * fs < 0) {
                b = s;
                fb = fs;
            } else {
                a = s;
                fa = fs;
            }
            
            if (Math.abs(fa) < Math.abs(fb)) {
                [a, b] = [b, a];
                [fa, fb] = [fb, fa];
            }
        }
        
        return b;
    }
}

/**
 * Masui Ke0計算クラス
 */
class MasuiKe0Calculator {
    /**
     * 患者個別のPKパラメータ計算
     */
    static calculatePKParameters(age, TBW, height, sex, ASAPS) {
        // 理想体重 (IBW)
        const IBW = 45.4 + 0.89 * (height - 152.4) + 4.5 * (1 - sex);
        
        // 調整体重 (ABW)
        const ABW = IBW + 0.4 * (TBW - IBW);
        
        // 分布容積 (L)
        const V1 = MASUI_THETA[1] * (ABW / STANDARD_WEIGHT);
        const V2 = MASUI_THETA[2] * (ABW / STANDARD_WEIGHT);
        const V3 = (MASUI_THETA[3] + MASUI_THETA[8] * (age - STANDARD_AGE)) * (ABW / STANDARD_WEIGHT);
        
        // クリアランス (L/min)
        const CL = (MASUI_THETA[4] + MASUI_THETA[9] * sex + MASUI_THETA[10] * ASAPS) * 
                   Math.pow(ABW / STANDARD_WEIGHT, 0.75);
        const Q2 = MASUI_THETA[5] * Math.pow(ABW / STANDARD_WEIGHT, 0.75);
        const Q3 = MASUI_THETA[6] * Math.pow(ABW / STANDARD_WEIGHT, 0.75);
        
        return { IBW, ABW, V1, V2, V3, CL, Q2, Q3 };
    }
    
    /**
     * 速度定数の計算
     */
    static calculateRateConstants(pkParams) {
        const { V1, V2, V3, CL, Q2, Q3 } = pkParams;
        
        const k10 = CL / V1;
        const k12 = Q2 / V1;
        const k13 = Q3 / V1;
        const k21 = Q2 / V2;
        const k31 = Q3 / V3;
        
        return { k10, k12, k13, k21, k31 };
    }
    
    /**
     * 血漿中濃度式の係数と指数の計算
     */
    static calculatePlasmaCoefficients(rateConstants) {
        const { k10, k12, k13, k21, k31 } = rateConstants;
        
        // 3次方程式の係数
        const a2 = k10 + k12 + k13 + k21 + k31;
        const a1 = (k10 + k13) * k21 + (k10 + k12) * k31 + k21 * k31;
        const a0 = k10 * k21 * k31;
        
        // 3次方程式を解く
        const roots = CubicSolver.solve(a2, a1, a0);
        
        if (roots.length < 3) {
            throw new Error('Could not find three real roots for cubic equation');
        }
        
        // 大きい順にalpha, beta, gamma
        const [alpha, beta, gamma] = roots;
        
        // 係数A, B, Cの計算
        const A = ((k21 - alpha) * (k31 - alpha)) / ((beta - alpha) * (gamma - alpha));
        const B = ((k21 - beta) * (k31 - beta)) / ((alpha - beta) * (gamma - beta));
        const C = ((k21 - gamma) * (k31 - gamma)) / ((alpha - gamma) * (beta - gamma));
        
        return { alpha, beta, gamma, A, B, C };
    }
    
    /**
     * 数値解析によるke0算出（厳密解）
     */
    static calculateKe0Numerical(coefficients, t_peak = T_PEAK) {
        const { alpha, beta, gamma, A, B, C } = coefficients;
        
        // f(ke0)関数の定義
        const f = (ke0) => {
            const term_A = (ke0 * A / (ke0 - alpha)) * 
                          (alpha * Math.exp(-alpha * t_peak) - ke0 * Math.exp(-ke0 * t_peak));
            const term_B = (ke0 * B / (ke0 - beta)) * 
                          (beta * Math.exp(-beta * t_peak) - ke0 * Math.exp(-ke0 * t_peak));
            const term_C = (ke0 * C / (ke0 - gamma)) * 
                          (gamma * Math.exp(-gamma * t_peak) - ke0 * Math.exp(-ke0 * t_peak));
            
            return term_A + term_B + term_C;
        };
        
        // 探索区間で数値解を求める
        try {
            const ke0 = BrentSolver.findRoot(f, 0.05, 0.5);
            return ke0;
        } catch (error) {
            console.warn('Numerical ke0 calculation failed:', error.message);
            return null;
        }
    }
    
    /**
     * 重回帰モデルによるke0算出（近似解）
     */
    static calculateKe0Regression(age, TBW, height, sex, ASAPS) {
        // 補助関数F(x)の計算
        const F_age = 0.228 - (2.72e-5 * age) + (2.96e-7 * Math.pow(age - 55, 2)) - 
                     (4.34e-9 * Math.pow(age - 55, 3)) + (5.05e-11 * Math.pow(age - 55, 4));
        const F_TBW = 0.196 + (3.53e-4 * TBW) - (7.91e-7 * Math.pow(TBW - 90, 2));
        const F_height = 0.148 + (4.73e-4 * height) - (1.43e-6 * Math.pow(height - 167.5, 2));
        const F_sex = 0.237 - (2.16e-2 * sex);
        const F_ASAPS = 0.214 + (2.41e-2 * ASAPS);
        
        // 補助変数F2(x)の計算
        const F2_age = F_age - 0.227;
        const F2_TBW = F_TBW - 0.227;
        const F2_height = F_height - 0.226;
        const F2_sex = F_sex - 0.226;
        const F2_ASAPS = F_ASAPS - 0.226;
        
        // 重回帰式によるke0計算
        const ke0_approx = -9.06 + F_age + F_TBW + F_height + (0.999 * F_sex) + F_ASAPS -
                          (4.50 * F2_age * F2_TBW) - (4.51 * F2_age * F2_height) +
                          (2.46 * F2_age * F2_sex) + (3.35 * F2_age * F2_ASAPS) -
                          (12.6 * F2_TBW * F2_height) + (0.394 * F2_TBW * F2_sex) +
                          (2.06 * F2_TBW * F2_ASAPS) + (0.390 * F2_height * F2_sex) +
                          (2.07 * F2_height * F2_ASAPS) + (5.03 * F2_sex * F2_ASAPS) +
                          (99.8 * F2_age * F2_TBW * F2_height) +
                          (5.11 * F2_TBW * F2_height * F2_sex) -
                          (39.4 * F2_TBW * F2_height * F2_ASAPS) -
                          (5.00 * F2_TBW * F2_sex * F2_ASAPS) -
                          (5.04 * F2_height * F2_sex * F2_ASAPS);
        
        return ke0_approx;
    }
    
    /**
     * メインの計算関数
     */
    static calculateKe0(age, TBW, height, sex, ASAPS) {
        try {
            // PKパラメータ計算
            const pkParams = this.calculatePKParameters(age, TBW, height, sex, ASAPS);
            
            // 速度定数計算
            const rateConstants = this.calculateRateConstants(pkParams);
            
            // 血漿濃度係数計算
            const coefficients = this.calculatePlasmaCoefficients(rateConstants);
            
            // 数値解析による厳密解
            const ke0_numerical = this.calculateKe0Numerical(coefficients);
            
            // 重回帰モデルによる近似解
            const ke0_regression = this.calculateKe0Regression(age, TBW, height, sex, ASAPS);
            
            // 数値解析が成功した場合はそれを使用、失敗した場合は重回帰を使用
            const ke0_final = ke0_numerical !== null ? ke0_numerical : ke0_regression;
            
            return {
                ke0: ke0_final,
                ke0_numerical: ke0_numerical,
                ke0_regression: ke0_regression,
                success: true
            };
            
        } catch (error) {
            console.error('Ke0 calculation failed:', error);
            // フォールバック: 固定値を返す
            return {
                ke0: 0.12,
                error: error.message,
                success: false
            };
        }
    }
}

// Export for use in other modules
if (typeof window !== 'undefined') {
    window.MasuiKe0Calculator = MasuiKe0Calculator;
}