import { createElement, createStarterDocument, analyzeLayout, findElement, getBoundingBox, normalizeRotation } from './domain';
import { downloadLayoutFile } from './fileTransfer';
import { createPlanId, type LayoutRepository, type PlanSummary } from './repository';
import { parseLayoutFile, type ImportReport } from './transfer';
import type { Analysis, ElementKind, LayoutDocument, LayoutMode, Notice, RenderElement, ViewPhase } from './types';

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
  plans: PlanSummary[];
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
    plans: [],
  };

  constructor(private readonly repository: LayoutRepository) {}

  get state() { return this.stateValue; }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async initialize() {
    try {
      const document = await this.repository.load();
      await this.refreshPlans();
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

  /** 导出当前布局为可回导的 JSON 文件。 */
  exportLayoutFile() {
    try {
      const fileName = downloadLayoutFile(this.stateValue.document);
      this.commit({ notice: { tone: 'success', message: `布局文件「${fileName}」已导出，可通过「导入布局」再次打开` } });
    } catch {
      this.commit({ notice: { tone: 'error', message: '导出失败：浏览器阻止了文件下载，当前布局未受影响' } });
    }
  }

  /** 解析待导入文件并逐项校验；只读操作，绝不改动当前草稿。 */
  inspectImportFile(text: string, fileName: string): ImportReport {
    return parseLayoutFile(text, fileName, this.stateValue.document.field);
  }

  /**
   * 应用已通过校验的导入报告。
   * overwrite：覆盖当前草稿；new-plan：另存为新方案，草稿保持不变。
   * 校验未通过（report.document 为 null）时直接拒绝，现有布局不会被触碰。
   */
  async applyImport(report: ImportReport, mode: 'overwrite' | 'new-plan'): Promise<boolean> {
    const imported = report.document;
    if (!imported) {
      this.commit({ notice: { tone: 'error', message: '导入已取消：文件校验未通过，当前布局保持不变' } });
      return false;
    }
    const warningCount = report.issues.filter((issue) => issue.level !== 'info').length;
    if (mode === 'new-plan') {
      const id = createPlanId();
      await this.repository.savePlan(id, imported);
      await this.refreshPlans();
      this.commit({ notice: { tone: 'success', message: `已另存为新方案「${imported.title}」，当前草稿未改动${warningCount ? `（${warningCount} 项提示）` : ''}` } });
      return true;
    }
    this.commitAndPersist({
      document: imported,
      selectedId: imported.elements[0]?.id ?? null,
      mode: 'edit',
      notice: { tone: warningCount ? 'warning' : 'success', message: `已用「${imported.title}」覆盖当前草稿${warningCount ? `，导入时有 ${warningCount} 项提示，请留意画布标记` : ''}` },
    });
    return true;
  }

  /** 把当前草稿另存为命名方案。 */
  async saveDraftAsPlan() {
    const id = createPlanId();
    try {
      await this.repository.savePlan(id, this.stateValue.document);
      await this.refreshPlans();
      this.commit({ notice: { tone: 'success', message: `当前草稿已另存为方案「${this.stateValue.document.title}」` } });
    } catch {
      this.commit({ notice: { tone: 'error', message: '方案保存失败，当前草稿仍保留在页面中' } });
    }
  }

  async openPlan(id: string) {
    const document = await this.repository.loadPlan(id);
    if (!document) {
      this.commit({ notice: { tone: 'error', message: '该方案无法读取（可能已损坏），当前布局保持不变' } });
      return;
    }
    this.commitAndPersist({ document, selectedId: document.elements[0]?.id ?? null, mode: 'edit', notice: { tone: 'success', message: `已打开方案「${document.title}」` } });
  }

  async deletePlan(id: string) {
    try {
      await this.repository.deletePlan(id);
      await this.refreshPlans();
      this.commit({ notice: { tone: 'info', message: '方案已删除，当前草稿未受影响' } });
    } catch {
      this.commit({ notice: { tone: 'error', message: '方案删除失败' } });
    }
  }

  private async refreshPlans() {
    try {
      this.commit({ plans: await this.repository.listPlans() });
    } catch {
      // 方案列表加载失败不影响主编辑流程。
    }
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
