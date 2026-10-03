import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnalysisPanel } from './features/analysis-preview/AnalysisPanel';
import { StatusBar } from './features/analysis-preview/StatusBar';
import { ElementPalette } from './features/element-library/ElementPalette';
import { FieldSettingsPanel } from './features/field-setup/FieldSettingsPanel';
import { ImportDialog } from './features/import/ImportDialog';
import { FieldCanvas } from './features/layout-editor/FieldCanvas';
import { InspectorPanel } from './features/layout-editor/InspectorPanel';
import { PlansPanel } from './features/plans/PlansPanel';
import { PrintSheet } from './features/print/PrintSheet';
import { pickLayoutFile } from './fileTransfer';
import { useExpoSketchViewModel } from './hooks/useExpoSketchViewModel';
import type { ImportReport } from './transfer';

function App() {
  const { state, vm } = useExpoSketchViewModel();
  const [projectTitle, setProjectTitle] = useState('');
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [importReport, setImportReport] = useState<ImportReport | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!exportMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setExportMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [exportMenuOpen]);

  useEffect(() => {
    if (!printing) return;
    document.body.classList.add('print-mode');
    // 用户在系统打印对话框中点取消时，保持预览；已打印也不自动关闭，方便再印一份。
    return () => document.body.classList.remove('print-mode');
  }, [printing]);

  if (state.phase === 'loading') return <div className="loading-screen"><div className="loading-mark">✦</div><strong>正在打开 ExpoSketch</strong><span>恢复最近一次场地布局…</span></div>;

  const handleImportClick = async () => {
    setExportMenuOpen(false);
    setImportError(null);
    const picked = await pickLayoutFile();
    if (!picked) return;
    if (!picked.text) {
      setImportReport(null);
      setImportError(`文件「${picked.name}」读取失败，当前布局未受影响`);
      return;
    }
    setImportReport(vm.inspectImportFile(picked.text, picked.name));
  };

  const applyImport = async (mode: 'overwrite' | 'new-plan') => {
    if (!importReport) return;
    setImportBusy(true);
    try {
      const applied = await vm.applyImport(importReport, mode);
      if (applied) setImportReport(null);
    } finally {
      setImportBusy(false);
    }
  };

  const handlePrint = () => {
    setExportMenuOpen(false);
    setPrinting(true);
  };

  const sendPrint = () => {
    // 等待 print-mode 类应用到 body 后再唤起打印对话框。
    window.setTimeout(() => window.print(), 30);
  };

  return <div className="app-shell">
    <aside className="left-rail">
      <div className="brand"><div className="brand-mark">✦</div><div><strong>ExpoSketch</strong><span>SPACE PLANNER</span></div></div>
      <div className="project-heading"><span className="section-kicker">CURRENT PROJECT</span><input aria-label="项目名称" value={projectTitle || state.document.title} onChange={(event) => setProjectTitle(event.target.value)} onBlur={() => { if (projectTitle.trim()) { vm.renameProject(projectTitle); setProjectTitle(''); } }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></div>
      <div className="rail-divider" />
      <ElementPalette onAdd={vm.addElement.bind(vm)} />
      <PlansPanel plans={state.plans} currentTitle={state.document.title} onSaveDraft={() => void vm.saveDraftAsPlan()} onOpen={(id) => void vm.openPlan(id)} onDelete={(id) => void vm.deletePlan(id)} />
      <div className="tips-card"><span className="tips-icon">⌘</span><div><strong>快速提示</strong><p>拖动元素调整位置<br />检查模式查看通行风险</p></div></div>
      <div className="rail-footer"><span className="online-dot" />本地工作区 <span className="version">v0.1</span></div>
    </aside>
    <main className="main-stage">
      <header className="topbar"><div className="breadcrumb"><span>我的项目</span><b>/</b><strong>{state.document.title}</strong></div><div className="top-actions"><span className="autosave-label"><i /> 自动保存已开启</span><div className="export-menu" ref={menuRef}><button type="button" className="share-button" aria-haspopup="menu" aria-expanded={exportMenuOpen} onClick={() => setExportMenuOpen((open) => !open)}>导入 / 导出 <span>↗</span></button>{exportMenuOpen ? <div className="export-dropdown" role="menu">
        <button type="button" role="menuitem" onClick={() => { setExportMenuOpen(false); vm.exportLayoutFile(); }}><span className="menu-icon">⇩</span><span className="menu-copy"><strong>导出布局文件</strong><small>导出 .json，可再次导入恢复</small></span></button>
        <button type="button" role="menuitem" onClick={() => void handleImportClick()}><span className="menu-icon">⇧</span><span className="menu-copy"><strong>导入布局</strong><small>校验字段与越界后覆盖或另存</small></span></button>
        <button type="button" role="menuitem" onClick={handlePrint}><span className="menu-icon">🖨</span><span className="menu-copy"><strong>打印图纸</strong><small>A4 横版，含图例与问题摘要</small></span></button>
      </div> : null}</div><button type="button" className="avatar-button">Z</button></div></header>
      <div className="workspace-heading"><div><span className="section-kicker">LAYOUT EDITOR / A-01</span><h1>场地布局编辑器</h1><p>用拖放方式规划区域，保持主要通道畅通。</p></div><div className="heading-stats"><div><strong>{state.document.elements.length}</strong><span>元素</span></div><div><strong>{state.document.field.width}×{state.document.field.height}</strong><span>场地尺寸</span></div></div></div>
      <div className="editor-grid">
        <section className="canvas-panel"><div className="canvas-toolbar"><div className="toolbar-title"><span className="tool-grid">▦</span><div><strong>展厅平面图</strong><small>比例 1 : 100 · 单位：米</small></div></div><div className="toolbar-actions"><span className="zoom-label">⌕ 100%</span><button type="button" aria-label="更多布局选项">•••</button></div></div><FieldCanvas field={state.document.field} elements={state.renderElements} selectedId={state.selectedId} mode={state.mode} overlaps={state.analysis.overlaps} bounds={state.analysis.bounds} channels={state.analysis.channels} path={state.analysis.path} onSelect={vm.selectElement.bind(vm)} onMove={vm.moveElement.bind(vm)} /></section>
        <aside className="inspector"><InspectorPanel selectedElement={state.selectedElement} onRename={vm.renameSelected.bind(vm)} onResize={vm.resizeSelected.bind(vm)} onRotate={vm.rotateSelected.bind(vm)} onDelete={vm.removeSelected.bind(vm)} /><FieldSettingsPanel document={state.document} onResizeField={vm.resizeField.bind(vm)} onReset={vm.resetExample.bind(vm)} /></aside>
      </div>
      <AnalysisPanel analysis={state.analysis} mode={state.mode} elementCount={state.document.elements.length} />
      <StatusBar mode={state.mode} analysis={state.analysis} notice={state.notice} elementCount={state.document.elements.length} lastSavedAt={state.lastSavedAt} onModeChange={vm.setMode.bind(vm)} />
    </main>
    {importError && !importReport ? (
      <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setImportError(null); }}>
        <div className="modal-card mini-error" role="alertdialog" aria-label="导入失败">
          <h2>无法读取文件</h2>
          <p>{importError}</p>
          <footer className="modal-footer"><button type="button" className="primary-button" onClick={() => setImportError(null)}>关闭</button></footer>
        </div>
      </div>
    ) : null}
    {importReport ? <ImportDialog report={importReport} busy={importBusy} onOverwrite={() => void applyImport('overwrite')} onSaveAsNew={() => void applyImport('new-plan')} onClose={() => { if (!importBusy) setImportReport(null); }} /> : null}
    {printing ? createPortal(
      <div className="print-overlay">
        <div className="print-toolbar">
          <strong>打印预览</strong>
          <span>A4 横版 · {state.document.title}</span>
          <div>
            <button type="button" className="secondary-button" onClick={() => setPrinting(false)}>返回编辑</button>
            <button type="button" className="primary-button" onClick={sendPrint}>🖨 打印 / 另存为 PDF</button>
          </div>
        </div>
        <div className="print-scroll">
          <PrintSheet document={state.document} analysis={state.analysis} printedAt={Date.now()} />
        </div>
      </div>,
      document.body,
    ) : null}
  </div>;
}

export default App;
