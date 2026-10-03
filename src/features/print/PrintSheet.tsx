import { ELEMENT_SPECS, getBoundingBox, MIN_CHANNEL } from '../../domain';
import type { Analysis, ExpoElement, LayoutDocument } from '../../types';

interface PrintSheetProps {
  document: LayoutDocument;
  analysis: Analysis;
  printedAt: number;
}

const KIND_ORDER = ['booth', 'stage', 'seating', 'entrance'] as const;

const formatDateTime = (value: number) =>
  new Date(value).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

function PlanSvg({ document, analysis }: { document: LayoutDocument; analysis: Analysis }) {
  const { field, elements } = document;
  const boundsIds = new Set(analysis.bounds.map((item) => item.elementId));
  const overlapIds = new Set(analysis.overlaps.flatMap((item) => [item.firstId, item.secondId]));
  // 网格按 5m 或 2m 取整，保证图纸刻度清晰。
  const gridStep = field.width >= 20 ? 5 : 2;

  const renderElement = (element: ExpoElement) => {
    const spec = ELEMENT_SPECS[element.kind];
    const out = boundsIds.has(element.id);
    const overlap = overlapIds.has(element.id);
    const stroke = out ? '#d64f3d' : overlap ? '#e86b58' : '#8aa0b4';
    // SVG 以左上角为旋转中心，与领域分析的包围盒口径保持一致。
    return (
      <g key={element.id} transform={`rotate(${element.rotation} ${element.x} ${element.y})`}>
        <rect x={element.x} y={element.y} width={element.width} height={element.height} rx={0.12}
          fill={spec.color} stroke={stroke} strokeWidth={out ? 0.12 : 0.07}
          strokeDasharray={out ? '0.35 0.22' : undefined} />
        <text x={element.x + 0.28} y={element.y + Math.min(0.9, element.height / 2)} fontSize={0.62} fill="#5b7185">{spec.icon}</text>
        <text x={element.x + 0.28} y={element.y + Math.min(1.65, element.height / 2 + 0.75)} fontSize={0.58} fontWeight={600} fill="#2f4356">{element.name}</text>
        {element.height >= 2.2
          ? <text x={element.x + 0.28} y={element.y + element.height - 0.32} fontSize={0.42} fill="#7d90a2">{element.width}×{element.height} m</text>
          : null}
      </g>
    );
  };

  return (
    <svg className="print-plan-svg" viewBox={`-1 -1 ${field.width + 2} ${field.height + 2}`} preserveAspectRatio="xMidYMid meet">
      <defs>
        <pattern id="print-grid" width={gridStep} height={gridStep} patternUnits="userSpaceOnUse">
          <path d={`M ${gridStep} 0 L 0 0 0 ${gridStep}`} fill="none" stroke="#e7edf3" strokeWidth={0.05} />
        </pattern>
      </defs>
      <rect x={0} y={0} width={field.width} height={field.height} fill="url(#print-grid)" stroke="#7d8fa1" strokeWidth={0.14} />
      {Array.from({ length: Math.floor(field.width / gridStep) }, (_, index) => (
        <text key={`gx-${index}`} x={(index + 1) * gridStep} y={field.height + 0.72} fontSize={0.5} fill="#93a2b1" textAnchor="middle">{(index + 1) * gridStep}m</text>
      ))}
      {Array.from({ length: Math.floor(field.height / gridStep) }, (_, index) => (
        <text key={`gy-${index}`} x={-0.35} y={field.height - (index + 1) * gridStep + 0.18} fontSize={0.5} fill="#93a2b1" textAnchor="end">{(index + 1) * gridStep}m</text>
      ))}
      {analysis.path ? (
        <polyline points={analysis.path.points.map((point) => `${point.x},${point.y}`).join(' ')}
          fill="none" stroke="#ef795f" strokeWidth={0.18} strokeDasharray="0.6 0.4" />
      ) : null}
      {elements.map(renderElement)}
      {/* 越界元素的实际包围盒标记 */}
      {analysis.bounds.map((issue) => {
        const element = elements.find((item) => item.id === issue.elementId);
        if (!element) return null;
        const box = getBoundingBox(element);
        return <rect key={`bounds-${issue.elementId}`} x={box.left} y={box.top} width={box.width} height={box.height} fill="none" stroke="#d64f3d" strokeWidth={0.1} strokeDasharray="0.3 0.25" />;
      })}
      <text x={0.4} y={-0.35} fontSize={0.55} fill="#a3b0bd" letterSpacing={0.15}>EXPO HALL · {field.width}×{field.height} m</text>
    </svg>
  );
}

