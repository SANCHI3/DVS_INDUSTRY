import type { Request, Response } from 'express';
import { AnalyticsService } from '../services/analytics.service';
import { sendSuccess } from '../utils/response';
import type {
  AnalyticsQueryInput,
  ProductionAnalyticsQueryInput,
  SupplierScorecardQueryInput,
} from '../validators/analytics.validator';

const svc = new AnalyticsService();

export async function getInventoryIntelligence(req: Request, res: Response): Promise<void> {
  const q = req.query as unknown as AnalyticsQueryInput;
  sendSuccess(res, await svc.getInventoryIntelligence(q), 200, 'Inventory intelligence generated');
}

export async function getMaterialForecast(req: Request, res: Response): Promise<void> {
  const q = req.query as unknown as AnalyticsQueryInput;
  const materialId = Number(req.params['materialId']);
  sendSuccess(
    res,
    await svc.getMaterialForecast(materialId, q),
    200,
    'Material forecast generated',
  );
}

export async function getProductionPerformance(req: Request, res: Response): Promise<void> {
  const q = req.query as unknown as ProductionAnalyticsQueryInput;
  sendSuccess(
    res,
    await svc.getProductionPerformance(q.historyDays, q.department),
    200,
    'Production performance generated',
  );
}

export async function getSupplierScorecard(req: Request, res: Response): Promise<void> {
  const q = req.query as unknown as SupplierScorecardQueryInput;
  sendSuccess(
    res,
    await svc.getSupplierScorecard(q.historyDays),
    200,
    'Supplier scorecard generated',
  );
}

export async function getPlantHealth(req: Request, res: Response): Promise<void> {
  const q = req.query as unknown as AnalyticsQueryInput;
  sendSuccess(res, await svc.getPlantHealth(q), 200, 'Plant health index generated');
}
