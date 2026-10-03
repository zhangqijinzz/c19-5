import { useEffect } from 'react';
import type { ImportPreview } from '../../viewModel';

interface ImportDialogProps {
  preview: ImportPreview;
  currentTitle: string;
  onConfirm: (mode: 'replace' | 'duplicate') => void;
  onCancel: () => void;
}

export function ImportDialog({ preview, currentTitle, onConfirm, onCancel }: ImportDialogProps) {
  const { document, errors, warnings, fatal, sourceVersion } = preview;
  const blocked = fatal !== null || errors.length > 0;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
    <div className="modal import-dialog" role="dialog" aria-modal="true" aria-label="导入布局校验结果">
      <header className="modal-head">
        <div><span className="section-kicker">IMPORT LAYOUT</span><h2>导入布局校验</h2><span className="import-file-name">来源文件：{preview.fileName}</span></div>
        <button type="button" className="modal-close" aria-label="关闭" onClick={onCancel}>×</button>
      </header>

      <div className="import-source">
        <div><small>文件内方案</small><strong title={document.title}>{document.title || '未命名方案'}</strong></div>
        <div><small>场地尺寸</small><strong>{document.field.width} × {document.field.height} m</strong></div>
        <div><small>元素数量</small><strong>{document.elements.length} 个</strong></div>
        <div><small>导出版本</small><strong>v{sourceVersion}</strong></div>
      </div>

      {fatal ? <div className="import-blocked">
        <span className="blocked-icon">!</span>
        <div><strong>无法导入此文件</strong><p>{fatal}</p><p className="blocked-sub">当前草稿「{currentTitle}」未做任何改动。</p></div>
      </div> : null}

      {errors.length > 0 ? <section className="import-section">
        <h3 className="issue-heading error">{errors.length} 个阻断问题（必须修复后才能导入）</h3>
        <IssueList issues={errors} />
      </section> : null}

      {warnings.length > 0 ? <section className="import-section">
        <h3 className="issue-heading warning">{warnings.length} 条提醒（仍可导入）</h3>
        <IssueList issues={warnings} />
      </section> : null}

      {!blocked && warnings.length === 0 ? <p className="import-ok">✓ 逐项校验通过：字段完整、类型可识别、元素均在场地范围内。</p> : null}
      {!blocked ? <p className="import-current-note">当前草稿：<strong>{currentTitle}</strong>{warnings.length > 0 ? '，越界或重复 ID 的元素导入后可继续在编辑器中调整。' : ''}</p> : null}

      <footer className="modal-foot">
        <button type="button" className="secondary-button" onClick={onCancel}>{blocked ? '关闭' : '取消'}</button>
        {!blocked ? <>
          <button type="button" className="secondary-button" onClick={() => onConfirm('duplicate')}>另存为新方案</button>
          <button type="button" className="primary-button danger" onClick={() => onConfirm('replace')}>覆盖当前草稿</button>
        </> : null}
      </footer>
    </div>
  </div>;
}

function IssueList({ issues }: { issues: ImportPreview['errors'] }) {
  return <ul className="import-issues">
    {issues.map((issue, index) => <li key={`${issue.code}-${issue.field ?? ''}-${index}`} className={`issue-row ${issue.level}`}>
      <span className="issue-code">{issueLabel(issue.code)}</span>
      <span className="issue-message">{issue.message}</span>
      {issue.field ? <code className="issue-path">{issue.field}</code> : null}
    </li>)}
  </ul>;
}

const issueLabel = (code: string): string => {
  const labels: Record<string, string> = {
    'file-format': '格式',
    'unsupported-version': '版本',
    'missing-field': '缺字段',
    'invalid-value': '值无效',
    'unknown-kind': '未知类型',
    'unknown-field': '未知字段',
    'duplicate-id': '重复 ID',
    'out-of-bounds': '越界',
    'field-resize': '场地变化',
  };
  return labels[code] ?? code;
};
