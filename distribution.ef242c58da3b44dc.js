/* Paired gross-return scenarios, from the same saved account as the main site. */
"use strict";
const distributionBP = value => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value * 10000).toFixed(2)} bp`;
function shiftLabel(change, lowerIsBetter = false) {
  if (Math.abs(change) <= 1e-12) return {tone:"flat", text:"Unchanged", direction:"→"};
  const better = lowerIsBetter ? change < 0 : change > 0;
  return {tone:better ? "improved" : "worsened", text:lowerIsBetter ? (better ? "Lower loss risk" : "Higher loss risk") : (better ? "Higher expected return" : "Lower expected return"), direction:change > 0 ? "→" : "←"};
}
function distributionChart(row, loss = false) {
  const c = row.curves, W=850, H=350, left=65, right=22, top=52, bottom=57;
  const grid = loss ? c.loss_x : c.gross_x;
  const before = loss ? c.loss_before : c.gross_before, after = loss ? c.loss_after : c.gross_after;
  const a = loss ? row.gross_es_95_before : row.mean_before_gross;
  const b = loss ? row.gross_es_95_after : row.mean_after_gross;
  const direction = shiftLabel(b-a, loss);
  const low = Math.min(grid[0],a,b), high = Math.max(grid.at(-1),a,b);
  const maxY=Math.max(1e-12,...before,...after)*1.12;
  const x=v=>left+(v-low)/(high-low || .001)*(W-left-right), y=v=>H-bottom-v/maxY*(H-top-bottom);
  const bottomY=H-bottom, color=direction.tone==="worsened" ? "#b2534e" : "#087f70";
  const label=loss ? "Loss distribution" : "Return distribution";
  let svg=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${row.date}: ${label}. ${direction.text} by ${distributionBP(b-a)}."><title>${label} · ${row.date}</title>`;
  for(let i=0;i<=4;i++){
    const v=maxY*i/4, value=low+(high-low)*i/4;
    svg+=`<line class="grid" x1="${left}" x2="${W-right}" y1="${y(v)}" y2="${y(v)}"/><text x="${left-10}" y="${y(v)+4}" text-anchor="end">${loss ? pct(v,0) : v.toFixed(0)}</text><text x="${x(value)}" y="${bottomY+23}" text-anchor="${i===0 ? "start" : i===4 ? "end" : "middle"}">${pct(value,1)}</text>`;
  }
  svg+=`<text x="${left}" y="18">${loss ? "Probability of exceeding a loss" : "Probability density"}</text>`;
  if(Math.abs(a-b)>1e-12){
    const xa=x(a), xb=x(b), tip=xb>xa ? -6 : 6;
    svg+=`<rect x="${Math.min(xa,xb)}" y="${top}" width="${Math.abs(xb-xa)}" height="${bottomY-top}" fill="${color}" opacity=".09"/><line x1="${xa}" x2="${xb}" y1="35" y2="35" stroke="${color}" stroke-width="2"/><path d="M${xb+tip},31 L${xb},35 L${xb+tip},39" stroke="${color}" fill="none"/>`;
  }
  for(const [values,stroke,mean] of [[before,"#8196ad",a],[after,"#087f70",b]]){
    const path=grid.map((v,i)=>`${i ? "L" : "M"}${x(v).toFixed(2)},${y(values[i]).toFixed(2)}`).join(" ");
    svg+=`<path d="${path} L${x(grid.at(-1))},${bottomY} L${x(grid[0])},${bottomY} Z" fill="${stroke}" opacity=".05"/><path d="${path}" fill="none" stroke="${stroke}" stroke-width="2.4"/><line x1="${x(mean)}" x2="${x(mean)}" y1="${top}" y2="${bottomY}" stroke="${stroke}" stroke-dasharray="4 4"/>`;
  }
  svg+=`<text x="${(W+left-right)/2}" y="${H-9}" text-anchor="middle">${loss ? "Potential next-session loss (% of NAV)" : "Next-session return (% of NAV)"}</text></svg>`;
  return `<div class="chart distribution-chart">${svg}</div>`;
}
function distributionMetric(label, before, after, lowerIsBetter) {
  const shift=shiftLabel(after-before,lowerIsBetter);
  return `<div class="distribution-metric ${shift.tone}"><div><span class="metric-label">${label}</span><strong>${pct(after,3)}</strong><span class="caption">Before ${pct(before,3)} <span aria-hidden="true">→</span> After ${pct(after,3)}</span></div><div class="shift-result"><span class="shift-badge ${shift.tone}">${shift.text}</span><strong>${shift.direction} ${distributionBP(after-before)}</strong><span class="caption">After minus before</span></div></div>`;
}
async function distribution(viewToken) {
  const data=await load("distribution"); if(state.view!==viewToken) return;
  if(!data.available){
    $("#main").innerHTML=heading("Distribution","Daily before-and-after portfolio simulations.")+`<div class="note-box">No matching simulation is available for this saved account.</div>`;
    return;
  }
  const rows=data.rows;
  let index=rows.findIndex(r=>r.date===state.distributionDate);
  if(index<0) index=rows.length-1;
  const controls=`<div class="distribution-controls"><div class="actions"><button class="button" id="distribution-prev" aria-label="Previous valuation day">←</button><label>Valuation date<select id="distribution-date">${rows.map((r,i)=>option(i,date(r.date))).join("")}</select></label><button class="button" id="distribution-next" aria-label="Next valuation day">→</button></div><span id="distribution-status" class="badge"></span></div><div class="distribution-timeline"><span>${date(rows[0].date)}</span><input id="distribution-slider" type="range" min="0" max="${rows.length-1}" step="1" aria-label="Select a valuation day"><span>${date(rows.at(-1).date)}</span></div>`;
  $("#main").innerHTML=heading("Distribution","How each rebalance changes the portfolio’s next-session outlook.",download("return_distribution_daily.csv","Daily comparisons ↓"))
    +panel("Explore a trading day","Compare the executed portfolio with keeping the holdings immediately before that day’s trades.",controls)
    +`<div id="distribution-selected" aria-live="polite" aria-atomic="true"></div>`
    +`<div class="distribution-history"><div><span class="eyebrow">Across the saved record</span><h2>A measured improvement in downside risk.</h2><p>Both portfolios face the same ${num(data.simulations)} simulated market scenarios on each date. Daily comparisons show the trade-off between expected return and potential loss.</p></div><div class="history-stat"><strong>${pct(data.risk_improvement_rate,1)}</strong><span>of rebalance dates have lower expected shortfall</span></div><div class="history-stat"><strong>${pct(data.rebalance_outperformance_rate,0)}</strong><span>Rebalances outperforming no trade</span><small class="caption">Observed next-session returns · before costs</small></div></div>`
    +`<p class="note">Across ${num(data.rebalance_dates)} rebalance dates, average one-session expected shortfall changes from ${pct(data.mean_es_before,4)} to ${pct(data.mean_es_after,4)}. The average reduction is modest. Initial allocation and no-trade dates are excluded. Outperformance uses ${num(data.scored_rebalances)} scored rebalances; ${num(data.outperforming_rebalances)} beat keeping the pre-trade holdings for the following session.</p>`
    +`<details class="distribution-method"><summary>How to read these simulations</summary><p class="note">The grey curve keeps the holdings before today’s trades; the green curve uses the executed closing portfolio. A mean moving right indicates higher expected return. An expected-shortfall marker moving left indicates a smaller average loss in the worst 5% of scenarios. Curves can cross; one improved measure does not mean every outcome improves.</p><p class="note">One following valuation session, using up to ${data.lookback} trailing observations and archived factor estimates available on the selected date. Returns and risk measures exclude explicit trading and borrowing fees, and each book uses its own NAV. Density curves use identical smoothing over the central 99.8% range; the loss curves show empirical exceedance probabilities. Expected shortfall uses all unsmoothed scenarios.</p><p class="note">The outperformance percentage compares realized next-session returns before costs after rebalancing versus skipping that day’s trades. It excludes ties from the win count and excludes the final date, which has no following outcome. It is separate from the simulated expected-return shift and the estimated risk reduction. Simulations are retrospective model estimates, not guarantees. The optimizer has a longer, 21-session objective. As a separate calibration check, realized losses exceeded the model’s 95% loss threshold on ${pct(data.var_exceedance_rate,1)} of scored rebalance dates, versus a nominal 5%. Saved backtest NAV is unchanged.</p></details>`;
  function render(next) {
    index=Math.max(0,Math.min(rows.length-1,Number(next)));
    const row=rows[index]; state.distributionDate=row.date;
    $("#distribution-date").value=String(index);$("#distribution-slider").value=String(index);
    $("#distribution-slider").setAttribute("aria-valuetext",date(row.date));
    $("#distribution-prev").disabled=index===0;$("#distribution-next").disabled=index===rows.length-1;
    $("#distribution-status").textContent=row.initial_allocation ? "Initial allocation" : row.rebalanced ? "Rebalanced" : "No trades · holdings unchanged";
    if(!row.curves){$("#distribution-selected").innerHTML=`<div class="note-box">${date(row.date)} · A distribution is unavailable because this date has insufficient simulation inputs.</div>`;return;}
    const legend=`<span class="legend"><span><i class="gross"></i>Before rebalancing</span><span><i></i>After rebalancing</span></span>`;
    const returns=panel("Return distribution",`${date(row.date)} · A rightward mean shift is an improvement`,distributionMetric("Expected next-session return",row.mean_before_gross,row.mean_after_gross,false)+distributionChart(row)+`<div class="chart-footer">${legend}<span>Dashed lines: expected returns</span></div>`,"",false);
    const risk=panel("Downside risk · 95% expected shortfall","Average loss in the worst 5% of simulated outcomes",distributionMetric("Expected shortfall",row.gross_es_95_before,row.gross_es_95_after,true)+distributionChart(row,true)+`<div class="chart-footer">${legend}<span>Dashed lines: expected shortfall · lower is better</span></div>`,"",false);
    $("#distribution-selected").innerHTML=`<div class="distribution-panels">${returns}${risk}</div>`;
  }
  $("#distribution-date").onchange=event=>render(event.target.value);
  $("#distribution-slider").oninput=event=>render(event.target.value);
  $("#distribution-prev").onclick=()=>render(index-1);$("#distribution-next").onclick=()=>render(index+1);
  render(index);
}
