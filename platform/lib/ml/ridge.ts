// ============================================================
// Ridge regression — a small, dependency-free trained model.
//
// This is real supervised learning: given a matrix of feature rows X and a
// target vector y, it fits coefficients that minimise
//     Σ (y − Xβ)²  +  λ‖β‖²
// via the closed-form normal equations (XᵀX + λI)β = Xᵀy, solved with Gaussian
// elimination. Features are standardised (zero mean / unit variance) so the L2
// penalty is applied fairly and the solve stays numerically stable.
//
// It is deliberately tiny (a handful of features, closed-form solve) because the
// training set — a few thousand real posts — is small, and a low-variance model
// generalises better here than a deep/boosted one that would overfit.
// ============================================================

export interface RidgeModel {
  feature_names: string[];
  mean: number[];        // per-feature mean, for standardisation
  std: number[];         // per-feature std  (0 → treated as 1, feature ignored)
  coef: number[];        // learned coefficients in standardised space
  intercept: number;     // = mean(y)
  rmse: number;          // holdout root-mean-squared error, in target units
  r2: number;            // holdout R² (fraction of variance explained)
  n_samples: number;     // rows used to fit the final model
  lambda: number;
}

const EPS = 1e-9;

function mean(v: number[]): number {
  if (v.length === 0) return 0;
  let s = 0;
  for (const x of v) s += x;
  return s / v.length;
}

function std(v: number[], mu: number): number {
  if (v.length < 2) return 0;
  let s = 0;
  for (const x of v) s += (x - mu) ** 2;
  return Math.sqrt(s / (v.length - 1));
}

// Solve A·x = b for a small dense symmetric system via Gaussian elimination
// with partial pivoting. A is k×k (k = number of features), so k is tiny.
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  // Work on augmented copies so callers' arrays are untouched.
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    // Pivot: largest magnitude in this column at/below the diagonal.
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r]![col]!) > Math.abs(M[piv]![col]!)) piv = r;
    }
    if (Math.abs(M[piv]![col]!) < EPS) continue; // singular column → skip (coef stays ~0)
    if (piv !== col) { const tmp = M[piv]!; M[piv] = M[col]!; M[col] = tmp; }
    const pivVal = M[col]![col]!;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r]![col]! / pivVal;
      if (factor === 0) continue;
      for (let c = col; c <= n; c++) M[r]![c]! -= factor * M[col]![c]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    const d = M[i]![i]!;
    x[i] = Math.abs(d) < EPS ? 0 : M[i]![n]! / d;
  }
  return x;
}

// Standardise a raw feature row against a fitted model's mean/std.
function standardiseRow(row: number[], mu: number[], sd: number[]): number[] {
  return row.map((x, j) => {
    const s = sd[j]!;
    return s > EPS ? (x - mu[j]!) / s : 0;
  });
}

// Fit ridge on standardised features. Returns coef (standardised space),
// intercept (= mean y), and the standardisation stats.
function fitStandardised(
  X: number[][], y: number[], lambda: number, featureNames: string[],
): Omit<RidgeModel, 'rmse' | 'r2' | 'n_samples'> {
  const k = featureNames.length;
  const mu = new Array<number>(k);
  const sd = new Array<number>(k);
  for (let j = 0; j < k; j++) {
    const col = X.map((r) => r[j]!);
    mu[j] = mean(col);
    sd[j] = std(col, mu[j]!);
  }
  const yMean = mean(y);
  // Standardised design matrix Z and centred target.
  const Z = X.map((r) => standardiseRow(r, mu, sd));
  const yc = y.map((v) => v - yMean);

  // Normal equations: (ZᵀZ + λI) β = Zᵀ yc.
  const ZtZ: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const Zty = new Array<number>(k).fill(0);
  for (let i = 0; i < Z.length; i++) {
    const zi = Z[i]!;
    const yi = yc[i]!;
    for (let a = 0; a < k; a++) {
      Zty[a]! += zi[a]! * yi;
      for (let b = a; b < k; b++) ZtZ[a]![b]! += zi[a]! * zi[b]!;
    }
  }
  for (let a = 0; a < k; a++) {
    for (let b = a + 1; b < k; b++) ZtZ[b]![a] = ZtZ[a]![b]!; // symmetric
    ZtZ[a]![a]! += lambda; // L2 ridge penalty on the diagonal
  }
  const coef = solve(ZtZ, Zty);
  return { feature_names: featureNames, mean: mu, std: sd, coef, intercept: yMean, lambda };
}

// Predict a single raw feature row from a fitted model (target units).
export function predict(model: RidgeModel, row: number[]): number {
  const z = standardiseRow(row, model.mean, model.std);
  let acc = model.intercept;
  for (let j = 0; j < model.coef.length; j++) acc += model.coef[j]! * z[j]!;
  return acc;
}

// Deterministic split so metrics are reproducible across runs.
function splitIndices(n: number, holdoutFrac: number): { train: number[]; test: number[] } {
  const train: number[] = [];
  const test: number[] = [];
  const step = Math.max(2, Math.round(1 / Math.max(0.05, Math.min(0.5, holdoutFrac))));
  for (let i = 0; i < n; i++) (i % step === 0 ? test : train).push(i);
  return { train, test };
}

/**
 * Fit ridge with an honest holdout evaluation.
 *  1. split rows into train / holdout;
 *  2. fit on train, measure RMSE + R² on the holdout it never saw;
 *  3. refit on ALL rows for the final deployed model, but report the holdout
 *     metrics (which reflect generalisation, not memorisation).
 */
export function trainRidge(
  X: number[][], y: number[], featureNames: string[],
  opts: { lambda?: number; holdoutFrac?: number } = {},
): RidgeModel {
  const lambda = opts.lambda ?? 1.0;
  const n = y.length;
  const { train, test } = splitIndices(n, opts.holdoutFrac ?? 0.2);

  let rmse = 0;
  let r2 = 0;
  if (train.length >= featureNames.length + 2 && test.length >= 1) {
    const trained = fitStandardised(
      train.map((i) => X[i]!), train.map((i) => y[i]!), lambda, featureNames,
    );
    const evalModel: RidgeModel = { ...trained, rmse: 0, r2: 0, n_samples: train.length };
    let sse = 0;
    let sst = 0;
    const yTestMean = mean(test.map((i) => y[i]!));
    for (const i of test) {
      const pred = predict(evalModel, X[i]!);
      sse += (y[i]! - pred) ** 2;
      sst += (y[i]! - yTestMean) ** 2;
    }
    rmse = Math.sqrt(sse / test.length);
    r2 = sst > EPS ? 1 - sse / sst : 0;
  }

  const finalFit = fitStandardised(X, y, lambda, featureNames);
  return { ...finalFit, rmse, r2, n_samples: n };
}
