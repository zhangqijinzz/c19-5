import { createElement, createStarterDocument, analyzeLayout, findElement, getBoundingBox, normalizeRotation } from './domain';
import type { LayoutRepository } from './repository';
import type { FilePickerService } from './fileService';
import { parseTransferFile } from './transfer';
import type { ParsedTransfer, TransferIssue } from './transfer';
import type { Analysis, ElementKind, LayoutDocument, LayoutMode, Notice, RenderElement, ViewPhase } from './types';

export interface ImportPreview {
  document: LayoutDocument;
  sourceVersion: number;
  fileName: string;
  errors: TransferIssue[];
  warnings: TransferIssue[];
  fatal: string | null;
}

export interface ExpoSketchState {
  phase: ViewPhase;
  document: LayoutDocument;
  renderElements: RenderElement[];
  selectedId: string | null;
  selectedElement: RenderElement | null;
  mode: LayoutMode;
  analysis: Analysis;
  notice: Notice;
  lastSavedAt: number | null;
  importPreview: ImportPreview | null;
}

const toRenderElements = (document: LayoutDocument): RenderElement[] => document.elements.map((element) => {
  const box = getBoundingBox(element);
  return { ...element, displayWidth: box.width, displayHeight: box.height, occupiedArea: Number((box.width * box.height).toFixed(1)) };
});

const starter = createStarterDocument();
const starterRenderElements = toRenderElements(starter);

type Listener = () => void;

export class ExpoSketchViewModel {
  private listeners = new Set<Listener>();
  private stateValue: ExpoSketchState = {
    phase: 'loading',
    document: starter,
    renderElements: starterRenderElements,
    selectedId: 'stage-1',
    selectedElement: starterRenderElements.find((element) => element.id === 'stage-1') ?? null,
    mode: 'edit',
    analysis: analyzeLayout(createStarterDocument()),
    notice: { tone: 'info', message: '正在恢复最近布局…' },
    lastSavedAt: null,
    importPreview: null,
  };

  constructor(
    private readonly repository: LayoutRepository,
    private readonly filePicker: FilePickerService,
    private readonly downloader: (document: LayoutDocument) => void,
    private readonly printer: (document: LayoutDocument) => void,
  ) {}

  get state() { return this.stateValue; }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async initialize() {
    try {
      const document = await this.repository.load();
      this.commit({ document, selectedId: document.elements[0]?.id ?? null, phase: 'ready', notice: { tone: 'success', message: '布局已就绪，可开始编辑' } });
    } catch {
      this.commit({ phase: 'error', notice: { tone: 'error', message: '布局读取失败，已载入安全示例' } });
    }
  }

  selectElement(id: string) { this.commit({ selectedId: id }); }

  setMode(mode: LayoutMode) { this.commit({ mode, notice: { tone: 'info', message: mode === 'inspect' ? '检查模式已开启：拖动元素查看即时提示' : mode === 'path' ? '路径模式已开启：入口到重点区域的访问路线已生成' : '编辑模式已开启' } }); }

  addElement(kind: ElementKind) {
    const element = createElement(kind, this.stateValue.document.elements.length, this.stateValue.document.field);
    const document = { ...this.stateValue.document, elements: [...this.stateValue.document.elements, element] };
    this.commitAndPersist({ document, selectedId: element.id, notice: { tone: 'success', message: `${element.name} 已加入场地` } });
  }

  removeSelected() {
    if (!this.stateValue.selectedId) return;
    const removed = findElement(this.stateValue.document, this.stateValue.selectedId);
    const elements = this.stateValue.document.elements.filter((element) => element.id !== this.stateValue.selectedId);
    this.commitAndPersist({ document: { ...this.stateValue.document, elements }, selectedId: elements[0]?.id ?? null, notice: { tone: 'info', message: `${removed?.name ?? '元素'} 已移除` } });
  }

  moveElement(id: string, x: number, y: number) {
    const elements = this.stateValue.document.elements.map((element) => element.id === id ? { ...element, x: Number(x.toFixed(1)), y: Number(y.toFixed(1)) } : element);
    this.commitAndPersist({ document: { ...this.stateValue.document, elements } });
  }

  resizeSelected(width: number, height: number) {
    const id = this.stateValue.selectedId;
    if (!id || width <= 0 || height <= 0) return;
    const elements = this.stateValue.document.elements.map((element) => element.id === id ? { ...element, width: Number(width.toFixed(1)), height: Number(height.toFixed(1)) } : element);
    this.commitAndPersist({ document: { ...this.stateValue.document, elements } });
  }

  rotateSelected() {
    const id = this.stateValue.selectedId;
    if (!id) return;
    const elements = this.stateValue.document.elements.map((element) => element.id === id ? { ...element, rotation: normalizeRotation(element.rotation + 90) } : element);
    this.commitAndPersist({ document: { ...this.stateValue.document, elements }, notice: { tone: 'info', message: '方向已旋转 90°' } });
  }

