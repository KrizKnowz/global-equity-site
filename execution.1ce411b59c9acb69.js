/* Read-only replay of the audited backtest's saved fills, costs and account. */
"use strict";
function backtestOrderTicket(trade, input={}) {
  const plan=trade.plan;
  if(!plan?.available)return {available:false,reason:plan?.reason || 'Saved reference inputs are unavailable. Rebuild the report.'};
  const manual=input.market_price!=null && String(input.market_price).trim()!=='';
  const price=manual?Number(input.market_price):Number(plan.reference_price),fx=Number(plan.usd_per_unit),buffer=Number(plan.buffer_bps);
  if(![price,fx,buffer].every(Number.isFinite) || Math.min(price,fx)<=0 || buffer<0 || buffer>=10000)throw new Error('Enter a positive latest price.');
  const limit=price*(1+(trade.signed_notional>0?1:-1)*buffer/10000);
  const shares=trade.absolute_notional/(price*fx);
  return {available:true,shares,limit_price:limit,currency:plan.currency,reference_price:price,
    market_price:manual?price:null,buffer_bps:buffer,usd_per_unit:fx,
    price_basis:manual?'manual_price':'adjusted_model_reference',
    reference_value_usd:shares*price*fx,limit_value_usd:shares*limit*fx};
}
function replayAccount(row, completed) {
  const positions=new Map(row.holdings.map(([id,value,name])=>[id,{id,name,value}]));
  if(!completed)for(const fill of row.trades){
    const holding=positions.get(fill.instrument_id) || {id:fill.instrument_id,name:fill.name,value:0};
    holding.value-=fill.signed_notional;positions.set(holding.id,holding);
  }
  const active=[...positions.values()].filter(p=>Math.abs(p.value)>1e-6);
  const cash=completed?row.cash:row.cash_before_execution;
  const nav=completed?row.nav:row.nav_before_execution;
  return {positions:active, cash, nav, long:active.reduce((s,p)=>s+Math.max(p.value,0),0),
    short:active.reduce((s,p)=>s-Math.min(p.value,0),0),
    difference:cash+active.reduce((s,p)=>s+p.value,0)-nav};
}
async function execution(viewToken) {
  if(globalThis.executionWorkspace?.mode==='reported')return executionWorkspace.render(viewToken);
  const data=await load('execution');if(state.view!==viewToken)return;
  const tabs=globalThis.executionWorkspace?.tabs() || '';
  if(!data.available){
    $('#main').innerHTML=tabs+heading('Execution','Ideal execution using the saved backtest account.')+`<div class="note-box">${esc(data.reason || 'Rebuild the report to enable execution replay.')}</div>`;
    globalThis.executionWorkspace?.bindTabs();return;
  }
  const rows=data.rows;
  let index=rows.findIndex(r=>r.date===state.executionDate);
  if(index<0)index=rows.length-1;
  let completed=true;
  const tickets=new Map(rows.flatMap(r=>r.trades.map((t,i)=>[`${r.date}:${i}`,backtestOrderTicket(t)])));let selectedOrder=0;
  const sharesText=value=>Number(value).toLocaleString('en-US',{maximumFractionDigits:6});
  const priceText=(value,currency)=>`${esc(currency)} ${Number(value).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:6})}`;
  $('#main').innerHTML=tabs+heading('Execution','Follow the daily orders through their simulated fills and into the backtest account.',download('trades.csv','All backtest trades ↓'))+
    panel('Ideal case · backtest execution','The saved execution dates, trade amounts and costs reproduce the published backtest.',
      `<div class="distribution-controls"><div class="actions"><button class="button" id="replay-prev" aria-label="Previous execution day">←</button><label>Execution date<select id="replay-date">${rows.map((r,i)=>option(i,date(r.date))).join('')}</select></label><button class="button" id="replay-next" aria-label="Next execution day">→</button></div><a class="button" id="replay-distribution" href="#distribution">View this day’s distribution ↗</a></div><div class="replay-stage" role="group" aria-label="Execution stage"><button class="button" id="replay-before">Before execution</button><button class="button primary" id="replay-fill">Apply saved fills</button><span id="replay-status" class="badge" aria-live="polite"></span></div>`)+
    '<div id="replay-account" aria-live="polite"></div>'+panel('Daily trade plan','Shares and limit prices are calculated automatically from the saved reference prices and FX.',
      '<div id="replay-plan-summary" class="note-box"></div><div id="replay-orders"></div><p class="note">Fractional share estimates use the model’s adjusted reference prices. No lot or price-step rounding is applied.</p>', `<div class="actions">${download('execution_plans_daily.csv','All daily plans ↓')}<button class="button" id="replay-download">Selected day CSV ↓</button></div>`)+
    panel('Update a price · optional','The plan is ready. Enter a latest local price only if you want to update an estimate.',
      '<div id="replay-ticket"></div>')+
    '<details><summary>Portfolio & cash details</summary><div id="replay-holdings"></div></details>'+
    `<details class="distribution-method"><summary>How this connects to the backtest</summary><p class="note">This replays saved simulated fills in USD total-return notionals. Local reference price × saved USD FX gives the USD price; order USD ÷ USD price gives fractional model-share equivalents. Converting shares × local price back to USD reproduces each saved trade amount. References are historical execution-day marks, not prices known at the earlier decision cutoff. These adjusted series can differ from broker quotes and do not reconstruct raw historical share fills.</p><p class="note">An optional latest local price recalculates the estimated shares and suggested limit while preserving the USD order budget and saved FX. It does not change historical fills, costs or NAV. Limits allow 0.30% adverse movement from the price used for the estimate; a limit is a price boundary, not an assumed fill. Actual executions at a different price can differ from the backtest.</p><p class="note">Market P&L, interest, borrowing costs and corporate-action settlements are reflected before execution. Applying saved fills produces the same closing holdings, cash and NAV. The saved closing queue also includes new orders for later sessions. Recorded broker fills and local accounts remain separate.</p></details>`;
  function render(next, after=true){
    index=Math.max(0,Math.min(rows.length-1,Number(next)));completed=after;
    const row=rows[index], account=replayAccount(row,completed);
    state.executionDate=row.date;state.distributionDate=row.date;
    $('#asof').textContent=`Backtest execution · ${date(row.date)}`;
    $('#replay-date').value=String(index);$('#replay-prev').disabled=index===0;$('#replay-next').disabled=index===rows.length-1;
    $('#replay-distribution').href=`#distribution?date=${row.date}`;
    $('#replay-before').className=`button ${completed?'':'primary'}`;
    $('#replay-fill').className=`button ${completed?'primary':''}`;
    $('#replay-fill').disabled=completed || !row.trades.length;
    $('#replay-status').textContent=!row.trades.length?'No saved trades this day':completed?`${row.trades.length} simulated fills applied`:'Ready to replay saved fills';
    const fees=completed?row.transaction_cost:0;
    const buys=row.trades.reduce((s,t)=>s+Math.max(t.signed_notional,0),0), sells=row.trades.reduce((s,t)=>s-Math.min(t.signed_notional,0),0);
    const difference=Math.abs(account.difference)<.005?0:account.difference;
    $('#replay-account').innerHTML=`<div class="metrics">${metric(completed?'Closing NAV':'NAV before execution',money(account.nav,2),'USD · same-day valuation marks',true)}${metric('Saved order notional',money(buys+sells),`Buy ${money(buys)} · Sell ${money(sells)}`)}${metric('Transaction fees applied',money(fees,2),completed?'Recorded backtest costs':'Applied when saved fills are replayed')}${metric('Long / short exposure',`${pct(account.long/account.nav,1)} / ${pct(account.short/account.nav,1)}`,'Signed holdings marked in USD')}</div><div class="note-box"><strong>${completed?'Matches saved closing NAV':'Matches saved pre-execution NAV'}</strong> · Difference ${money(difference,2)}. ${row.pending_instruments?`Saved closing order queue: ${num(row.pending_instruments)} instruments, including orders from the after-close review for later sessions.`:'The saved closing order queue is empty.'}</div>`;
    const dayTickets=row.trades.map((t,i)=>tickets.get(`${row.date}:${i}`)),ready=dayTickets.filter(t=>t.available);
    const planned=ready.reduce((sum,t)=>sum+t.reference_value_usd,0),planDifference=planned-buys-sells;
    $('#replay-plan-summary').innerHTML=ready.length===row.trades.length?`<strong>${row.trades.length} orders planned automatically</strong> · Planned USD ${money(planned,2)} · Difference from backtest orders ${money(Math.abs(planDifference)<.005?0:planDifference,2)}.`:`${ready.length} of ${row.trades.length} orders planned. Missing reference inputs are shown below.`;
    $('#replay-orders').innerHTML=row.trades.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>Stock</th><th>Action</th><th>Order USD</th><th>Shares (est.)</th><th>Price used</th><th>Limit price</th><th></th></tr></thead><tbody>${row.trades.map((t,i)=>{const ticket=dayTickets[i];return `<tr><td><strong>${esc(t.instrument_id)}</strong><br><span class="caption">${esc(t.name)}</span></td><td>${t.signed_notional>0?'Buy / cover':'Sell / short'}<br><span class="badge">${completed?'Simulated fill':'Ready'}</span></td><td>${money(t.absolute_notional,2)}</td><td>${ticket.available?sharesText(ticket.shares):'Reference missing'}</td><td>${ticket.available?`${priceText(ticket.reference_price,ticket.currency)}<br><span class="caption">${ticket.market_price===null?'Saved reference':'Manual price'}</span>`:'—'}</td><td>${ticket.available?`${priceText(ticket.limit_price,ticket.currency)}<br><span class="caption">${t.signed_notional>0?'Maximum buy':'Minimum sell'}</span>`:'—'}</td><td><button class="button" id="replay-plan-${i}">Update price</button></td></tr>`;}).join('')}</tbody></table></div>`:'<p class="note">No executed trades were saved for this date. Holdings continue to reflect market movements and the backtest’s existing trading thresholds.</p>';
    row.trades.forEach((t,i)=>{$(`#replay-plan-${i}`).onclick=()=>{selectedOrder=i;renderTicket();$('#replay-ticket')?.scrollIntoView?.({behavior:'smooth',block:'center'});};});
    if(selectedOrder>=row.trades.length)selectedOrder=0;
    renderTicket();
    const holdings=account.positions.sort((a,b)=>Math.abs(b.value)-Math.abs(a.value));
    $('#replay-holdings').innerHTML=`<div class="replay-balances"><span>Cash <strong>${money(account.cash,2)}</strong></span><span>Positions <strong>${num(holdings.length)}</strong></span><span>Borrow cost already accrued <strong>${money(row.borrow_cost,2)}</strong></span></div>${row.settlements.length?`<p class="note">Corporate-action cash settlements: ${row.settlements.map(s=>`${esc(s.instrument_id)} ${money(s.signed_cash_received,2)}`).join(' · ')}. These transfers are already in pre-execution cash and are not market trades.</p>`:''}<details><summary>View ${completed?'closing':'pre-execution'} holdings</summary><div class="table-wrap"><table class="data-table"><thead><tr><th>Security</th><th>Name</th><th>Signed value USD</th><th>Weight of NAV</th></tr></thead><tbody>${holdings.map(p=>`<tr><td>${esc(p.id)}</td><td>${esc(p.name)}</td><td>${money(p.value,2)}</td><td>${pct(p.value/account.nav)}</td></tr>`).join('')}</tbody></table></div></details>`;
  }
  function renderTicket(){
    const row=rows[index],trade=row.trades[selectedOrder];
    if(!trade){$('#replay-ticket').innerHTML='<p class="note">No order needs a share plan on this date.</p>';return;}
    const saved=tickets.get(`${row.date}:${selectedOrder}`);
    if(!saved.available){$('#replay-ticket').innerHTML=`<p class="note">${esc(trade.instrument_id)}: ${esc(saved.reason)}</p>`;return;}
    $('#replay-ticket').innerHTML=`<p><strong>${trade.signed_notional>0?'BUY':'SELL'} ${esc(trade.instrument_id)}</strong> · ${money(trade.absolute_notional,2)} order · Saved price ${priceText(trade.plan.reference_price,saved.currency)}</p><form id="replay-ticket-form" class="replay-ticket-form">
      <label>Latest local price (${esc(saved.currency)}, optional)<input name="market_price" value="${saved.market_price??''}" type="number" min="0.000001" step="any" placeholder="Use saved reference"></label>
      <button class="button primary" type="submit">Update estimate</button><button class="button" type="button" id="replay-reset-price">Use saved price</button></form>
      <div id="replay-ticket-result" class="note-box" aria-live="polite">${ticketText(saved,trade)}</div><p class="note">FX is handled automatically. A new price updates shares and limit, keeping the USD order amount fixed. Enter ${esc(saved.currency)} per share${saved.currency==='GBP'?' (pounds, not pence)':''}. Estimates do not change historical results.</p>${globalThis.executionWorkspace?'<button class="button" id="replay-record-fill">Go to order plan & record fills →</button>':''}`;
    $('#replay-ticket-form').onsubmit=e=>{e.preventDefault();const values=Object.fromEntries(new FormData($('#replay-ticket-form')));try{tickets.set(`${row.date}:${selectedOrder}`,backtestOrderTicket(trade,values));render(index,completed);}catch(error){$('#replay-ticket-result').textContent=error.message;}};
    $('#replay-reset-price').onclick=()=>{tickets.set(`${row.date}:${selectedOrder}`,backtestOrderTicket(trade));render(index,completed);};
    if($('#replay-record-fill'))$('#replay-record-fill').onclick=()=>{executionWorkspace.mode='reported';return executionWorkspace.render('execution');};
  }
  function ticketText(ticket,trade){
    return `<strong>${trade.signed_notional>0?'Buy':'Sell'} ${sharesText(ticket.shares)} estimated shares</strong> · ${trade.signed_notional>0?'maximum':'minimum'} ${priceText(ticket.limit_price,ticket.currency)}. ${ticket.market_price===null?'Planned from the saved reference.':'Updated using your entered price.'} Value at this price: ${money(ticket.reference_value_usd,2)}.`;
  }
  $('#replay-prev').onclick=()=>render(index-1);$('#replay-next').onclick=()=>render(index+1);
  $('#replay-date').onchange=e=>render(e.target.value);$('#replay-before').onclick=()=>render(index,false);$('#replay-fill').onclick=()=>render(index,true);
  $('#replay-download').onclick=()=>{
    const row=rows[index], fields=['execution_date','decision_date','instrument_id','side','signed_order_usd','filled_usd','transaction_cost_usd','status','estimated_shares','suggested_limit','limit_currency','price_used','usd_per_unit','price_basis','planned_value_usd','difference_usd'];
    const csv=[fields,...row.trades.map((t,i)=>{const ticket=tickets.get(`${row.date}:${i}`);return [row.date,t.decision_date,t.instrument_id,t.signed_notional>0?'buy':'sell',t.signed_notional,completed?t.absolute_notional:0,completed?t.transaction_cost:0,completed?'simulated_fill':'ready',ticket?.shares,ticket?.limit_price,ticket?.currency,ticket?.reference_price,ticket?.usd_per_unit,ticket?.price_basis,ticket?.reference_value_usd,ticket.available?ticket.reference_value_usd-t.absolute_notional:null];})].map(values=>values.map(v=>{let s=String(v??'');if(typeof v==='string' && /^[=+@-]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}).join(',')).join('\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})), a=document.createElement('a');a.href=url;a.download=`ideal_execution_${row.date}_${completed?'filled':'before'}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  globalThis.executionWorkspace?.bindTabs();render(index);
}
