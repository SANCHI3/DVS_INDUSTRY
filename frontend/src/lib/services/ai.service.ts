import api, { unwrap } from '../api';

/** One row of docs/results/model_results.json (perception-service/evaluation/run_all.py). */
export interface ModelResultRow {
  task: string;
  model: string;
  role: 'final' | 'baseline' | 'alternative';
  protocol: string;
  test_size: number | null;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  auc: number | null;
  false_alarms: number | null;
  tp: number | null;
  fp: number | null;
  fn: number | null;
  tn: number | null;
  source: string;
  note: string;
}

export interface BenchmarkRun {
  device: string;
  cycles_per_s: number;
  pipeline_capacity_fps: number;
  stages: Record<string, { mean_ms_per_cycle: number }>;
}

export interface ModelResults {
  models: {
    generated_at: string;
    rows: ModelResultRow[];
    comparisons: { task: string; baseline: string; final: string }[];
  } | null;
  benchmark: {
    run_at: string;
    detection_fps: number;
    hardware: Record<string, string>;
    runs: Record<string, BenchmarkRun>;
  } | null;
  falseAlarms: {
    footage_minutes: number;
    video: string;
    before: { dashboard: Record<string, number> } | null;
    after: { dashboard: Record<string, number> };
  } | null;
}

export async function getModelResults(): Promise<ModelResults> {
  return unwrap(await api.get('/ai/models'));
}