function IssueSummary({ document, analysis }: { document: LayoutDocument; analysis: Analysis }) {
  const rows: Array<{ tone: string; text: string }> = [];
  analysis.overlaps.forEach((issue) => {
    const first = document.elements.find((element) => element.id === issue.firstId)?.name ?? issue.firstId;
    const second = document.elements.find((element) => element.id === issue.secondId)?.name ?? issue.secondId;
    rows.push({ tone: 'error', text: `重叠：「${first}」与「${second}」重叠 ${issue.amount} m²` });
  });
  analysis.bounds.forEach((issue) => {
    const name = document.elements.find((element) => element.id === issue.elementId)?.name ?? issue.elementId;
    rows.push({ tone: 'error', text: `越界：「${name}」超出场地边界 ${issue.overflow} m` });
  });
  analysis.channels.forEach((issue) => {
    const first = document.elements.find((element) => element.id === issue.firstId)?.name ?? issue.firstId;
    const second = document.elements.find((element) => element.id === issue.secondId)?.name ?? issue.secondId;
    rows.push({ tone: 'warning', text: `窄通道：「${first}」与「${second}」间距 ${issue.gap} m（建议 ≥ ${MIN_CHANNEL} m）` });
  });

  return (
    <div className="print-issues">
      <h3>问题摘要</h3>
      {rows.length === 0 ? (
        <p className="print-issues-clear">当前布局未检出重叠、越界或窄通道问题。</p>
      ) : (
        <ul>
          {rows.map((row, index) => <li key={index} className={`issue-tone-${row.tone}`}>{row.text}</li>)}
        </ul>
      )}
      <div className="print-path-line">
        {analysis.path
          ? <>访问路线：{analysis.path.fromName} → {analysis.path.toName}，总长约 {analysis.path.distance} m</>
          : '访问路线：需至少包含一个入口与一个重点区域（舞台/展位/座席）才能生成'}
      </div>
    </div>
  );
}

export function PrintSheet({ document, analysis, printedAt }: PrintSheetProps) {
  const totalArea = document.field.width * document.field.height;
  const occupied = document.elements.reduce((sum, element) => {
    const box = getBoundingBox(element);
    return sum + box.width * box.height;
  }, 0);

  return (
    <article className="print-sheet">
      <header className="print-header">
        <div>
          <span className="print-kicker">EXPOSKETCH · 场地布置图</span>
          <h1>{document.title}</h1>
        </div>
        <div className="print-header-meta">
          <span>出图时间：{formatDateTime(printedAt)}</span>
          <span>图纸用途：会议评审</span>
        </div>
      </header>

      <section className="print-meta-bar">
        <div><strong>{document.field.width} × {document.field.height} m</strong><span>场地尺寸</span></div>
        <div><strong>{totalArea.toFixed(0)} m²</strong><span>场地总面积</span></div>
        <div><strong>{document.elements.length}</strong><span>布置元素</span></div>
        <div><strong>{(occupied / totalArea * 100).toFixed(0)}%</strong><span>占地率</span></div>
      </section>

      <section className="print-body">
        <div className="print-plan">
          <PlanSvg document={document} analysis={analysis} />
        </div>
        <aside className="print-side">
          <div className="print-legend-block">
            <h3>图例</h3>
            <ul className="print-legend">
              {KIND_ORDER.map((kind) => {
                const spec = ELEMENT_SPECS[kind];
                return (
                  <li key={kind}>
                    <span className="legend-swatch" style={{ background: spec.color }}>{spec.icon}</span>
                    <span>{spec.label}</span>
                    <em>{spec.width}×{spec.height}m</em>
                  </li>
                );
              })}
              <li><span className="legend-swatch line-overlap" />重叠 / 冲突</li>
              <li><span className="legend-swatch line-bounds" />超出场地</li>
              <li><span className="legend-swatch line-path" />访问路径</li>
            </ul>
          </div>
          <IssueSummary document={document} analysis={analysis} />
        </aside>
      </section>

      <footer className="print-footer">
        <span>ExpoSketch Space Planner</span>
        <span>{document.title} · {document.field.width}×{document.field.height} m</span>
        <span>第 1 页 / 共 1 页</span>
      </footer>
    </article>
  );
}
