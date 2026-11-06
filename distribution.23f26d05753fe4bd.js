/* Paired gross-return scenarios, from the same saved account as the main site. */
"use strict";
const distributionBP = value => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value * 10000).toFixed(2)} bp`;
const distributionPeriod = row => ({63:"3-month",126:"6-month"}[row.horizon_sessions] || "Next-session");
function shiftLabel(change, lowerIsBetter = false) {
  if (Math.abs(change) <= 1e-12) return {tone:"flat", text:"Unchanged", direction:"→"};
  const better = lowerIsBetter ? change < 0 : change > 0;
  return {tone:better ? "improved" : "worsened", text:lowerIsBetter ? (better ? "Lower loss risk" : "Higher loss risk") : (better ? "Higher expected return" : "Lower expected return"), direction:change > 0 ? "→" : "←"};
}
function smoothDensity(values) {
  // Shared bandwidth for both books. Display-only: preserve the plotted area.
  const radius=4,sigma=1.25,kernel=Array.from({length:2*radius+1},(_,i)=>Math.exp(-.5*((i-radius)/sigma)**2));
  const total=kernel.reduce((a,b)=>a+b,0);
  const smoothed=values.map((_,i)=>kernel.reduce((sum,w,j)=>sum+w*(values[i+j-radius] || 0),0)/total);
  const area=v=>v.reduce((a,b)=>a+b,0)-(v[0]+v.at(-1))/2;
  const scale=area(smoothed)>0 ? area(values)/area(smoothed) : 1;
  return smoothed.map(v=>v*scale);
}
function smoothDistributionPath(xs, ys) {
  // Shape-preserving cubic interpolation: no spurious peaks or negative density.
  // It also keeps the loss-exceedance curve monotone, without smoothing its data.
  const widths=xs.slice(1).map((v,i)=>v-xs[i]);
  const slopes=ys.slice(1).map((v,i)=>(v-ys[i])/widths[i]);
  const tangents=xs.map((_,i)=>{
    if(i===0)return slopes[0];
    if(i===xs.length-1)return slopes.at(-1);
    if(slopes[i-1]*slopes[i]<=0)return 0;
    const w1=2*widths[i]+widths[i-1],w2=widths[i]+2*widths[i-1];
    return (w1+w2)/(w1/slopes[i-1]+w2/slopes[i]);
  });
  const point=(x,y)=>`${x.toFixed(3)},${y.toFixed(3)}`;
  return `M${point(xs[0],ys[0])}`+widths.map((width,i)=>
    ` C${point(xs[i]+width/3,ys[i]+tangents[i]*width/3)} ${point(xs[i+1]-width/3,ys[i+1]-tangents[i+1]*width/3)} ${point(xs[i+1],ys[i+1])}`).join("");
}
function distributionChart(row, loss = false) {
  const c = row.curves, W=850, H=350, left=65, right=22, top=52, bottom=57;
  const grid = loss ? c.loss_x : c.gross_x;
  const before = loss ? c.loss_before : smoothDensity(c.gross_before);
  const after = loss ? c.loss_after : smoothDensity(c.gross_after);
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
    const path=smoothDistributionPath(grid.map(x),values.map(y));
    svg+=`<path d="${path} L${x(grid.at(-1))},${bottomY} L${x(grid[0])},${bottomY} Z" fill="${stroke}" opacity=".05"/><path d="${path}" fill="none" stroke="${stroke}" stroke-width="2.4"/><line x1="${x(mean)}" x2="${x(mean)}" y1="${top}" y2="${bottomY}" stroke="${stroke}" stroke-dasharray="4 4"/>`;
  }
  svg+=`<text x="${(W+left-right)/2}" y="${H-9}" text-anchor="middle">${distributionPeriod(row)} ${loss ? "potential loss" : "return"} (% of NAV)</text></svg>`;
  return `<div class="chart distribution-chart">${svg}</div>`;
}
function distributionMetric(label, before, after, lowerIsBetter) {
  const shift=shiftLabel(after-before,lowerIsBetter);
  const measure=lowerIsBetter ? "Expected shortfall" : "Expected return";
  const explanation=shift.tone==="flat" ? `${measure} is unchanged after rebalancing.`
    : `${measure} is ${Math.abs((after-before)*10000).toFixed(2)} basis points ${after>before ? "higher" : "lower"} after rebalancing.`;
  return `<div class="distribution-metric ${shift.tone}"><div class="distribution-values"><span class="metric-label">${label}</span><div class="distribution-comparison"><div><span class="caption">Before rebalancing</span><strong class="before-value">${pct(before,3)}</strong></div><div><span class="caption">After rebalancing</span><strong>${pct(after,3)}</strong></div></div></div><div class="shift-result"><span class="shift-badge ${shift.tone}">${shift.text}</span><strong>${distributionBP(after-before)}</strong><span class="caption">${explanation}</span></div></div>`;
}
function distributionHistory(data, current) {
  const period=distributionPeriod(current).toLowerCase();
  return `<div class="distribution-history"><div><span class="eyebrow">Across the saved record</span><h2>Return and risk, viewed together.</h2><p>Both portfolios face the same ${num(data.simulations)} simulated market paths on each date. The selected ${period} horizon shows the trade-off between expected return and potential loss.</p></div><div class="history-stat"><strong>${pct(current.risk_improvement_rate,1)}</strong><span>of rebalance dates have lower ${period} expected shortfall</span></div><div class="history-stat"><strong>${pct(data.rebalance_outperformance_rate,0)}</strong><span>Rebalances outperforming no trade</span><small class="caption">Observed next-session returns · before costs${current.horizon_sessions>1 ? " · not a multi-month success rate" : ""}</small></div></div>`
    +`<p class="note">Across ${num(current.rebalance_dates)} rebalance dates, average ${period} expected shortfall changes from ${pct(current.mean_es_before,4)} to ${pct(current.mean_es_after,4)}. Initial allocation and no-trade dates are excluded. The observed next-session comparison remains ${num(data.outperforming_rebalances)} wins out of ${num(data.scored_rebalances)} scored rebalances.</p>`;
}
async function distribution(viewToken) {
  if(globalThis.executionWorkspace && S) $("#asof").textContent=`Backtest through ${date(S.last_valuation)}`;
  const data=await load("distribution"); if(state.view!==viewToken) return;
  if(!data.available){
    $("#main").innerHTML=heading("Distribution","Daily before-and-after portfolio simulations.")+`<div class="note-box">No matching simulation is available for this saved account.</div>`;
    return;
  }
  const rows=data.rows;
  const horizons={1:data,...data.horizons};
  let horizon=Object.hasOwn(horizons,state.distributionHorizon) ? state.distributionHorizon : "1";
  let index=rows.findIndex(r=>r.date===state.distributionDate);
  if(index<0) index=rows.length-1;
  const controls=`<div class="distribution-controls"><div class="actions"><button class="button" id="distribution-prev" aria-label="Previous valuation day">←</button><label>Valuation date<select id="distribution-date">${rows.map((r,i)=>option(i,date(r.date))).join("")}</select></label><button class="button" id="distribution-next" aria-label="Next valuation day">→</button><label>Projection horizon<select id="distribution-horizon">${Object.entries(horizons).map(([key,value])=>option(key,value.label || "Next session")).join("")}</select></label></div><span id="distribution-status" class="badge"></span></div><div class="distribution-timeline"><span>${date(rows[0].date)}</span><input id="distribution-slider" type="range" min="0" max="${rows.length-1}" step="1" aria-label="Select a valuation day"><span>${date(rows.at(-1).date)}</span></div>`;
  $("#main").innerHTML=heading("Distribution","How each rebalance changes the portfolio’s return and risk outlook.",download("return_distribution_daily.csv","Daily comparisons ↓")+(data.horizons ? download("return_distribution_horizons.csv","3 & 6 months ↓") : "")+'<a class="button" id="distribution-execution" href="#execution">View execution ↗</a>')
    +panel("Explore a trading day","Before rebalancing uses the holdings before that day’s trades; after rebalancing uses the holdings after those trades. Both project forward from the same date over your chosen horizon.",controls)
    +`<div id="distribution-selected" aria-live="polite" aria-atomic="true"></div>`
    +`<div id="distribution-history">${distributionHistory(data,horizons[horizon])}</div>`
    +`<details class="distribution-method"><summary>How to read these simulations</summary><p class="note">The grey curve uses the portfolio before today’s trades; the green curve uses the executed closing portfolio. A mean moving right indicates higher expected return. An expected-shortfall marker moving left indicates a smaller average loss in the worst 5% of scenarios. Curves can cross; one improved measure does not mean every outcome improves.</p><p class="note">Projections use up to ${data.lookback} trailing observations and archived factor estimates available on the selected date. Three months means 63 valuation sessions; six months means 126. Longer horizons compound independently resampled daily shocks, with identical paths for both books. Portfolio weights and model means stay constant. These are conditional projections of today’s allocation, not forecasts of future strategy rebalances or fixed-share buy-and-hold returns. Serial dependence, regime changes and uncertainty in model means are not simulated.</p><p class="note">Returns and risk measures exclude trading and borrowing fees, and each book uses its own NAV. Return curves use the same display smoothing for both portfolios over the central 99.8% range. Loss curves smoothly connect empirical exceedance probabilities. Smoothing does not change the expected returns, expected shortfall or simulation data. Expected shortfall uses all unsmoothed outcomes at the selected horizon; it is not annualized. One basis point equals 0.01 percentage points.</p><p class="note">The outperformance percentage always compares realized next-session returns before costs after rebalancing versus skipping that day’s trades. It excludes ties from the win count and excludes the final date, which has no following outcome. It is separate from the simulated expected-return shift and estimated risk reduction. Simulations are retrospective model estimates, not guarantees. Saved backtest NAV is unchanged.</p></details>`;
  function render(next) {
    index=Math.max(0,Math.min(rows.length-1,Number(next)));
    const current=horizons[horizon],row=current.rows[index]; state.distributionDate=row.date;
    state.distributionHorizon=horizon;$("#distribution-horizon").value=horizon;
    $("#distribution-history").innerHTML=distributionHistory(data,current);
    state.executionDate=row.date;$('#distribution-execution').href=`#execution?date=${row.date}`;
    $("#distribution-date").value=String(index);$("#distribution-slider").value=String(index);
    $("#distribution-slider").setAttribute("aria-valuetext",date(row.date));
    $("#distribution-prev").disabled=index===0;$("#distribution-next").disabled=index===rows.length-1;
    $("#distribution-status").textContent=row.initial_allocation ? "Initial allocation" : row.rebalanced ? "Rebalanced" : "No trades · holdings unchanged";
    if(!row.curves){$("#distribution-selected").innerHTML=`<div class="note-box">${date(row.date)} · A distribution is unavailable because this date has insufficient simulation inputs.</div>`;return;}
    const legend=`<span class="legend"><span><i class="gross"></i>Before rebalancing</span><span><i></i>After rebalancing</span></span>`;
    const period=distributionPeriod(row),note=current.horizon_sessions>1 ? `<p class="note">${current.label} · ${current.horizon_sessions} sessions · Compounded projection at constant weights, before costs.</p>` : "";
    const returns=panel("Return distribution",`${date(row.date)} · Expected ${period.toLowerCase()} returns from each portfolio`,distributionMetric(`Expected ${period.toLowerCase()} return`,row.mean_before_gross,row.mean_after_gross,false)+distributionChart(row)+`<div class="chart-footer">${legend}<span>Dashed lines: expected return for each portfolio</span></div>`,"",false);
    const risk=panel("Downside risk · 95% expected shortfall",`${period} average loss in the worst 5% of simulated outcomes`,distributionMetric("Expected shortfall",row.gross_es_95_before,row.gross_es_95_after,true)+distributionChart(row,true)+`<div class="chart-footer">${legend}<span>Dashed lines: expected shortfall · lower is better</span></div>`,"",false);
    $("#distribution-selected").innerHTML=note+`<div class="distribution-panels">${returns}${risk}</div>`;
  }
  $("#distribution-horizon").onchange=event=>{horizon=event.target.value;render(index);};
  $("#distribution-date").onchange=event=>render(event.target.value);
  $("#distribution-slider").oninput=event=>render(event.target.value);
  $("#distribution-prev").onclick=()=>render(index-1);$("#distribution-next").onclick=()=>render(index+1);
  render(index);
}
