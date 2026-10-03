import type { ImportReport } from '../../transfer';

interface ImportDialogProps {
  report: ImportReport;
  busy: boolean;
  onOverwrite: () => void;
  onSaveAsNew: () => void;
  onClose: () => void;
}

const LEVEL_LABEL = { error: '无法导入', warning: '需要注意', info: '自动处理' } as const;

const formatDateTime = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
};

export function ImportDialog({ report, busy, onOverwrite, onSaveAsNew, onClose }: ImportDialogProps) {
  const errors = report.issues.filter((issue) => issue.level === 'error');
  const warnings = report.issues.filter((issue) => issue.level === 'warning');
  const infos = report.issues.filter((issue) => issue.level === 'info');
  const groups = [
    { level: 'error' as const, items: errors },
    { level: 'warning' as const, items: warnings },
    { level: 'info' as const, items: infos },
  ].filter((group) => group.items.length > 0);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div className="modal-card import-dialog" role="dialog" aria-modal="true" aria-label="导入布局校验结果">
        <header className="modal-header">
          <div>
            <span className="section-kicker">IMPORT LAYOUT</span>
            <h2>导入校验结果</h2>
          </div>
          <button type="button" className="modal-close" aria-label="关闭" onClick={onClose} disabled={busy}>×</button>
        </header>

        <div className={`import-verdict ${report.ok ? (warnings.length ? 'has-warnings' : 'clean') : 'has-errors'}`}>
          <strong>{report.ok ? (warnings.length ? '校验通过，但有需要留意的内容' : '校验通过，可以导入') : '校验未通过，无法导入此文件'}</strong>
          <span>{report.fileName} · {report.sourceLabel}{report.exportedAt ? ` · 导出于 ${formatDateTime(report.exportedAt)}` : ''}</span>
          <span>方案：{report.title ?? '—'} ｜ 场地：{report.field ? `${report.field.width} × ${report.field.height} m` : '—'} ｜ 元素：{report.elementCount} 个</span>
        </div>

        {groups.length === 0 ? <p className="import-no-issues">未发现任何问题：字段完整，所有元素均在场地范围内。</p> : (
          <div className="import-issue-groups">
            {groups.map((group) => (
              <section key={group.level} className={`issue-group issue-group-${group.level}`}>
                <h3><i />{LEVEL_LABEL[group.level]}<b>{group.items.length}</b></h3>
                <ul>
                  {group.items.map((issue, index) => (
                    <li key={`${group.level}-${index}`}>
                      <span className="issue-target">{issue.target}</span>
                      <span className="issue-message">{issue.message}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        {report.ok ? (
          <>
            <p className="import-choice-hint">请选择导入方式：覆盖会替换当前编辑中的草稿（仍可自动保存）；另存为新方案不会改动当前草稿。</p>
            <footer className="modal-footer">
              <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>取消</button>
              <button type="button" className="secondary-button" onClick={onSaveAsNew} disabled={busy}>{busy ? '处理中…' : '另存为新方案'}</button>
              <button type="button" className="primary-button" onClick={onOverwrite} disabled={busy}>{busy ? '处理中…' : '覆盖当前草稿'}</button>
            </footer>
          </>
        ) : (
          <footer className="modal-footer">
            <span className="import-blocked-note">请修正文件中的 {errors.length} 项错误后重新选择；当前布局未做任何改动。</span>
            <button type="button" className="primary-button" onClick={onClose} disabled={busy}>我知道了</button>
          </footer>
        )}
      </div>
    </div>
  );
}
