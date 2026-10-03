import { describe, expect, it, vi } from 'vitest';
import { createStarterDocument } from '../src/domain';
import type { FilePickerService } from '../src/fileService';
import type { LayoutRepository } from '../src/repository';
import type { LayoutDocument } from '../src/types';
import { ExpoSketchViewModel } from '../src/viewModel';
import { serializeTransferFile } from '../src/transfer';

const fakeRepository = (initial: LayoutDocument | null = null): LayoutRepository => ({
  load: vi.fn(async () => initial ?? createStarterDocument()),
  save: vi.fn(async (_document) => {}),
});

const fakePicker = (text: string | null = null): FilePickerService => ({
  pickLayoutFile: vi.fn(async () => text === null ? null : { name: 'incoming.json', text }),
});

const fakeSideEffects = () => ({
  downloader: vi.fn((_document: LayoutDocument) => {}),
  printer: vi.fn((_document: LayoutDocument) => {}),
});

const validFile = (document: LayoutDocument = createStarterDocument()) => serializeTransferFile(document);

const createViewModel = (repository = fakeRepository(), picker = fakePicker(validFile())) => {
  const effects = fakeSideEffects();
  const vm = new ExpoSketchViewModel(repository, picker, effects.downloader, effects.printer);
  return { vm, ...effects };
};

