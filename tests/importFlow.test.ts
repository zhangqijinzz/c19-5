import { describe, expect, it, vi } from 'vitest';
import { createStarterDocument } from '../src/domain';
import type { LayoutRepository } from '../src/repository';
import type { LayoutDocument } from '../src/types';
import { buildLayoutExport } from '../src/transfer';
import { ExpoSketchViewModel } from '../src/viewModel';

const fakeRepository = (initial: LayoutDocument | null = null): LayoutRepository & { saves: LayoutDocument[]; planSaves: Array<{ id: string; document: LayoutDocument }> } => {
  const saves: LayoutDocument[] = [];
  const planSaves: Array<{ id: string; document: LayoutDocument }> = [];
  return {
    saves,
    planSaves,
    load: vi.fn(async () => initial ?? createStarterDocument()),
    save: vi.fn(async (document) => { saves.push(document); }),
    listPlans: vi.fn(async () => []),
    loadPlan: vi.fn(async () => null),
    savePlan: vi.fn(async (id, document) => { planSaves.push({ id, document }); }),
    deletePlan: vi.fn(async () => {}),
  };
};

const exportedFileText = (document: LayoutDocument) => JSON.stringify(buildLayoutExport(document));

describe('ExpoSketchViewModel import flow', () => {
  it('overwrites the draft only after the report passes validation', async () => {
    const repository = fakeRepository();
    const vm = new ExpoSketchViewModel(repository);
    await vm.initialize();
    const beforeTitle = vm.state.document.title;

    const incoming: LayoutDocument = { version: 1, title: '导入方案', field: { width: 22, height: 14 }, elements: [] };
    const report = vm.inspectImportFile(exportedFileText(incoming), 'incoming.json');
    expect(report.ok).toBe(true);
    expect(vm.state.document.title).toBe(beforeTitle);

    const applied = await vm.applyImport(report, 'overwrite');
    expect(applied).toBe(true);
    expect(vm.state.document.title).toBe('导入方案');
    expect(repository.saves[repository.saves.length - 1]?.title).toBe('导入方案');
  });

  it('keeps the current draft untouched when saving an import as a new plan', async () => {
    const repository = fakeRepository();
    const vm = new ExpoSketchViewModel(repository);
    await vm.initialize();
    const snapshot = vm.state.document;

    const incoming: LayoutDocument = { version: 1, title: '另存方案', field: { width: 22, height: 14 }, elements: [] };
    const report = vm.inspectImportFile(exportedFileText(incoming), 'incoming.json');
    const applied = await vm.applyImport(report, 'new-plan');

    expect(applied).toBe(true);
    expect(vm.state.document).toBe(snapshot);
    expect(repository.planSaves).toHaveLength(1);
    expect(repository.planSaves[0].document.title).toBe('另存方案');
    expect(repository.saves.filter((item) => item.title === '另存方案')).toHaveLength(0);
  });

  it('refuses to apply a broken report and never modifies the current layout', async () => {
    const repository = fakeRepository();
    const vm = new ExpoSketchViewModel(repository);
    await vm.initialize();
    const snapshot = vm.state.document;

    const report = vm.inspectImportFile('{broken', 'broken.json');
    expect(report.ok).toBe(false);
    const applied = await vm.applyImport(report, 'overwrite');
    expect(applied).toBe(false);
    expect(vm.state.document).toBe(snapshot);
    expect(vm.state.notice.tone).toBe('error');
  });

  it('still allows importing a valid file that contains out-of-bounds elements', async () => {
    const repository = fakeRepository();
    const vm = new ExpoSketchViewModel(repository);
    await vm.initialize();

    const incoming: LayoutDocument = {
      version: 1, title: '带警告的方案', field: { width: 10, height: 10 },
      elements: [{ id: 'b1', kind: 'booth', name: '出格', x: 8, y: 8, width: 4, height: 4, rotation: 0 }],
    };
    const report = vm.inspectImportFile(exportedFileText(incoming), 'warn.json');
    expect(report.ok).toBe(true);
    expect(report.issues.some((issue) => issue.code === 'out-of-bounds')).toBe(true);
    const applied = await vm.applyImport(report, 'overwrite');
    expect(applied).toBe(true);
    expect(vm.state.document.title).toBe('带警告的方案');
    expect(vm.state.analysis.bounds.length).toBeGreaterThan(0);
  });
});
