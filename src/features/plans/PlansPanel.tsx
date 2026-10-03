import type { PlanSummary } from '../../repository';

interface PlansPanelProps {
  plans: PlanSummary[];
  currentTitle: string;
  onSaveDraft: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}

const formatTime = (value: number) =>
  value ? new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';

export function PlansPanel({ plans, currentTitle, onSaveDraft, onOpen, onDelete }: PlansPanelProps) {
  return (
    <section className="panel plans-panel">
      <div className="panel-heading">
        <div><span className="section-kicker">SAVED PLANS</span><h2>方案库</h2></div>
        <span className="count-badge">{plans.length}</span>
      </div>
      <p className="panel-hint">导入文件时可另存为新方案；也可先把当前草稿存档。</p>
      <button type="button" className="save-draft-button" onClick={onSaveDraft}>＋ 保存当前草稿为方案</button>
      {plans.length > 0 ? (
        <ul className="plans-list">
          {plans.map((plan) => (
            <li key={plan.id} className={plan.title === currentTitle ? 'is-current' : ''}>
              <button type="button" className="plan-open" onClick={() => onOpen(plan.id)} title="打开此方案">
                <strong>{plan.title}</strong>
                <small>{plan.field} m · {plan.elementCount} 个元素 · {formatTime(plan.updatedAt)}</small>
                {plan.title === currentTitle ? <em className="plan-current-tag">编辑中</em> : null}
              </button>
              <button type="button" className="plan-delete" aria-label={`删除方案 ${plan.title}`} title="删除此方案"
                onClick={() => { if (window.confirm(`确定删除方案「${plan.title}」吗？当前草稿不会受影响。`)) onDelete(plan.id); }}>⌫</button>
            </li>
          ))}
        </ul>
      ) : <p className="plans-empty">还没有保存过方案</p>}
    </section>
  );
}
