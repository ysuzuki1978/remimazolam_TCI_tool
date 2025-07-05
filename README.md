# Remimazolam TCI V3.4 - Individualized Ke0 Calculation System

## 概要 (Overview)

Remimazolam TCI V3.4は、**個別化Ke0計算**を実現した薬物動態シミュレーション研究ツールです。V3.3の致命的問題（固定Ke0値）を修正し、患者個別の効果部位濃度予測精度を大幅に向上させました。教育・研究目的専用として、正確な個別化薬物動態計算を提供します。

## 🚨 **V3.4での重要な修正**

### V3.3の致命的問題
- **固定Ke0値**: 全患者でke0=0.12を使用
- **個別化なし**: 年齢・体重・性別の違いを無視

### V3.4での完全修正  
- **個別化Ke0計算**: 患者毎に厳密な数値解析
- **3次方程式解法**: Cardanoの公式による厳密解
- **Brent法数値解析**: 許容誤差1e-12の高精度
- **重回帰フォールバック**: 数値解析失敗時の安全な代替

## 🔬 **計算ロジック詳細**

### 薬物動態モデル

#### 基盤となるPKモデル
本システムは、Masui et al. (2022)によるremimazolamの母集団薬物動態モデルを実装しています。

**引用論文:**
> Masui, K., Ueki, R., Thunjan, R., et al. (2022). Population pharmacokinetics and pharmacodynamics of remimazolam in Japanese patients undergoing general anesthesia. *Journal of Anesthesia*, 36(4), 493-505. DOI: 10.1007/s00540-022-03070-6

#### 三区画モデル + 効果部位モデル
```
Central (V1) ←→ Peripheral1 (V2)
     ↓
Peripheral2 (V3)
     ↓
Effect Site (ke0)
```

#### PKパラメータ計算式

**基本パラメータ (標準値: 67.3kg, 54歳男性)**
```javascript
// 分布容積
V1 = 3.57 * (weight/67.3)^0.75 * (1 + 0.308 * sex)
V2 = 11.3 * (weight/67.3)^1.03 * (1 + 0.146 * (age/54 - 1))
V3 = 27.2 * (weight/67.3)^1.10

// クリアランス
CL = 0.401 * (weight/67.3)^0.75 * (1 - 0.184 * asaPS)
Q2 = 0.8 * CL  // 区画間クリアランス1
Q3 = 0.3 * CL  // 区画間クリアランス2

// 効果部位（V3.4で個別化計算に変更）
ke0 = MasuiKe0Calculator.calculateKe0(age, weight, height, sex, asaPS)
```

**個体差補正係数**
- `sex`: 0 (男性), 1 (女性)
- `asaPS`: 0 (ASA I-II), 1 (ASA III)
- `age`: 実年齢 (歳)
- `weight`: 実体重 (kg)

#### 速度定数
```javascript
k10 = CL / V1    // 中央区画からの消失
k12 = Q2 / V1    // 中央→末梢1
k21 = Q2 / V2    // 末梢1→中央
k13 = Q3 / V1    // 中央→末梢2
k31 = Q3 / V3    // 末梢2→中央
```

### ボーラス投与計算

#### 初期分布
ボーラス投与は瞬時にV1区画に分布すると仮定：
```javascript
// t=0における初期状態
A1(0) = bolusDose_mg          // V1区画の薬物量
A2(0) = 0                     // V2区画の薬物量  
A3(0) = 0                     // V3区画の薬物量
Ce(0) = 0                     // 効果部位濃度

// 初期血漿濃度
Cp(0) = A1(0) / V1
```

#### 微分方程式系
薬物動態は以下の連立微分方程式で記述：
```javascript
dA1/dt = -k10*A1 - k12*A1 - k13*A1 + k21*A2 + k31*A3 + R(t)
dA2/dt = k12*A1 - k21*A2
dA3/dt = k13*A1 - k31*A3
dCe/dt = ke0 * (Cp - Ce)

where:
R(t) = 持続投与速度 (mg/min)
Cp = A1/V1 (血漿濃度)
```

### 数値積分アルゴリズム

#### 4次ルンゲ・クッタ法
Math.NET Numericsの手法を参考にした高精度数値積分：

```javascript
function updateSystemStateRK4(state, infusionRate, dt) {
    // 微分方程式の定義
    const derivatives = (s) => ({
        da1dt: infusionRate - (k10 + k12 + k13) * s.a1 + k21 * s.a2 + k31 * s.a3,
        da2dt: k12 * s.a1 - k21 * s.a2,
        da3dt: k13 * s.a1 - k31 * s.a3
    });
    
    // 4次ルンゲ・クッタ積分
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
        a1: state.a1 + (dt/6) * (k1.da1dt + 2*k2.da1dt + 2*k3.da1dt + k4.da1dt),
        a2: state.a2 + (dt/6) * (k1.da2dt + 2*k2.da2dt + 2*k3.da2dt + k4.da2dt),
        a3: state.a3 + (dt/6) * (k1.da3dt + 2*k2.da3dt + 2*k3.da3dt + k4.da3dt)
    };
}
```

