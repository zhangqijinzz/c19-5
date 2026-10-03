import { createStarterDocument } from './domain';
import type { DocumentStorageService } from './storageService';
import type { ExpoElement, LayoutDocument } from './types';

export interface PlanSummary {
  id: string;
  title: string;
  field: string;
  elementCount: number;
  updatedAt: number;
}

export interface LayoutRepository {
  load(): Promise<LayoutDocument>;
  save(document: LayoutDocument): Promise<void>;
  listPlans(): Promise<PlanSummary[]>;
  loadPlan(id: string): Promise<LayoutDocument | null>;
  savePlan(id: string, document: LayoutDocument): Promise<void>;
  deletePlan(id: string): Promise<void>;
}

const isElement = (value: unknown): value is ExpoElement => {
  if (!value || typeof value !== 'object') return false;
  const element = value as Record<string, unknown>;
  return typeof element.id === 'string' && typeof element.kind === 'string' && typeof element.x === 'number' && typeof element.y === 'number' && typeof element.width === 'number' && typeof element.height === 'number' && typeof element.rotation === 'number';
};

const isDocument = (value: unknown): value is LayoutDocument => {
  if (!value || typeof value !== 'object') return false;
  const document = value as Record<string, unknown>;
  const field = document.field as Record<string, unknown> | undefined;
  return document.version === 1 && typeof document.title === 'string' && !!field && typeof field.width === 'number' && typeof field.height === 'number' && Array.isArray(document.elements) && document.elements.every(isElement);
};

const toSummary = (id: string, document: LayoutDocument): PlanSummary => ({
  id,
  title: document.title,
  field: `${document.field.width}×${document.field.height}`,
  elementCount: document.elements.length,
  // 方案 ID 自带保存时间戳，列表可直接据此排序，无需额外交钥匙。
  updatedAt: Number(id.split('_').pop()) || 0,
});

export class LocalLayoutRepository implements LayoutRepository {
  constructor(private readonly storage: DocumentStorageService) {}

  async load(): Promise<LayoutDocument> {
    try {
      const saved = await this.storage.read();
      return isDocument(saved) ? saved : createStarterDocument();
    } catch {
      return createStarterDocument();
    }
  }

  async save(document: LayoutDocument): Promise<void> {
    await this.storage.write(document);
  }

  async listPlans(): Promise<PlanSummary[]> {
    const ids = await this.storage.listPlans();
    const summaries = await Promise.all(ids.map(async (id) => {
      try {
        const document = await this.storage.readPlan(id);
        return document && isDocument(document) ? toSummary(id, document) : null;
      } catch {
        return null;
      }
    }));
    return summaries
      .filter((summary): summary is PlanSummary => summary !== null)
      .sort((first, second) => second.updatedAt - first.updatedAt);
  }

  async loadPlan(id: string): Promise<LayoutDocument | null> {
    if (!/^[\w-]+$/.test(id)) return null;
    const document = await this.storage.readPlan(id);
    return isDocument(document) ? document : null;
  }

  async savePlan(id: string, document: LayoutDocument): Promise<void> {
    if (!/^[\w-]+$/.test(id)) throw new Error('无效的方案 ID');
    await this.storage.writePlan(id, document);
  }

  async deletePlan(id: string): Promise<void> {
    if (!/^[\w-]+$/.test(id)) return;
    await this.storage.deletePlan(id);
  }
}

export const createPlanId = () => `plan_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