describe('ExpoSketchViewModel', () => {
  it('initializes and updates the selected layout', async () => {
    const { vm } = createViewModel();
    await vm.initialize();
    expect(vm.state.phase).toBe('ready');
    const count = vm.state.document.elements.length;
    vm.addElement('booth');
    expect(vm.state.document.elements).toHaveLength(count + 1);
    expect(vm.state.selectedId).toContain('booth-');
  });

  it('updates analysis immediately after moving an element into an overlap', () => {
    const { vm } = createViewModel();
    vm.moveElement('stage-1', 4.5, 2.5);
    expect(vm.state.analysis.overlaps.length).toBeGreaterThan(0);
  });

  it('recovers the example if repository loading fails', async () => {
    const repository: LayoutRepository = { load: vi.fn(async () => { throw new Error('bad storage'); }), save: vi.fn(async () => {}) };
    const { vm } = createViewModel(repository);
    await vm.initialize();
    expect(vm.state.phase).toBe('error');
    expect(vm.state.document.title).toContain('春日创意市集');
  });

  it('shows a save error without dropping the working document', async () => {
    const repository: LayoutRepository = { load: vi.fn(async () => createStarterDocument()), save: vi.fn(async () => { throw new Error('quota'); }) };
    const { vm } = createViewModel(repository);
    await vm.initialize();
    vm.addElement('stage');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(vm.state.document.elements.some((element) => element.kind === 'stage' && element.id.startsWith('stage-'))).toBe(true);
    expect(vm.state.notice.tone).toBe('error');
  });

  it('ignores invalid dimensions instead of corrupting the working selection', () => {
    const { vm } = createViewModel();
    const before = vm.state.document.elements[0].width;
    vm.resizeSelected(0, 0);
    expect(vm.state.document.elements[0].width).toBe(before);
  });

  it('exports the current document through the downloader', () => {
    const { vm, downloader } = createViewModel();
    vm.exportLayout();
    expect(downloader).toHaveBeenCalledTimes(1);
    const exported = downloader.mock.calls[0][0];
    expect(exported.title).toBe(createStarterDocument().title);
    expect(vm.state.notice.tone).toBe('success');
  });

  it('sends the current document to the print pipeline', () => {
    const { vm, printer } = createViewModel();
    vm.printLayout();
    expect(printer).toHaveBeenCalledTimes(1);
    expect(printer.mock.calls[0][0].elements.length).toBeGreaterThan(0);
  });

  it('imports a valid file after the user chooses to overwrite the draft', async () => {
    const incoming = { ...createStarterDocument(), title: '秋季新品发布会', field: { width: 40, height: 22 }, elements: [] };
    const { vm } = createViewModel(fakeRepository(), fakePicker(validFile(incoming)));
    await vm.startImport();
    expect(vm.state.importPreview?.fatal).toBeNull();
    expect(vm.state.importPreview?.errors).toHaveLength(0);
    // 确认前草稿保持原样
    expect(vm.state.document.title).toBe(createStarterDocument().title);
    vm.confirmImport('replace');
    expect(vm.state.document.title).toBe('秋季新品发布会');
    expect(vm.state.document.field).toEqual({ width: 40, height: 22 });
    expect(vm.state.importPreview).toBeNull();
  });

  it('imports as a duplicate without touching the original title', async () => {
    const incoming = { ...createStarterDocument(), title: '巡展 B 城站' };
    const { vm } = createViewModel(fakeRepository(), fakePicker(validFile(incoming)));
    await vm.startImport();
    vm.confirmImport('duplicate');
    expect(vm.state.document.title).toContain('巡展 B 城站');
    expect(vm.state.document.title).toContain('导入副本');
  });

  it('lists issues and blocks confirm when the file is broken', async () => {
    const { vm } = createViewModel(fakeRepository(), fakePicker('{not-json'));
    await vm.startImport();
    const preview = vm.state.importPreview;
    expect(preview?.fatal).toBeTruthy();
    const before = vm.state.document;
    vm.confirmImport('replace');
    expect(vm.state.document).toBe(before);
  });

  it('reports missing fields, unknown kinds/fields and overflow item by item', async () => {
    const file = JSON.stringify({
      version: 1,
      title: '问题文件',
      field: { width: 10, height: 10, note: '额外说明' },
      elements: [
        { id: 'ok-1', kind: 'booth', name: '正常展位', x: 1, y: 1, width: 3, height: 2, rotation: 0, tag: 9 },
        { id: 'bad-1', kind: 'ufo', name: '未知类型', x: 1, y: 6, width: 3, height: 2, rotation: 0 },
        { id: 'bad-2', kind: 'booth', x: 0, y: 0, width: 2, height: 2, rotation: 0 },
        { id: 'over-1', kind: 'stage', name: '越界舞台', x: 9, y: 9, width: 3, height: 2, rotation: 0 },
      ],
      coordinator: '小李',
    });
    const { vm } = createViewModel(fakeRepository(), fakePicker(file));
    await vm.startImport();
    const preview = vm.state.importPreview;
    expect(preview).toBeTruthy();
    const codes = preview?.errors.map((issue) => issue.code) ?? [];
    expect(codes).toContain('unknown-kind');
    expect(codes).toContain('missing-field');
    const warnings = preview?.warnings ?? [];
    expect(warnings.some((issue) => issue.code === 'unknown-field' && issue.field === 'coordinator')).toBe(true);
    expect(warnings.some((issue) => issue.code === 'unknown-field' && issue.field?.endsWith('.tag'))).toBe(true);
    expect(warnings.some((issue) => issue.code === 'out-of-bounds')).toBe(true);
    expect(preview?.errors.length).toBeGreaterThan(0);
    // 存在阻断错误时无法确认导入
    const before = vm.state.document;
    vm.confirmImport('replace');
    expect(vm.state.document).toBe(before);
    expect(vm.state.importPreview).not.toBeNull();
  });

  it('keeps the working draft untouched when the user cancels import', async () => {
    const incoming = { ...createStarterDocument(), title: '临时方案' };
    const { vm } = createViewModel(fakeRepository(), fakePicker(validFile(incoming)));
    await vm.startImport();
    vm.cancelImport();
    expect(vm.state.importPreview).toBeNull();
    expect(vm.state.document.title).toBe(createStarterDocument().title);
  });

  it('does nothing when the file picker is cancelled', async () => {
    const { vm } = createViewModel(fakeRepository(), fakePicker(null));
    await vm.startImport();
    expect(vm.state.importPreview).toBeNull();
  });
});