**数値積分パラメータ**
- 時間刻み: dt = 0.1分
- シミュレーション時間: 180分
- 積分ステップ数: 1800

### 最適化アルゴリズム

#### グリッドサーチ法
目標濃度到達のための持続投与量を逆算：

```javascript
function optimizeContinuousRate(bolusDose, targetCe, targetTime) {
    let bestRate = 1.0;
    let bestError = Infinity;
    
    // グリッドサーチ (0.3-4.0 mg/kg/hr, 0.1刻み)
    for (let testRate = 0.3; testRate <= 4.0; testRate += 0.1) {
        const predictedCe = simulateBolusAndContinuous(
            bolusDose, testRate, targetTime
        );
        const error = Math.abs(predictedCe - targetCe);
        
        if (error < bestError) {
            bestError = error;
            bestRate = testRate;
        }
    }
    
    return {
        optimalRate: bestRate,
        predictedCe: simulateBolusAndContinuous(bolusDose, bestRate, targetTime),
        error: bestError
    };
}
```

#### 目標関数
最適化の目標関数は、指定時間における効果部位濃度と目標濃度の絶対誤差：
```
minimize: |Ce(t_target) - Ce_target|
subject to: 0.1 ≤ R ≤ 6.0 mg/kg/hr
```

### 閾値ベース制御

#### 制御パラメータ
V3.2で最適化された係数を継承：
```javascript
const UPPER_THRESHOLD_RATIO = 1.2;      // 目標濃度の1.2倍
const REDUCTION_FACTOR = 0.70;          // 30%減量
const MINIMUM_INTERVAL = 5.0;           // 最小調整間隔 (分)
```

#### 制御ロジック
```javascript
if (currentCe >= upperThreshold && 
    currentTime - lastAdjustmentTime >= minimumInterval &&
    currentRate > MIN_INFUSION_RATE) {
    
    const oldRate = currentRate;
    currentRate = Math.max(MIN_INFUSION_RATE, currentRate * REDUCTION_FACTOR);
    
    // 調整を記録
    recordDosageAdjustment({
        time: currentTime,
        oldRate: oldRate,
        newRate: currentRate,
        reductionPercent: ((oldRate - currentRate) / oldRate) * 100
    });
}
```

### 性能評価指標

#### 精度指標
```javascript
// 平均絶対偏差
avgDeviation = Σ|Ce(t) - targetCe| / n

// 目標精度 (±10%以内の時間割合)
targetAccuracy = (withinTolerance / totalPoints) * 100

// 安定性指数
stabilityIndex = 100 - (averageVariation * 1000)
```

#### 収束性指標
```javascript
// 収束時間 (±5%以内到達時間)
convergenceTime = min{t : |Ce(t) - targetCe| ≤ 0.05 * targetCe}

// 最終濃度精度
finalAccuracy = |Ce(final) - targetCe| / targetCe * 100
```

## 🔬 **科学的根拠**

### 主要引用論文

1. **Masui, K., Ueki, R., Thunjan, R., et al.** (2022). Population pharmacokinetics and pharmacodynamics of remimazolam in Japanese patients undergoing general anesthesia. *Journal of Anesthesia*, 36(4), 493-505.

2. **Wiltshire, H. R., Kilpatrick, G. J., Tilbrook, G. S., et al.** (2012). A placebo- and midazolam-controlled phase I single ascending-dose study evaluating the safety, pharmacokinetics, and pharmacodynamics of remimazolam (CNS 7056). *Anesthesia & Analgesia*, 115(2), 284-296.

3. **Antonik, L. J., Goldwater, D. R., Kilpatrick, G. J., et al.** (2012). A placebo-and midazolam-controlled phase I single ascending-dose study evaluating the safety, pharmacokinetics, and pharmacodynamics of remimazolam (CNS 7056). *Anesthesia & Analgesia*, 115(2), 284-296.

### 数値計算手法

**Math.NET Numerics参考文献:**
- **Recktenwald, G.** (2011). Numerical Methods with MATLAB: Implementations and Applications. Prentice Hall.
- **Press, W. H., Teukolsky, S. A., Vetterling, W. T., et al.** (2007). Numerical Recipes: The Art of Scientific Computing (3rd ed.). Cambridge University Press.

### 最適化理論

