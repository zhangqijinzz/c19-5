import type { PrintModel } from './transfer';

const KIND_FILL: Record<string, string> = {
  booth: '#e7f0ff',
  stage: '#f2e9ff',
  seating: '#e6f7f2',
  entrance: '#fff2d8',
};

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * 生成自包含的打印用 HTML：内联 SVG 平面图 + 项目信息 + 图例 + 问题摘要。
 * 不依赖任何外部资源，可直接在新窗口或 iframe 中打印。
 */
export const buildPrintHtml = (model: PrintModel): string => {
  const { field, elements, legend, summary, analysis, title } = model;
  const step = field.width >= 20 ? 5 : field.width >= 10 ? 2 : 1;
  const gridLines: string[] = [];
  for (let x = step; x < field.width; x += step) {
    gridLines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${field.height}" stroke="#e6ebf1" stroke-width="0.04"/>`);
  }
  for (let y = step; y < field.height; y += step) {
    gridLines.push(`<line x1="0" y1="${y}" x2="${field.width}" y2="${y}" stroke="#e6ebf1" stroke-width="0.04"/>`);
  }
  const rulerLabels: string[] = [];
  for (let x = 0; x <= field.width; x += step) {
    rulerLabels.push(`<text x="${x + 0.15}" y="${field.height - 0.25}" font-size="0.55" fill="#9aa7b4">${x}</text>`);
  }

  const elementNodes = elements.map((element) => {
    const quarterTurn = (((element.rotation % 180) + 180) % 180) !== 0;
    const boxWidth = quarterTurn ? element.height : element.width;
    const boxHeight = quarterTurn ? element.width : element.height;
    const fontSize = Math.min(0.8, Math.max(0.5, boxHeight * 0.18));
    const name = escapeHtml(element.name);
    const sub = `${boxWidth.toFixed(1)}×${boxHeight.toFixed(1)}m`;
    return `<g transform="rotate(${element.rotation} ${element.x + boxWidth / 2} ${element.y + boxHeight / 2})">
      <rect x="${element.x}" y="${element.y}" width="${boxWidth}" height="${boxHeight}" rx="0.15" fill="${KIND_FILL[element.kind] ?? '#eef2f6'}" stroke="#8fa4b8" stroke-width="0.06"/>
      <text x="${element.x + 0.3}" y="${element.y + boxHeight / 2 - fontSize * 0.15}" font-size="${fontSize.toFixed(2)}" font-weight="600" fill="#3a4f63">${name}</text>
      <text x="${element.x + 0.3}" y="${element.y + boxHeight / 2 + fontSize * 0.95}" font-size="${(fontSize * 0.72).toFixed(2)}" fill="#7d8ea0" font-family="DM Mono, monospace">${sub}</text>
    </g>`;
  }).join('\n');

  const issueRows: string[] = [];
  analysis.overlaps.forEach((issue) => {
    const first = elements.find((element) => element.id === issue.firstId)?.name ?? issue.firstId;
    const second = elements.find((element) => element.id === issue.secondId)?.name ?? issue.secondId;
    issueRows.push(`<li><span class="tag overlap">重叠</span>「${escapeHtml(first)}」与「${escapeHtml(second)}」重叠 ${issue.amount.toFixed(1)} m²</li>`);
  });
  analysis.bounds.forEach((issue) => {
    const name = elements.find((element) => element.id === issue.elementId)?.name ?? issue.elementId;
    issueRows.push(`<li><span class="tag bounds">越界</span>「${escapeHtml(name)}」超出场地边界 ${issue.overflow.toFixed(1)} m</li>`);
  });
  analysis.channels.forEach((issue) => {
    const first = elements.find((element) => element.id === issue.firstId)?.name ?? issue.firstId;
    const second = elements.find((element) => element.id === issue.secondId)?.name ?? issue.secondId;
    issueRows.push(`<li><span class="tag channel">窄通道</span>「${escapeHtml(first)}」与「${escapeHtml(second)}」间距仅 ${issue.gap.toFixed(1)} m（建议 ≥1.2 m）</li>`);
  });
  const issueSection = issueRows.length
    ? `<ul class="issues">${issueRows.join('')}</ul>`
    : '<p class="all-clear">✓ 未发现重叠、越界或窄通道问题。</p>';

  const legendHtml = legend.map((item) => `
    <li><span class="legend-swatch" style="background:${KIND_FILL[item.kind]}">${item.icon}</span><span class="legend-label">${item.label}</span><span class="legend-count">× ${item.count}</span></li>`).join('');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)} · 布局图纸</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #233142; font-family: 'PingFang SC', 'Microsoft YaHei', 'DM Sans', sans-serif; }
  .sheet { padding: 4mm 2mm; }
  .sheet-head { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #25364a; padding-bottom: 4mm; margin-bottom: 5mm; }
  .sheet-head h1 { margin: 0 0 2mm; font-size: 22pt; letter-spacing: -.5px; }
  .sheet-head .meta { color: #6b7a8a; font-size: 9pt; line-height: 1.7; text-align: right; }
  .sheet-head .brand { color: #ef795f; font-weight: 700; font-size: 10pt; letter-spacing: 2px; }
  .plan-grid { display: grid; grid-template-columns: minmax(0, 1fr) 72mm; gap: 6mm; }
  .plan-frame { border: 1px solid #c6d0da; border-radius: 3mm; padding: 3mm; background: #fff; }
  svg { width: 100%; height: auto; display: block; }
  .side { display: flex; flex-direction: column; gap: 4mm; font-size: 9pt; }
  .card { border: 1px solid #dce3ea; border-radius: 2.5mm; padding: 3.5mm 4mm; }
  .card h2 { margin: 0 0 2.5mm; font-size: 10pt; color: #25364a; }
  .kv { display: flex; justify-content: space-between; color: #5f7487; padding: 1.2mm 0; }
  .kv b { color: #25364a; }
  ul.legend { list-style: none; margin: 0; padding: 0; }
  ul.legend li { display: flex; align-items: center; gap: 2.5mm; padding: 1.3mm 0; }
  .legend-swatch { width: 7mm; height: 7mm; display: inline-grid; place-items: center; border: 1px solid #b6c7d6; border-radius: 1.5mm; font-size: 9pt; }
  .legend-label { flex: 1; }
  .legend-count { color: #8494a4; font-family: 'DM Mono', monospace; }
  .stats { display: flex; gap: 3mm; }
  .stat { flex: 1; text-align: center; border: 1px solid #dce3ea; border-radius: 2mm; padding: 2mm 0; }
  .stat b { display: block; font-size: 14pt; }
  .stat.warn b { color: #d97c3f; }
  .stat span { font-size: 7.5pt; color: #8494a4; }
  ul.issues { list-style: none; margin: 0; padding: 0; max-height: 62mm; overflow: hidden; }
  ul.issues li { display: flex; align-items: baseline; gap: 2mm; padding: 1.3mm 0; font-size: 8.5pt; line-height: 1.45; border-bottom: 1px dotted #e6ebf1; }
  .tag { flex: 0 0 11mm; text-align: center; border-radius: 1.5mm; padding: .5mm 0; font-size: 7.5pt; color: #fff; }
  .tag.overlap { background: #e56e5b; } .tag.bounds { background: #ef795f; } .tag.channel { background: #e0a244; }
  .all-clear { margin: 0; color: #3e9b76; font-size: 9pt; }
  .foot { margin-top: 4mm; display: flex; justify-content: space-between; color: #97a3b0; font-size: 7.5pt; border-top: 1px solid #e6ebf1; padding-top: 2.5mm; }
</style>
</head>
<body>
<div class="sheet">
  <header class="sheet-head">
    <div>
      <div class="brand">EXPOSKETCH · 场地布局图纸</div>
      <h1>${escapeHtml(title)}</h1>
      <div class="meta">场地尺寸 <b>${field.width} × ${field.height} m</b>（约 ${model.area} m²）</div>
    </div>
    <div class="meta">
      元素总数：${summary.total}<br/>
      导出时间：${escapeHtml(model.exportedAt)}<br/>
      比例：示意 1:100
    </div>
  </header>
  <div class="plan-grid">
    <div class="plan-frame">
      <svg viewBox="-0.6 -0.6 ${field.width + 1.2} ${field.height + 1.2}" xmlns="http://www.w3.org/2000/svg">
        <rect x="0" y="0" width="${field.width}" height="${field.height}" fill="#fcfdff" stroke="#5f7487" stroke-width="0.1"/>
        ${gridLines.join('\n')}
        ${rulerLabels.join('\n')}
        ${elementNodes}
      </svg>
    </div>
    <aside class="side">
      <div class="stats">
        <div class="stat ${summary.overlaps ? 'warn' : ''}"><b>${summary.overlaps}</b><span>重叠</span></div>
        <div class="stat ${summary.bounds ? 'warn' : ''}"><b>${summary.bounds}</b><span>越界</span></div>
        <div class="stat ${summary.channels ? 'warn' : ''}"><b>${summary.channels}</b><span>窄通道</span></div>
      </div>
      <div class="card">
        <h2>图例</h2>
        <ul class="legend">${legendHtml}</ul>
      </div>
      <div class="card">
        <h2>问题摘要</h2>
        ${issueSection}
      </div>
      <div class="card">
        <h2>场地信息</h2>
        <div class="kv"><span>宽度</span><b>${field.width} m</b></div>
        <div class="kv"><span>深度</span><b>${field.height} m</b></div>
        <div class="kv"><span>总面积</span><b>${model.area} m²</b></div>
        <div class="kv"><span>入口→主区路径</span><b>${summary.pathDistance === null ? '—' : `${summary.pathDistance} m`}</b></div>
      </div>
    </aside>
  </div>
  <footer class="foot">
    <span>ExpoSketch 自动生成 · 供会议讨论使用</span>
    <span>${escapeHtml(title)} · ${field.width}×${field.height}m</span>
  </footer>
</div>
</body>
</html>`;
};
