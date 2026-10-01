const WS_URL='wss://api.derivws.com/trading/v1/options/ws/public';
const state={ws:null,markets:[],data:new Map(),signals:new Map(),tf:60,connected:false,timer:null,reqId:1};
const $=id=>document.getElementById(id);
$('tf').onchange=e=>{state.tf=+e.target.value;if(state.connected)refreshAll()};
$('filter').oninput=()=>{render();if(state.connected)refreshAll()};
$('connect').onclick=()=>state.connected?disconnect():connect();
function setStatus(s){$('status').textContent=s}
function nextReqId(){return state.reqId++}
function connect(){
  setStatus('Connecting…');
  try{state.ws=new WebSocket(WS_URL)}catch(e){setStatus('API failed: '+(e.message||'browser blocked connection'));return}
  state.timer=setTimeout(()=>{if(!state.connected){setStatus('API failed: connection timed out');try{state.ws.close()}catch(e){}}},10000);
  state.ws.onopen=()=>{
    clearTimeout(state.timer);
    state.connected=true;
    $('connect').textContent='Disconnect';
    setStatus('Live');
    request({active_symbols:'brief',req_id:nextReqId()});
  };
  state.ws.onmessage=e=>{try{onMsg(JSON.parse(e.data))}catch(err){setStatus('API failed: invalid server response')}};
  state.ws.onerror=()=>setStatus('API failed: WebSocket error');
  state.ws.onclose=()=>{state.connected=false;$('connect').textContent='Connect live data';if($('status').textContent==='Live')setStatus('Offline')};
}
function disconnect(){clearTimeout(state.timer);state.ws?.close();state.connected=false;state.data.clear();state.markets=[];state.signals.clear();$('marketCount').textContent='0';$('signalCount').textContent='0';$('lastScan').textContent='—';render()}
function request(x){if(state.ws?.readyState===1)state.ws.send(JSON.stringify(x))}
function onMsg(m){
  if(m.error){setStatus('API failed: '+(m.error.message||m.error.code||'request rejected'));return}
  if(m.msg_type==='active_symbols'){
    state.markets=(m.active_symbols||[]).map(x=>({symbol:x.underlying_symbol||x.symbol,name:x.underlying_symbol_name||x.display_name||x.symbol})).filter(x=>x.symbol);
    $('marketCount').textContent=state.markets.length;
    if(state.markets.length===0){setStatus('API failed: no markets returned');return}
    setStatus('Live');
    refreshAll();
    return;
  }
  if(m.msg_type==='history'){
    const sym=m.echo_req?.ticks_history||m.echo_req?.symbol||m.echo_req?.ticks;
    if(sym){state.data.set(sym,normalizeHistory(m));scan(sym)}
  }
  if(m.msg_type==='tick'){
    const sym=m.tick?.symbol;
    if(sym){const arr=state.data.get(sym)||[];arr.push({t:m.tick.epoch,p:+m.tick.quote});while(arr.length>2500)arr.shift();state.data.set(sym,arr);if(arr.length%3===0)scan(sym)}
  }
}
function normalizeHistory(m){if(m.candles)return m.candles.map(c=>({t:+c.epoch,o:+c.open,h:+c.high,l:+c.low,c:+c.close}));if(m.history?.prices)return m.history.prices.map((p,i)=>({t:(m.history.times||[])[i],p:+p}));return[]}
function refreshAll(){const markets=filteredMarkets().slice(0,40);for(const x of markets){request({ticks_history:x.symbol,count:500,end:'latest',style:'candles',granularity:state.tf,req_id:nextReqId()});request({ticks:x.symbol,subscribe:1,req_id:nextReqId()})}}
function filteredMarkets(){const q=$('filter').value.trim().toLowerCase();return state.markets.filter(x=>!q||(`${x.symbol} ${x.name}`).toLowerCase().includes(q))}
function sma(a,n){if(a.length<n)return null;let s=0;for(let i=a.length-n;i<a.length;i++)s+=a[i];return s/n}
function ema(a,n){if(a.length<n)return null;let e=sma(a.slice(0,n),n),k=2/(n+1);for(let i=n;i<a.length;i++)e=a[i]*k+e*(1-k);return e}
function rsi(a,n=14){if(a.length<n+1)return 50;let g=0,l=0;for(let i=a.length-n;i<a.length;i++){let d=a[i]-a[i-1];if(d>0)g+=d;else l-=d}if(l===0)return 100;let rs=(g/n)/(l/n);return 100-100/(1+rs)}
function atr(c,n=14){if(c.length<n+1)return null;let trs=[];for(let i=1;i<c.length;i++)trs.push(Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c)));return sma(trs,n)}
function macd(a){if(a.length<35)return{m:0,s:0};let fast=ema(a,12),slow=ema(a,26);let vals=[];for(let i=26;i<a.length;i++)vals.push(ema(a.slice(0,i+1),12)-ema(a.slice(0,i+1),26));return{m:fast-slow,s:ema(vals,9)||0}}
function candlesFromTicks(a){if(!a.length)return[];const bucket=state.tf;let out=[];for(const x of a){let b=Math.floor(x.t/bucket)*bucket,last=out[out.length-1];if(!last||last.t!==b)out.push({t:b,o:x.p,h:x.p,l:x.p,c:x.p});else{last.c=x.p;last.h=Math.max(last.h,x.p);last.l=Math.min(last.l,x.p)}}return out}
function scan(sym){let raw=state.data.get(sym)||[],c=raw[0]?.c!==undefined?raw:candlesFromTicks(raw);if(c.length<60)return;const closes=c.map(x=>x.c),last=c.at(-1),e20=ema(closes,20),e50=ema(closes,50),rs=rsi(closes),a=atr(c),mc=macd(closes);if(!e20||!e50||!a)return;let bull=0,bear=0,why=[];if(e20>e50){bull++;why.push('EMA20 above EMA50')}else{bear++;why.push('EMA20 below EMA50')}if(last.c>e20){bull++;why.push('price above EMA20')}else{bear++;why.push('price below EMA20')}if(rs>55){bull++;why.push('RSI bullish')}else if(rs<45){bear++;why.push('RSI bearish')}if(mc.m>mc.s){bull++;why.push('MACD bullish')}else if(mc.m<mc.s){bear++;why.push('MACD bearish')}const range=Math.max(last.h-last.l,1e-12),body=Math.abs(last.c-last.o);if(body/range>.6&&last.c>last.o){bull++;why.push('strong bullish candle')}if(body/range>.6&&last.c<last.o){bear++;why.push('strong bearish candle')}const score=Math.max(bull,bear)/5;let side='WAIT';if(bull>=4&&bull>bear)side='BUY';if(bear>=4&&bear>bull)side='SELL';const risk=a*1.25;let sl=side==='BUY'?last.c-risk:side==='SELL'?last.c+risk:null;let tp=side==='BUY'?last.c+risk*2:side==='SELL'?last.c-risk*2:null;state.signals.set(sym,{sym,side,price:last.c,sl,tp,score,rs,atr:a,why:why.slice(-4).join(' • '),time:last.t});$('signalCount').textContent=state.signals.size;$('lastScan').textContent=new Date().toLocaleTimeString();render()}
function render(){const q=$('filter').value.toLowerCase();const vals=[...state.signals.values()].filter(x=>!q||x.sym.toLowerCase().includes(q));vals.sort((a,b)=>b.score-a.score);$('signals').innerHTML=vals.slice(0,60).map(x=>{const cls=x.side.toLowerCase();return `<article class="card signal ${cls}"><div class="row"><span class="pair">${x.sym}</span><span class="pill">${x.side}</span></div><div class="price">${fmt(x.price)}</div><div class="levels"><div class="level"><div class="label">Entry</div><div class="value">${fmt(x.price)}</div></div><div class="level"><div class="label">Stop</div><div class="value">${x.sl?fmt(x.sl):'—'}</div></div><div class="level"><div class="label">Target</div><div class="value">${x.tp?fmt(x.tp):'—'}</div></div></div><div class="reason">${x.why}</div><div class="tiny" style="margin-top:8px">RSI ${x.rs.toFixed(1)} • ATR ${fmt(x.atr)} • confluence ${Math.round(x.score*100)}% • ${new Date(x.time*1000).toLocaleTimeString()}</div></article>`}).join('')||'<div class="card empty">No qualifying signals yet. WAIT is a valid result.</div>'}
function fmt(x){if(x==null)return'—';if(Math.abs(x)>=100)return x.toFixed(2);if(Math.abs(x)>=1)return x.toFixed(5);return x.toFixed(6)}