  renameSelected(name: string) {
    const id = this.stateValue.selectedId;
    if (!id || !name.trim()) return;
    const elements = this.stateValue.document.elements.map((element) => element.id === id ? { ...element, name: name.trim() } : element);
    this.commitAndPersist({ document: { ...this.stateValue.document, elements } });
  }

  resizeField(width: number, height: number) {
    if (width < 12 || height < 10) return;
    this.commitAndPersist({ document: { ...this.stateValue.document, field: { width: Number(width.toFixed(1)), height: Number(height.toFixed(1)) } }, notice: { tone: 'success', message: '场地尺寸已更新' } });
  }

  renameProject(title: string) {
    if (!title.trim()) return;
    this.commitAndPersist({ document: { ...this.stateValue.document, title: title.trim() } });
  }

  resetExample() {
    const document = createStarterDocument();
    this.commitAndPersist({ document, selectedId: 'stage-1', mode: 'edit', notice: { tone: 'success', message: '已恢复示例布局' } });
  }

  exportLayout() {
    try {
      this.downloader(this.stateValue.document);
      this.commit({ notice: { tone: 'success', message: '布局文件已导出，可随时重新导入' } });
    } catch {
      this.commit({ notice: { tone: 'error', message: '导出失败，请稍后重试或使用打印图纸功能' } });
    }
  }

  printLayout() {
    try {
      this.printer(this.stateValue.document);
      this.commit({ notice: { tone: 'info', message: '正在准备打印图纸…' } });
    } catch {
      this.commit({ notice: { tone: 'error', message: '打印图纸生成失败，请稍后重试' } });
    }
  }

  async startImport() {
    let picked: { name: string; text: string } | null;
    try {
      picked = await this.filePicker.pickLayoutFile();
    } catch {
      this.commit({ notice: { tone: 'error', message: '读取所选文件失败，请重新选择' } });
      return;
    }
    if (picked === null) return; // 用户取消了文件选择

    // 先在局部变量里完成全部解析与校验，任何异常都不触碰当前草稿
    let parsed: ParsedTransfer;
    try {
      parsed = parseTransferFile(picked.text, this.stateValue.document.field);
    } catch {
      this.commit({ notice: { tone: 'error', message: '文件解析失败，当前布局未做任何改动' } });
      return;
    }

    const fileName = picked.name;
    if (parsed.fatal) {
      this.commit({
        importPreview: { document: parsed.document, sourceVersion: parsed.sourceVersion, fileName, errors: parsed.issues, warnings: [], fatal: parsed.fatal },
        notice: { tone: 'error', message: '导入文件无法识别，当前布局保持不变' },
      });
      return;
    }

    const errors = parsed.issues.filter((issue) => issue.level === 'error');
    const warnings = parsed.issues.filter((issue) => issue.level === 'warning');
    this.commit({
      importPreview: { document: parsed.document, sourceVersion: parsed.sourceVersion, fileName, errors, warnings, fatal: null },
      notice: errors.length
        ? { tone: 'warning', message: `文件中发现 ${errors.length} 个阻断问题，请先核对` }
        : warnings.length
          ? { tone: 'info', message: `校验完成：${warnings.length} 条提醒，可选择导入方式` }
          : { tone: 'success', message: '文件校验通过，请选择导入方式' },
    });
  }

  cancelImport() {
    if (!this.stateValue.importPreview) return;
    this.commit({ importPreview: null, notice: { tone: 'info', message: '已取消导入，当前布局保持不变' } });
  }

  confirmImport(mode: 'replace' | 'duplicate') {
    const preview = this.stateValue.importPreview;
    if (!preview || preview.fatal || preview.errors.length > 0) return;

    const base = preview.document;
    const document: LayoutDocument = mode === 'duplicate'
      ? { ...base, title: uniqueCopyTitle(base.title) }
      : base;

    this.commitAndPersist({
      document,
      selectedId: document.elements[0]?.id ?? null,
      mode: 'edit',
      importPreview: null,
      notice: mode === 'replace'
        ? { tone: 'success', message: `已用「${document.title}」覆盖当前草稿` }
        : { tone: 'success', message: `已另存为新方案「${document.title}」` },
    });
  }

  private commitAndPersist(patch: Partial<ExpoSketchState>) {
    this.commit(patch);
    void this.persist();
  }

  private async persist() {
    try {
      await this.repository.save(this.stateValue.document);
      this.commit({ lastSavedAt: Date.now() });
    } catch {
      this.commit({ notice: { tone: 'error', message: '本地保存失败，当前编辑仍保留在页面中' } });
    }
  }

  private commit(patch: Partial<ExpoSketchState>) {
    const next = { ...this.stateValue, ...patch };
    const renderElements = toRenderElements(next.document);
    this.stateValue = { ...next, renderElements, selectedElement: renderElements.find((element) => element.id === next.selectedId) ?? null, analysis: analyzeLayout(next.document) };
    this.listeners.forEach((listener) => listener());
  }
}

const uniqueCopyTitle = (title: string): string => {
  const base = title.replace(/（导入副本\s*\d*）$/, '').trim();
  return `${base}（导入副本）`;
};
