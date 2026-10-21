/* Read-only presentation of one reconciled backtest. No external data or scripts. */
"use strict";
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const pct = (v, digits = 2) => v == null ? "—" : `${(v * 100).toFixed(digits)}%`;
const signed = v => `${v > 0 ? "+" : ""}${pct(v)}`;
const money = (v, digits = 0) => new Intl.NumberFormat("en-US", {style:"currency", currency:"USD", maximumFractionDigits:digits}).format(v);
const num = v => new Intl.NumberFormat("en-US").format(v);
const size = v => v < 1024 * 1024 ? `${(v / 1024).toFixed(0)} KB` : `${(v / 1024 / 1024).toFixed(1)} MB`;
const date = value => new Date(`${value.slice(0,10)}T00:00:00Z`).toLocaleDateString("en-GB", {day:"2-digit", month:"short", year:"numeric", timeZone:"UTC"});
const tone = value => value < 0 ? "negative" : "positive";
const option = (v, label = v, selected = false) => `<option value="${esc(v)}"${selected ? " selected" : ""}>${esc(label)}</option>`;
const download = (file, text = "Download CSV ↓", cls = "button") => `<a class="${cls}" href="files/${encodeURIComponent(file)}" download>${esc(text)}</a>`;
const names = {overview:"Overview", performance:"Monthly performance", distribution:"Return distribution", holdings:"Holdings", trades:"Trades", risk:"Risk & methodology", files:"Files & downloads"};
const state = {range:"ALL", view:"overview", month:null};
let S, P, R, FILES;
const cache = {};
async function load(name) {
  if (!cache[name]) cache[name] = fetch(`data/${name}.json`).then(response => {
    if (!response.ok) throw new Error(`Could not load ${name} (${response.status})`);
    return response.json();
  });
  return cache[name];
}
function heading(title, subtitle, actions = "") {
  return `<div class="page-head"><div><p class="eyebrow">Global equity / ${esc(names[state.view])}</p><h1>${esc(title)}</h1><p class="subtitle">${subtitle}</p></div><div class="actions">${actions}</div></div>`;
}
function metric(label, value, note, featured = false, color = "") {
  return `<div class="metric ${featured ? "featured" : ""}"><div class="metric-label">${label}</div><strong class="${color}">${value}</strong><small>${note}</small></div>`;
}
function panel(title, sub, content, actions = "", body = true) {
  return `<section class="panel"><div class="panel-head"><div><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ""}</div>${actions}</div>${body ? `<div class="panel-body">${content}</div>` : content}</section>`;
}
function fact(label, value) { return `<div class="fact"><span>${label}</span><strong>${value}</strong></div>`; }
function metrics() {
  return `<div class="metrics">${metric("Net annual return", pct(S.net_cagr), "CAGR · after trading & borrow fees", true, "positive")}${metric("Net total return", `+${pct(S.net_total_return)}`, `${date(S.evaluation_start || S.first_valuation)} – ${date(S.last_valuation)}`)}${metric("Maximum monthly drawdown", pct(S.monthly_max_drawdown), "Net NAV · measured at month ends")}${metric("Annualized volatility", pct(S.gross_volatility), "Gross of trading & borrow fees")}</div>`;
}
function lineChart(rows, series, {percent = false, id = "nav-chart", baseline = null} = {}) {
  const W = 850, H = 300, left = 53, right = 20, top = 20, bottom = 37;
  const values = rows.flatMap(r => series.map(s => Number(r[s.key]))).filter(Number.isFinite);
  let low = Math.min(...values, ...(baseline == null ? [] : [baseline])), high = Math.max(...values);
  const pad = (high - low || 1) * .12; low -= pad; high += pad;
  const x = i => left + i / Math.max(1, rows.length - 1) * (W - left - right);
  const y = v => top + (high - v) / (high - low) * (H - top - bottom);
  const label = v => percent ? pct(v, 0) : v.toFixed(0);
  let svg = `<svg id="${id}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${percent ? "Monthly net drawdown" : "Growth of 100 dollars, net and gross"} over the backtest period"><title>${percent ? "Monthly net drawdown" : "Net and gross NAV growth"}</title>`;
  for (let i = 0; i < 5; i++) {
    const v = low + (high - low) * i / 4;
    svg += `<line class="grid" x1="${left}" y1="${y(v)}" x2="${W-right}" y2="${y(v)}"/><text x="${left-12}" y="${y(v)+4}" text-anchor="end">${label(v)}</text>`;
  }
  const indices = [...new Set([0, .25, .5, .75, 1].map(t => Math.round(t * (rows.length - 1))))];
  for (const i of indices) svg += `<text x="${x(i)}" y="${H-12}" text-anchor="${i===0 ? "start" : i===rows.length-1 ? "end" : "middle"}">${esc((rows[i].date || rows[i].month).slice(0,7))}</text>`;
  for (const s of series) {
    const path = rows.map((r, i) => `${i ? "L" : "M"}${x(i).toFixed(2)},${y(r[s.key]).toFixed(2)}`).join(" ");
    if (s.fill) svg += `<path d="${path} L${x(rows.length-1)},${y(baseline ?? low)} L${x(0)},${y(baseline ?? low)} Z" fill="${s.fill}"/>`;
    svg += `<path d="${path}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2.3}" stroke-linejoin="round" stroke-linecap="round"/>`;
  }
  svg += `<line class="crosshair" x1="0" x2="0" y1="${top}" y2="${H-bottom}" stroke="#a3b8b4" stroke-dasharray="4 4" opacity="0"/><rect class="hover-area" x="${left}" y="${top}" width="${W-left-right}" height="${H-top-bottom}" fill="transparent"/></svg>`;
  return `<div class="chart" data-chart="${id}" data-left="${left}" data-right="${right}">${svg}</div>`;
}
function bindChart(id, rows, series, percent = false) {
  const svg = document.getElementById(id); if (!svg) return;
  const tooltip = $("#chart-tooltip"), crosshair = $(".crosshair", svg);
  svg.addEventListener("pointermove", event => {
    const box = svg.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width * 850;
    const i = Math.max(0, Math.min(rows.length - 1, Math.round((x - 53) / 777 * (rows.length - 1))));
    const row = rows[i], cx = 53 + i / Math.max(1, rows.length - 1) * 777;
    crosshair.setAttribute("x1", cx); crosshair.setAttribute("x2", cx); crosshair.setAttribute("opacity", "1");
    tooltip.innerHTML = `<strong>${esc(row.date ? date(row.date) : row.month)}</strong><br>${series.map(s => `${esc(s.label)}: ${percent ? pct(row[s.key]) : money(row[s.key], 2)}`).join("<br>")}`;
    tooltip.hidden = false;
    tooltip.style.left = `${Math.min(innerWidth - 205, Math.max(8, event.clientX + 15))}px`;
    tooltip.style.top = `${Math.min(innerHeight - 110, event.clientY + 15)}px`;
  });
  svg.addEventListener("pointerleave", () => { tooltip.hidden = true; crosshair.setAttribute("opacity", "0"); });
}
function growthRows() {
  const end = new Date(`${S.last_valuation}T00:00:00Z`), cutoff = new Date(end);
  if (state.range === "1Y") cutoff.setUTCFullYear(end.getUTCFullYear() - 1);
  else if (state.range === "YTD") cutoff.setUTCMonth(0, 1);
  const all = [{date:S.evaluation_start, net:100, gross:100}, ...P.daily.map(r => ({date:r.date, net:r.unit_nav_net*100, gross:r.unit_nav_gross*100}))];
  return state.range === "ALL" ? all : all.filter(r => r.date >= cutoff.toISOString().slice(0,10));
}
const growthSeries = [{key:"gross", label:"Gross NAV", color:"#8ca1b6", width:1.8}, {key:"net", label:"Net NAV", color:"#087f70", fill:"#087f7009"}];
function heatmap() {
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const years = [...new Set(P.monthly.map(r => r.month.slice(0,4)))];
  return `<div class="heatmap-wrap"><table class="heatmap"><thead><tr><th>Year</th>${months.map(m=>`<th>${m}</th>`).join("")}</tr></thead><tbody>${years.map(year => `<tr><th class="year">${year}</th>${months.map((m,i) => {
    const key = `${year}-${String(i+1).padStart(2,"0")}`, r = P.monthly.find(r=>r.month===key);
    if (!r) return `<td class="empty">—</td>`;
    const opacity = .08 + Math.min(Math.abs(r.return_net) / .08, 1) * .21;
    return `<td style="background:rgba(${r.return_net<0 ? "178,83,78" : "8,127,112"},${opacity});color:${r.return_net<0 ? "#8a3835" : "#076356"}"><button data-month="${key}" title="${key}: ${signed(r.return_net)}${r.final_month_partial ? " (partial month)" : ""}">${(r.return_net*100).toFixed(1)}${r.final_month_partial ? "*" : ""}</button></td>`;
  }).join("")}</tr>`).join("")}</tbody></table></div>`;
}
function overview() {
  const rows = growthRows();
  const mix = S.long_nav / S.gross_exposure * 100;
  const navPanel = panel("Growth of $100", "Net performance with gross NAV for comparison", lineChart(rows, growthSeries) + `<div class="chart-footer"><span class="legend"><span><i></i>Net NAV</span><span><i class="gross"></i>Gross NAV</span></span><span>Inception = $100 · range changes do not rebase</span></div>`, `<div class="segmented" aria-label="Chart period">${["ALL","1Y","YTD"].map(r=>`<button class="${state.range===r ? "active" : ""}" data-range="${r}" aria-pressed="${state.range===r}">${r}</button>`).join("")}</div>`, false);
  const book = panel("Portfolio at a glance", `At ${date(S.last_valuation)}`, `<p class="caption">ENDING NET ASSET VALUE</p><div class="capital">${money(S.ending_nav)}</div><p class="caption">${money(S.initial_nav)} initial capital</p><div class="exposure-bar"><span class="long" style="width:${mix}%"></span><span class="short" style="width:${100-mix}%"></span></div>${fact(`${S.long_count} long names`, pct(S.long_nav,1))}${fact(`${S.short_count} short names`, pct(S.short_nav,1))}${fact("Gross / net exposure", `${pct(S.gross_exposure,1)} / ${pct(S.net_exposure,1)}`)}<p class="caption">Weights as a percentage of NAV. Short exposure is shown as a positive magnitude.</p>`);
  const legs = P.legs.filter(r=>r.leg!=="index_hedges");
  const attribution = panel("Where the return came from", "Net contributions to initial NAV, including allocated costs", `${legs.map(r=>`<div class="leg"><div class="leg-title"><span>${r.leg==="long_stocks" ? "Long single names" : "Short single names"}</span><strong class="${tone(r.net_nav_contribution)}">${signed(r.net_nav_contribution)}</strong></div><div class="bar-track"><div class="bar-fill ${r.net_nav_contribution<0 ? "loss" : ""}" style="width:${Math.min(100,Math.abs(r.net_nav_contribution)*100)}%"></div></div></div>`).join("")}${fact("Trading costs", money(S.transaction_cost))}${fact("Stock borrow costs", money(S.borrow_cost))}<p class="caption">Contribution is P&L divided by initial NAV, not the return on each leg’s own capital. No index shorts in this run.</p>`);
  $("#main").innerHTML = heading("A global portfolio. A clear record.", `${date(S.evaluation_start || S.first_valuation)} — ${date(S.last_valuation)} · Factor-neutral single names · USD`, `<a class="button" href="files/${FILES.some(f=>f.name === "performance_summary.pdf") ? "performance_summary.pdf" : "backtest_report.html"}" target="_blank" rel="noopener">View report ↗</a>${download("backtest-records.zip","Download records ↓","button primary")}`) + metrics() + `<div class="two-col">${navPanel}${book}</div><div class="two-col">${panel("Monthly net returns", "Calendar-month performance · click a month to inspect", heatmap()+`<div class="chart-footer"><span>Values in % · green gains / red losses</span><span>* Partial month through ${date(S.last_valuation)}</span></div>`, "", false)}${attribution}</div>` + `<div class="note-box"><strong>${S.continuous_record ? "One continuous, replay-verified backtest." : "One saved, internally checked run."}</strong> ${S.check_count} internal checks passed. The charts and downloads use the same reconciled records. Returns include stock trading fees of ${pct(R.strategy.stock_fee)} per side and ${pct(R.strategy.borrow_rate,0)} annual short borrowing; volatility and tail-risk estimates use gross returns. <a class="link" href="#risk">Read the methodology ↗</a></div>`;
  $$('[data-range]').forEach(button => button.onclick = () => { state.range=button.dataset.range; overview(); });
  $$('[data-month]').forEach(button => button.onclick = () => { state.month=button.dataset.month; location.hash="performance"; });
  bindChart("nav-chart", rows, growthSeries);
}
function performance() {
  const rows = P.monthly.map(r=>({...r, drawdown:-r.month_end_drawdown_net}));
  const series = [{key:"drawdown",label:"Net drawdown",color:"#b2534e",fill:"#b2534e12"}];
  const table = `<div class="table-wrap"><table class="data-table"><thead><tr><th>Month</th><th class="num">Net return</th><th class="num">Gross return</th><th class="num">Net drawdown</th><th class="num">Long contribution</th><th class="num">Short contribution</th><th class="num">Turnover</th></tr></thead><tbody>${[...P.monthly].reverse().map(r=>{
    const legs = P.monthly_legs.filter(l=>l.month===r.month);
    return `<tr class="${state.month===r.month ? "selected" : ""}"><td>${esc(r.month)}${r.final_month_partial ? ' <span class="badge">Partial</span>' : ""}</td><td class="num ${tone(r.return_net)}">${signed(r.return_net)}</td><td class="num">${pct(r.return_gross)}</td><td class="num">${pct(r.month_end_drawdown_net)}</td>${["long_stocks","short_stocks"].map(key=>`<td class="num">${signed(legs.find(l=>l.leg===key)?.net_nav_contribution || 0)}</td>`).join("")}<td class="num">${r.two_way_turnover_nav.toFixed(2)}×</td></tr>`;
  }).join("")}</tbody></table></div>`;
  $("#main").innerHTML = heading("Performance, month by month.", "Calendar-month returns and drawdown, with long and short attribution.", download("monthly_performance.csv")) + `<div class="metrics">${metric("Maximum monthly drawdown",pct(S.monthly_max_drawdown),"Net · month-end observations",true)}${metric("Average monthly drawdown",pct(S.average_monthly_drawdown),"Arithmetic mean of month-end drawdowns")}${metric("Maximum daily drawdown",pct(S.daily_max_drawdown),"Net · daily valuation observations")}${metric("Total two-way turnover",`${S.turnover.toFixed(2)}×`,"Sum of traded notional / pretrade NAV")}</div>` + panel("Monthly drawdown", "Distance below the running month-end peak, including initial capital", lineChart(rows,series,{percent:true,id:"drawdown-chart",baseline:0}), "", false) + panel("Monthly record", "Leg contributions use each month’s opening NAV; turnover counts purchases and sales.", table, download("leg_returns_monthly.csv","Leg detail ↓"), false);
  bindChart("drawdown-chart",rows,series,true);
}
function paginate(rows, page, columns, renderRow, noun) {
  const pages = Math.max(1,Math.ceil(rows.length/25)), safePage = Math.min(page,pages-1), start=safePage*25;
  return {page:safePage, html:`<div class="table-wrap"><table class="data-table"><thead><tr>${columns.map(c=>`<th class="${c.num ? "num" : ""}">${c.html || esc(c.label)}</th>`).join("")}</tr></thead><tbody>${rows.slice(start,start+25).map(renderRow).join("") || `<tr><td colspan="${columns.length}" class="table-empty">No ${noun} match these filters.</td></tr>`}</tbody></table></div><div class="pagination"><span>${rows.length ? `${num(start+1)}–${num(Math.min(start+25,rows.length))} of ${num(rows.length)}` : "0"} ${noun}</span><div class="actions"><button class="small" data-page="previous" ${safePage===0 ? "disabled" : ""}>← Previous</button><button class="small" data-page="next" ${safePage===pages-1 ? "disabled" : ""}>Next →</button></div></div>`};
}
async function holdings(viewToken) {
  const rows = await load("holdings"); if(state.view!==viewToken) return;
  const months = [...new Set(rows.map(r=>r.date))].sort().reverse();
  $("#main").innerHTML=heading("Inside the portfolio.", "Actual month-end positions, including market drift and executed changes.", download("holdings_daily.csv","Daily holdings ↓"))+panel("Holdings explorer", "Select a month, then filter or sort the portfolio.", `<div class="filters"><label>Valuation date<select id="holding-month">${months.map(m=>option(m,date(m))).join("")}</select></label><label>Book<select id="holding-side">${option("all","Both books")}${option("long","Long")}${option("short","Short")}</select></label><label class="search-label">Search securities<input type="search" id="holding-search" placeholder="Ticker, company, sector or region"></label></div><div id="holding-table"></div>`,download("holdings_monthly.csv","Monthly CSV ↓"),false);
  let page=0, sortKey="signed_nav_weight", desc=true;
  function render() {
    const query=$("#holding-search").value.toLowerCase(), side=$("#holding-side").value;
    const filtered=rows.filter(r=>r.date===$("#holding-month").value && (side==="all" || r.side===side) && [r.security_id,r.name,r.sector,r.region].some(v=>String(v).toLowerCase().includes(query)));
    filtered.sort((a,b)=>(typeof a[sortKey]==="number" ? Math.abs(a[sortKey])-Math.abs(b[sortKey]) : String(a[sortKey]).localeCompare(String(b[sortKey])))*(desc ? -1 : 1));
    const cols=[{key:"security_id",label:"Security"},{key:"name",label:"Company"},{key:"side",label:"Book"},{key:"region",label:"Region"},{key:"sector",label:"Sector"},{key:"signed_nav_weight",label:"NAV weight",num:true},{key:"signed_notional_usd",label:"Notional USD",num:true}].map(c=>({...c,html:`<button data-sort="${c.key}">${c.label}${sortKey===c.key ? desc ? " ↓" : " ↑" : ""}</button>`}));
    const result=paginate(filtered,page,cols,r=>`<tr><td class="ticker">${esc(r.security_id)}</td><td class="name" title="${esc(r.name)}">${esc(r.name)}</td><td><span class="badge ${r.side==="short" ? "warn" : ""}">${esc(r.side)}</span></td><td>${esc(r.region.replaceAll("_"," "))}</td><td>${esc(r.sector)}</td><td class="num ${tone(r.signed_nav_weight)}">${pct(r.signed_nav_weight)}</td><td class="num">${money(r.signed_notional_usd)}</td></tr>`,"positions");
    page=result.page;$("#holding-table").innerHTML=result.html;
    $$('[data-sort]').forEach(b=>b.onclick=()=>{desc=b.dataset.sort===sortKey ? !desc : true;sortKey=b.dataset.sort;page=0;render();});
    $$('[data-page]').forEach(b=>b.onclick=()=>{page+=b.dataset.page==="next" ? 1 : -1;render();});
  }
  ["holding-month","holding-side","holding-search"].forEach(id=>document.getElementById(id).addEventListener(id==="holding-search" ? "input" : "change",()=>{page=0;render();})); render();
}
async function trades(viewToken) {
  const rows = await load("trades"); if(state.view!==viewToken) return;
  const months=[...new Set(rows.map(r=>r.date.slice(0,7)))].sort().reverse();
  $("#main").innerHTML=heading("Every executed change.", "Dated fills, signed notional and trading fees, from the backtest ledger.", download("trades.csv"))+`<div class="metrics">${metric("Executed trades",num(S.trade_count),`${S.valuation_sessions} valuation sessions`,true)}${metric("Two-way turnover",`${S.turnover.toFixed(2)}×`,"Cumulative traded notional / pretrade NAV")}${metric("Stock transaction fee",pct(R.strategy.stock_fee),"Applied per side on executed notional")}${metric("Total trading costs",money(S.transaction_cost),"Borrow charges are separate")}</div>`+panel("Trade ledger","Buy includes covering shorts; sell includes opening shorts. Directions are cash-flow actions.",`<div class="filters"><label>Month<select id="trade-month">${option("all","All months")}${months.map(m=>option(m)).join("")}</select></label><label>Direction<select id="trade-direction">${option("all","Buy & sell")}${option("buy","Buy")}${option("sell","Sell")}</select></label><label class="search-label">Search securities<input type="search" id="trade-search" placeholder="Ticker or company"></label></div><div id="trade-table"></div>`,"",false);
  let page=0;
  function render() {
    const month=$("#trade-month").value,direction=$("#trade-direction").value,query=$("#trade-search").value.toLowerCase();
    const filtered=rows.filter(r=>(month==="all" || r.date.startsWith(month))&&(direction==="all" || r.direction.toLowerCase()===direction)&&[r.instrument_id,r.name].some(v=>String(v).toLowerCase().includes(query))).sort((a,b)=>b.date.localeCompare(a.date));
    const cols=[{label:"Fill date"},{label:"Security"},{label:"Company"},{label:"Direction"},{label:"Notional USD",num:true},{label:"Trading fee",num:true},{label:"Reason"}];
    const result=paginate(filtered,page,cols,r=>`<tr><td title="Signal date: ${esc(r.decision_date)}">${esc(r.date)}</td><td class="ticker">${esc(r.instrument_id)}</td><td class="name" title="${esc(r.name)}">${esc(r.name)}</td><td>${esc(r.direction)}</td><td class="num">${money(r.signed_notional)}</td><td class="num">${money(r.transaction_cost,2)}</td><td>${esc(r.reason.replaceAll("_"," "))}</td></tr>`,"trades");
    page=result.page;$("#trade-table").innerHTML=result.html;
    $$('[data-page]').forEach(b=>b.onclick=()=>{page+=b.dataset.page==="next" ? 1 : -1;render();});
  }
  ["trade-month","trade-direction","trade-search"].forEach(id=>document.getElementById(id).addEventListener(id==="trade-search" ? "input" : "change",()=>{page=0;render();}));render();
}
function risk() {
  const strategy=R.strategy, policy=strategy.factor_policy;
  const factorTable=`<div class="table-wrap"><table class="data-table"><thead><tr><th>Region</th><th>Factor</th><th class="num">Realized exposure</th><th class="num">Target tolerance</th><th>Status</th></tr></thead><tbody>${R.factors.map(r=>`<tr><td>${esc(r.region.replaceAll("_"," "))}</td><td>${esc(r.factor)}</td><td class="num">${r.exposure == null ? "—" : r.exposure.toFixed(4)}</td><td class="num">${r.constrained ? `±${r.tolerance.toFixed(2)}` : "Unrestricted"}</td><td>${!r.constrained ? '<span class="caption">Unrestricted MOM</span>' : r.exposure == null ? '<span class="badge warn">Missing exposure</span>' : Math.abs(r.exposure)<=r.tolerance+1e-8 ? '<span class="badge">Within tolerance</span>' : '<span class="badge warn">Realized drift</span>'}</td></tr>`).join("")}</tbody></table></div>`;
  const methods=`<div class="details-grid">${fact("Portfolio",`${strategy.long_target} long / ${strategy.short_target} short names`)}${fact("Universe",`Top ${num(strategy.universe_size)} · four regions`)}${fact("Factor model",`Regional FF6 · ${strategy.factor_window} sessions`)}${fact("Selection", "50% alpha / 50% 12–1 price momentum")}${fact("Structure refresh", "Annual · September 30")}${fact("Allocation review", "Daily · conditional execution")}${fact("Long / short budget",`100% / ${pct(policy.short_nav_min,0)}–${pct(policy.short_nav_max,0)} of NAV`)}${fact("Issuer / sector caps", "15% / 40% of each book")}${fact("Covariance / ratio clipping",`${esc(strategy.covariance)} / ±${strategy.winsor_sigma}σ`)}${fact("Trading / borrow fees",`${pct(strategy.stock_fee)} per side / ${pct(strategy.borrow_rate,0)} p.a.`)}</div><p class="note">Names are ranked within annual spectral clusters using factor alpha and 12–1 price momentum, with momentum-sign retention. Daily reviews apply configured trade buffers and materiality thresholds; risk and membership changes can trigger trades. Regional MKT, SMB, HML, RMW and CMA exposures are constrained at optimized targets; MOM is unrestricted. Actual positions can drift or fill asynchronously.</p><p class="note"><strong>Factor data.</strong> ${esc(strategy.factor_source_policy)} ${S.continuous_record ? "This record preserves its original decisions and source vintages; a continuous execution replay matches the saved NAV and trades. The latest annual universe and clusters carry forward when a new annual ranking is unavailable." : ""}</p><details><summary>Inspect the complete resolved strategy</summary><pre>${esc(JSON.stringify(strategy,null,2))}</pre></details>`;
  $("#main").innerHTML=heading("Risk with its assumptions visible.","Gross-return risk estimates and realized exposures, alongside the construction rules.",download("risk_summary.csv"))+`<div class="two-col equal">${panel("Tail risk", "Estimated losses as a percentage of portfolio NAV, gross of explicit fees.", `<div class="filters" style="padding:0 0 12px"><label>Confidence<select id="risk-confidence">${option("0.95","95%")}${option("0.99","99%")}</select></label><label>Horizon<select id="risk-horizon">${option("1","1 session")}${option("10","10 sessions")}</select></label></div><div id="tail-risk"></div>`)}${panel("Drawdown & exposure", "Drawdown is net of costs; volatility and Sharpe are gross.",`${fact("Maximum monthly drawdown",pct(S.monthly_max_drawdown))}${fact("Average monthly drawdown",pct(S.average_monthly_drawdown))}${fact("Maximum daily drawdown",pct(S.daily_max_drawdown))}${fact("Annualized volatility / Sharpe",`${pct(S.gross_volatility)} / ${S.gross_sharpe.toFixed(2)}`)}${fact("Latest gross / net exposure",`${pct(S.gross_exposure,1)} / ${pct(S.net_exposure,1)}`)}`)}</div>`+panel("Sector concentration",`Latest holdings · percentages of each book, rather than total NAV`, `<div class="two-col equal">${["long","short"].map(side=>`<div><p class="eyebrow">${side} book</p>${R.sectors.filter(r=>r.side===side).map(r=>`<div class="leg"><div class="leg-title"><span>${esc(r.sector)}</span><span>${pct(r.book_fraction,1)}</span></div><div class="bar-track"><div class="bar-fill ${side==="short" ? "loss" : ""}" style="width:${r.book_fraction*100}%"></div></div></div>`).join("")}</div>`).join("")}</div><p class="caption">40% sector limit at optimized targets. Realized holdings may drift. Classification: Yahoo sectors.</p>`)+panel("Regional factor exposures",`Realized at ${date(R.exposure_date)} · estimation cutoff ${date(R.factor_estimation_cutoff)}`,factorTable,download("factor_exposures_daily.csv","Full history ↓"),false)+panel("How this portfolio is constructed","Settings from this run’s saved configuration.",methods)+panel("Data and research assumptions","Read these alongside the performance record.",`<ul class="assumptions">${strategy.assumptions.map(a=>`<li>${esc(a)}</li>`).join("")}</ul><p class="note">Internal checks validate the saved calculation and accounting; they are not an independent performance audit. Download the validation file for the detailed checks and observed drift.</p><p class="caption">Run identity</p><p class="run-id">${esc(S.run_id)}</p>`,download("validation.json","Validation ↓"));
  function tail() {
    const rows=R.tail_risk.filter(r=>r.confidence===Number($("#risk-confidence").value)&&r.horizon_sessions===Number($("#risk-horizon").value));
    $("#tail-risk").innerHTML=`<table class="data-table"><thead><tr><th>Method</th><th class="num">VaR</th><th class="num">ES</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.method.replaceAll("_"," "))}</td><td class="num">${pct(r.var)}</td><td class="num">${pct(r.es)}</td></tr>`).join("")}</tbody></table><p class="caption">VaR estimates a loss threshold; ES estimates the average loss beyond it. Calculated from the saved rolling risk sample.</p>`;
  }
  $("#risk-confidence").onchange=tail;$("#risk-horizon").onchange=tail;tail();
}
function files() {
  const groups=[...new Set(FILES.map(f=>f.category))];
  $("#main").innerHTML=heading("The complete research record.",`${FILES.length} individual records, plus a checksum catalog. CSVs open in Excel or Python.`,download("backtest-records.zip",`Download all · ${size(S.download_bytes)} ↓`,"button primary"))+`<div class="note-box"><strong>One run, one set of records.</strong> This download includes NAV, daily and month-end holdings, trades, target allocations, factor exposures, attribution, risk, settings and internal validation. Raw provider datasets and account credentials are not published. <a class="link" href="files/file_catalog.csv" download>Checksum catalog ↓</a></div>`+panel("File library","Search by filename or description, or narrow by category.",`<div class="filters"><label>Category<select id="file-category">${option("all","All categories")}${groups.map(g=>option(g)).join("")}</select></label><label class="search-label">Find a record<input id="file-search" type="search" placeholder="NAV, holdings, trades, factor exposures…"></label></div><div id="file-table"></div>`,"",false);
  function render() {
    const group=$("#file-category").value,query=$("#file-search").value.toLowerCase();
    const rows=FILES.filter(f=>(group==="all"||group===f.category)&&`${f.name} ${f.description}`.toLowerCase().includes(query));
    $("#file-table").innerHTML=`<div class="table-wrap"><table class="data-table"><thead><tr><th>File</th><th>Description</th><th class="num">Rows / size</th><th></th></tr></thead><tbody>${rows.map(f=>`<tr><td><div class="file-name">${esc(f.name)}</div><div class="caption">${esc(f.category)}</div></td><td class="file-desc">${esc(f.description)}</td><td class="num"><div>${f.rows==null ? "—" : num(f.rows)}</div><div class="file-size">${size(f.bytes)}</div></td><td>${download(f.name,"Download ↓","link")}</td></tr>`).join("")||'<tr><td colspan="4" class="table-empty">No files match your search.</td></tr>'}</tbody></table></div>`;
  }
  $("#file-search").oninput=render;$("#file-category").onchange=render;render();
}
async function route() {
  const requested=location.hash.slice(1), view=Object.hasOwn(names,requested) ? requested : "overview";
  state.view=view;$("#chart-tooltip").hidden=true;$("#breadcrumb").textContent=names[view];
  $$('[data-view]').forEach(a=>{if(a.dataset.view===view)a.setAttribute("aria-current","page");else a.removeAttribute("aria-current");});
  if(["holdings","trades","distribution"].includes(view))$("#main").innerHTML='<div class="loading">Loading portfolio records…</div>';
  await ({overview,performance,distribution,holdings,trades,risk,files}[view])(view);
}
function showError(error) {
  $("#main").innerHTML=`<div class="error"><h1>The records could not be loaded.</h1><p>${esc(error.message)}</p><p>Serve the built website with <code>python3 scripts/preview_backtest_site.py</code>, or refresh the published site.</p></div>`;
}
async function start() {
  [S,P,R,FILES]=await Promise.all([load("summary"),load("performance"),load("risk"),load("files")]);
  document.title=`${S.title} · Backtest explorer`;
  $("#asof").textContent=`Data through ${date(S.last_valuation)}`;
  addEventListener("hashchange",()=>route().catch(showError));
  await route();
}
start().catch(showError);
