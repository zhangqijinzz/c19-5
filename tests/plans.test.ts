import { describe, expect, it } from 'vitest';
import type { LayoutDocument } from '../src/types';
import { createPlanId, LocalLayoutRepository } from '../src/repository';
import { BrowserStorageService, PLAN_KEY_PREFIX } from '../src/storageService';

const documentWithTitle = (title: string): LayoutDocument => ({
  version: 1,
  title,
  field: { width: 24, height: 16 },
  elements: [{ id: 'b1', kind: 'booth', name: '展位', x: 1, y: 1, width: 4, height: 3, rotation: 0 }],
});

describe('LocalLayoutRepository saved plans', () => {
  it('saves, lists, opens and deletes named plans independently of the draft', async () => {
    window.localStorage.clear();
    const repository = new LocalLayoutRepository(new BrowserStorageService());

    const id = createPlanId();
    await repository.savePlan(id, documentWithTitle('评审方案 A'));
    const list = await repository.listPlans();
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe('评审方案 A');
    expect(list[0].elementCount).toBe(1);

    const opened = await repository.loadPlan(id);
    expect(opened?.title).toBe('评审方案 A');

    await repository.deletePlan(id);
    expect(await repository.listPlans()).toHaveLength(0);
    expect(await repository.loadPlan(id)).toBeNull();
  });

  it('ignores plan keys that do not hold a valid document', async () => {
    window.localStorage.clear();
    window.localStorage.setItem(PLAN_KEY_PREFIX + 'broken', '{damaged');
    const repository = new LocalLayoutRepository(new BrowserStorageService());
    expect(await repository.listPlans()).toHaveLength(0);
    expect(await repository.loadPlan('broken')).toBeNull();
  });

  it('rejects plan ids outside the safe key pattern', async () => {
    const repository = new LocalLayoutRepository(new BrowserStorageService());
    expect(await repository.loadPlan('../document.v1')).toBeNull();
    await expect(repository.savePlan('../x', documentWithTitle('x'))).rejects.toThrow();
  });
});