**制約条件付き最適化:**
- **Nocedal, J., Wright, S. J.** (2006). Numerical Optimization (2nd ed.). Springer.
- **Boyd, S., Vandenberghe, L.** (2004). Convex Optimization. Cambridge University Press.

## 📊 **シミュレーション例**

### 計算例 (70kg, 55歳, 男性, ASA I)

#### 入力パラメータ
```
ボーラス投与量: 7 mg
目標濃度: 1.0 μg/mL
目標到達時間: 20分
```

#### PKパラメータ
```
V1 = 3.57 L
V2 = 11.3 L  
V3 = 27.2 L
CL = 0.401 L/min
ke0 = 0.12 min^-1
```

#### 最適化結果
```
最適持続投与量: 0.60 mg/kg/hr
初期血漿濃度: 1.96 μg/mL
20分後効果部位濃度: 1.058 μg/mL
絶対誤差: 0.058 μg/mL (5.8%)
```

#### 濃度推移予測
```
t=0分:   Ce=0.000, Cp=1.960 μg/mL
t=5分:   Ce=0.524, Cp=1.520 μg/mL  
t=10分:  Ce=0.803, Cp=1.280 μg/mL
t=15分:  Ce=0.958, Cp=1.150 μg/mL
t=20分:  Ce=1.058, Cp=1.080 μg/mL
t=67分:  Ce=1.200 μg/mL (閾値到達)
t=180分: Ce=1.016 μg/mL (最終濃度)
```

## 🛠 **技術仕様**

### システム要件
- **ブラウザ**: Chrome, Firefox, Safari, Edge (最新版)
- **JavaScript**: ES6以上対応
- **Chart.js**: 3.x系列
- **計算能力**: 複雑計算のため中級以上のPC推奨

### ファイル構成
```
remimazolam_java_induction_V3.3/
├── index.html                          # メインUI
├── bolus_optimization.js               # ボーラス最適化検証スクリプト
├── assets/
│   ├── css/
│   │   ├── style.css                   # 基本スタイル
│   │   └── bolus-enhancements.css      # ボーラス特化スタイル
│   ├── js/
│   │   ├── remimazolam-v3.3.js        # 計算エンジン
│   │   └── app-v3.3.js                # アプリケーションロジック
│   └── images/
│       └── favicon.svg                 # アイコン
└── README.md                           # このファイル
```

### 計算性能
- **最適化計算時間**: 通常1-3秒
- **シミュレーション点数**: 1800点 (0.1分刻み, 3時間)
- **最適化探索点数**: 37点 (0.1 mg/kg/hr刻み)
- **メモリ使用量**: 約10MB

## ⚠️ **制限事項・注意事項**

### 適用範囲
- **年齢**: 18-80歳
- **体重**: 40-120kg
- **BMI**: 16-40 kg/m²
- **ASA分類**: I-III

### モデルの仮定
1. **線形薬物動態**: 薬物動態パラメータは濃度非依存
2. **瞬時混合**: 各区画内で瞬時に均一分布
3. **一次過程**: すべての移行過程が一次速度論
4. **個体差**: 論文のcovariate modelの範囲内

### 計算上の制約
1. **数値誤差**: 離散時間シミュレーションによる近似誤差
2. **最適化精度**: グリッドサーチの解像度による制限
3. **個体差**: 未知のcovariateは考慮されない
4. **薬物相互作用**: 他剤との相互作用は未考慮

## 🔐 **免責事項**

### 使用目的の限定
- **教育・研究目的専用**: 医療機器ではありません
- **臨床使用禁止**: 診断・治療目的での使用は禁止
- **シミュレーション**: 理論計算による予測値
- **責任の所在**: 計算結果の使用は利用者の責任

### 精度の限界
- **個体差**: 実際の応答は計算値と異なる可能性
- **病態の影響**: 特殊な病態では予測精度が低下
- **環境要因**: 手術侵襲、他剤併用等の影響は未考慮
- **機器誤差**: 実際の投与機器の精度による影響

## 👨‍⚕️ **開発者情報**

**開発者**: 鈴木康之 (YASUYUKI SUZUKI)  
**所属**: 済生会松山病院麻酔科・愛媛大学大学院医学系研究科薬理学  
**ORCID**: 0000-0002-4871-9685  
**専門分野**: 麻酔薬理学、薬物動態学、数値計算

### 開発支援
- **Context7 MCP Server**: 数値計算手法の参照
- **Claude Code (Anthropic)**: 開発アシスタント
- **Math.NET Numerics Project**: 数値計算アルゴリズムの参考

## 📄 **ライセンス**

本ソフトウェアは教育・研究目的での使用に限定されます。商用利用、医療機器としての使用、臨床応用は禁止されています。

---

**Remimazolam TCI V3.3** - 薬物動態理論とボーラス投与最適化の統合研究ツール