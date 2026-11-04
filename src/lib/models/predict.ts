import type { DownloadedModel, HistoricalLinearRegressionModel, LinearRegressionModel, LogisticRegressionModel } from "@/lib/models/registry";

/**
 * Prédiction d'un modèle livré, sans dépendance au navigateur : la page Train l'exécute côté
 * client sur le modèle déchiffré, l'API x402 côté serveur sur le modèle de démonstration.
 */
export type ModelPrediction =
  | { algo: "linear_regression"; value: number }
  | { algo: "logistic_regression"; probability: number; label: 0 | 1 };

export function modelScore(model: DownloadedModel, values: Record<string, number>): number {
  const prediction = model.features.reduce((sum, feature, index) => {
    const value = values[feature];
    if (!Number.isFinite(value)) throw new Error(`Valeur invalide pour « ${feature} »`);
    return sum + value * model.coefficients[index + 1];
  }, model.coefficients[0]);
  if (!Number.isFinite(prediction)) throw new Error("Prédiction numérique instable");
  return prediction;
}

export function sigmoid(value: number): number {
  return value >= 0 ? 1 / (1 + Math.exp(-value)) : Math.exp(value) / (1 + Math.exp(value));
}

export function predictModel(model: LinearRegressionModel | HistoricalLinearRegressionModel, values: Record<string, number>): Extract<ModelPrediction, { algo: "linear_regression" }>;
export function predictModel(model: LogisticRegressionModel, values: Record<string, number>): Extract<ModelPrediction, { algo: "logistic_regression" }>;
export function predictModel(model: DownloadedModel, values: Record<string, number>): ModelPrediction;
export function predictModel(model: DownloadedModel, values: Record<string, number>): ModelPrediction {
  const value = modelScore(model, values);
  if (model.algo === "linear_regression") return { algo: model.algo, value };
  const probability = sigmoid(value);
  return { algo: model.algo, probability, label: probability >= 0.5 ? 1 : 0 };
}
