/**
 * Ask DVS tools: role filtering, role re-check on execution, and stripping of
 * personal data before anything reaches the LLM.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/env', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'silent', PERCEPTION_OUTPUT_DIR: 'output' },
}));
vi.mock('../../lib/prismaClient', () => ({ prisma: {} }));
vi.mock('../../logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { ForbiddenError } from '../../errors';
import { InventoryService } from '../../services/inventory.service';
import { SecurityService } from '../../services/security.service';
import { TOOLS, executeTool, toolSpecs, toolsForRole } from '../../assistant/tools';
import { stripSensitive } from '../../assistant/sanitize';

const names = (role: string) => toolsForRole(role).map((tool) => tool.name);
const INCIDENT_TOOLS = ['getOpenIncidents', 'getIncidentSummary'];

describe('toolsForRole', () => {
  it('never offers incident tools to a store user', () => {
    const store = names('STORE');
    for (const tool of INCIDENT_TOOLS) expect(store).not.toContain(tool);
    expect(store).toEqual(
      expect.arrayContaining(['searchMaterials', 'getStockOutForecast', 'getSupplierScorecard']),
    );
  });

  it('follows the API route roles for each module', () => {
    expect(names('PRODUCTION')).toEqual(
      expect.arrayContaining(['getWorkOrders', 'getProductionKpis', ...INCIDENT_TOOLS]),
    );
    expect(names('PRODUCTION')).not.toContain('getStockOutForecast');
    expect(names('HR')).toContain('getAttendanceSummary');
    expect(names('STORE')).not.toContain('getAttendanceSummary');
    expect(names('MANAGER')).toContain('getPlantHealth');
    expect(names('STORE')).not.toContain('getPlantHealth');
    expect(names('ADMIN')).toHaveLength(TOOLS.length);
  });

  it('offers nothing to roles outside the staff portals', () => {
    expect(names('SUPPLIER')).toEqual([]);
    expect(names('CLIENT')).toEqual([]);
    expect(names('PERCEPTION_SERVICE')).toEqual([]);
  });

  it('formats offered tools as chat-completions function specs', () => {
    const [spec] = toolSpecs(toolsForRole('STORE'));
    expect(spec).toMatchObject({ type: 'function', function: { name: expect.any(String) } });
  });
});

describe('executeTool', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('rejects a tool the role may not use, without touching the data', async () => {
    const getAllIncidents = vi.spyOn(SecurityService.prototype, 'getAllIncidents');
    await expect(
      executeTool('getOpenIncidents', {}, { id: 3, email: 'store@test.com', role: 'STORE' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(getAllIncidents).not.toHaveBeenCalled();
  });

  it('rejects an unknown tool name', async () => {
    await expect(
      executeTool('deleteMaterial', { id: 1 }, { id: 1, email: 'a@test.com', role: 'ADMIN' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('runs an allowed tool and returns compact rows', async () => {
    vi.spyOn(InventoryService.prototype, 'getAllMaterials').mockResolvedValue({
      data: [
        {
          id: 7,
          name: 'MS Sheet 2mm',
          code: 'MAT-007',
          description: null,
          unit: 'kg',
          category: null,
          location: 'Rack A',
          currentStock: '120.500',
          minStockLevel: '200',
          maxStockLevel: null,
          costPerUnit: null,
          currency: 'INR',
          isActive: true,
          deletedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          isLowStock: true,
        },
      ],
      total: 1,
    } as never);

    const run = await executeTool(
      'searchMaterials',
      { query: 'sheet' },
      { id: 3, email: 'store@test.com', role: 'STORE' },
    );
    expect(run.module).toBe('Inventory');
    expect(run.result).toEqual({
      matches: 1,
      materials: [
        {
          name: 'MS Sheet 2mm',
          code: 'MAT-007',
          currentStock: 120.5,
          unit: 'kg',
          reorderLevel: 200,
          belowReorderLevel: true,
          location: 'Rack A',
        },
      ],
    });
  });

  it('validates the arguments the LLM sends', async () => {
    await expect(
      executeTool('getProductionKpis', { period: 'year' }, { id: 1, email: 'a@t.com', role: 'ADMIN' }),
    ).rejects.toThrow();
  });
});

describe('stripSensitive', () => {
  it('removes passwords, tokens, emails and phone numbers at any depth', () => {
    const cleaned = stripSensitive({
      name: 'Asha',
      password: 'secret',
      refreshToken: 'abc',
      email: 'asha@dvs.local',
      contact: { phone: '+91 98765 43210', city: 'Pune' },
      rows: [{ userEmail: 'x@y.com', note: 'Call 98765 43210 or mail ops@dvs.local' }],
      when: new Date('2026-10-17T05:30:00Z'),
      date: '2026-10-17',
      quantity: 1250,
    });
    expect(cleaned).toEqual({
      name: 'Asha',
      contact: { city: 'Pune' },
      rows: [{ note: 'Call [hidden] or mail [hidden]' }],
      when: '2026-10-17T05:30:00.000Z',
      date: '2026-10-17',
      quantity: 1250,
    });
  });
});
