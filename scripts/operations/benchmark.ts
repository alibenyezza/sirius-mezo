import { createHash } from "node:crypto";
import { cpus } from "node:os";
import { trainInWorker } from "../../src/lib/tee/bounded-training";
import { validateTrainingDataset } from "../../src/lib/tee/train";
import { selectionForModelId, type ModelId } from "../../src/lib/models/registry";
import { MAX_DATASET_BYTES } from "../../src/lib/tee/contract";

async function main() {
  const results = [];
  for (const [modelId, rows, features] of [
    ["linear_regression", 1000, 4], ["linear_regression", 17000, 31],
    ["logistic_regression", 1000, 4], ["logistic_regression", 3100, 31],
  ] as const satisfies readonly (readonly [ModelId, number, number])[]) {
    let state = 123456789;
    const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
    const header = [...Array.from({ length: features }, (_, i) => `x${i}`), "target"];
    const lines = Array.from({ length: rows }, () => {
      const values = Array.from({ length: features }, () => (random() * 2 - 1).toFixed(2));
      const target = modelId === "logistic_regression" ? Number(Number(values[0]) + Number(values[1]) > 0)
        : (Number(values[0]) * 2 + Number(values[1]) * 3 + random()).toFixed(2);
      return [...values, target].join(",");
    });
    const csv = Buffer.from([header.join(","), ...lines].join("\n"));
    if (csv.length > MAX_DATASET_BYTES) throw new Error("Benchmark hors limite d’ingestion");
    const selection = selectionForModelId(modelId);
    validateTrainingDataset(csv, selection);
    const durations = [];
    for (let sample = 0; sample < 10; sample++) {
      const started = performance.now();
      await trainInWorker(selection, csv, AbortSignal.timeout(30000));
      durations.push(Math.ceil(performance.now() - started));
    }
    durations.sort((a, b) => a - b);
    results.push({ modelId, rows, features, bytes: csv.length, datasetSha256: createHash("sha256").update(csv).digest("hex"),
      samples: durations.length, medianMs: durations[4], p95Ms: durations[9], maximumMs: durations[9] });
  }
  console.log(JSON.stringify({ createdAt: new Date().toISOString(), environment: "local-synthetic", cpu: cpus()[0].model,
    architecture: process.arch, node: process.version, phalaBenchmark: false, includesIpfsOrRpc: false, results }, null, 2));
}

void main().catch(() => { console.error("Benchmark local interrompu ; aucune calibration Phala acquise."); process.exitCode = 1; });
