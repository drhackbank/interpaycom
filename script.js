/* ═══════════════════════════════════════════════════════════════
   InterPayCom — script.js v3.0
   PayPal-only real payment gateway
   GitHub Pages → Vercel API backend
═══════════════════════════════════════════════════════════════ */
'use strict';

/* ── CONFIG — Set your Vercel API URL here ────────────────── */
const API_URL = 'https://interpaycom-api.vercel.app';

/* ── Secure auth ──────────────────────────────────────────── */
const _IH = 'fc5669b52ce4e283ad1d5d182de88ff9faec6672bace84ac2ce4c083f54fe2bc';
const _PH = '7419efbb48f3629e027dbf9aa78d11fa28a0c1150817f6fa7c92b9c3c635bfed';
async function _sha(s){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));return Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,'0')).join('');}

/* ── State ────────────────────────────────────────────────── */
let currencies=[], selCurr={code:'USD',symbol:'$',flag:'🇺🇸',rate:1,name:'US Dollar'};
let curAmount=0, _ppLoaded=false, _ppClientId='', _payInit=false;
let _tries=0, _lockUntil=0;
const g=id=>document.getElementById(id);

/* PayPal does not support these currencies — use USD for PayPal */
const PP_UNSUPPORTED=['INR','PKR','BDT','NPR','LKR','VND','NGN','KES','GHS','MMK'];

/* ═══════════════════════════════════════════════════════════════
   PARTICLES
═══════════════════════════════════════════════════════════════ */
function initParticles(){
  const canvas=g('particle-canvas');
  if(!canvas||!canvas.getContext) return;
  const ctx=canvas.getContext('2d');
  let W=window.innerWidth, H=window.innerHeight;
  canvas.width=W; canvas.height=H;
  window.addEventListener('resize',()=>{W=window.innerWidth;H=window.innerHeight;canvas.width=W;canvas.height=H;});

  const particles=Array.from({length:60},()=>({
    x:Math.random()*W, y:Math.random()*H,
    r:Math.random()*1.5+0.5,
    vx:(Math.random()-.5)*.3, vy:(Math.random()-.5)*.3,
    a:Math.random()*.6+.1,
  }));

  function draw(){
    ctx.clearRect(0,0,W,H);
    particles.forEach(p=>{
      p.x+=p.vx; p.y+=p.vy;
      if(p.x<0)p.x=W; if(p.x>W)p.x=0;
      if(p.y<0)p.y=H; if(p.y>H)p.y=0;
      ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
      ctx.fillStyle=`rgba(0,112,243,${p.a})`;ctx.fill();
    });
    // Connection lines
    for(let i=0;i<particles.length;i++){
      for(let j=i+1;j<particles.length;j++){
        const d=Math.hypot(particles[i].x-particles[j].x,particles[i].y-particles[j].y);
        if(d<120){
          ctx.beginPath();
          ctx.moveTo(particles[i].x,particles[i].y);
          ctx.lineTo(particles[j].x,particles[j].y);
          ctx.strokeStyle=`rgba(0,112,243,${.15*(1-d/120)})`;
          ctx.lineWidth=.5;ctx.stroke();
        }
      }
    }
    requestAnimationFrame(draw);
  }
  draw();
}

/* ═══════════════════════════════════════════════════════════════
   AUTH
═══════════════════════════════════════════════════════════════ */
function _locked(){
  if(_lockUntil>Date.now()){
    const s=Math.ceil((_lockUntil-Date.now())/1000);
    showLErr(`<i class="ti ti-clock" aria-hidden="true"></i>&nbsp;Too many attempts. Try again in ${s}s`);
    return true;
  }return false;
}
async function doLogin(){
  if(_locked())return;
  const idv=(g('lid')?.value||'').trim(),pw=g('lpw')?.value||'';
  const spin=g('lf-spin'),icon=g('lf-icon'),txt=g('lf-btntxt'),btn=g('lf-btn');
  clearLErr();spin.classList.add('on');icon.style.display='none';txt.textContent='Authorizing…';btn.disabled=true;
  const[ih,ph]=await Promise.all([_sha(idv),_sha(pw)]);
  setTimeout(()=>{
    spin.classList.remove('on');icon.style.display='';txt.textContent='Access Gateway';btn.disabled=false;
    if(ih===_IH&&ph===_PH){
      _tries=0;sessionStorage.setItem('ipc_ok','1');
      g('scr-login').classList.remove('active');
      g('scr-main').classList.add('active');
      initApp();
    }else{
      _tries++;if(_tries>=3){_lockUntil=Date.now()+30000;_tries=0;}
      showLErr('<i class="ti ti-alert-triangle" aria-hidden="true"></i>&nbsp;Invalid credentials. Please try again.');
      ['lid','lpw'].forEach(id=>g(id)?.classList.add('err'));
    }
  },1500);
}
function doLogout(){
  sessionStorage.removeItem('ipc_ok');
  g('scr-main').classList.remove('active');g('scr-login').classList.add('active');
  ['lid','lpw'].forEach(id=>{if(g(id)){g(id).value='';g(id).classList.remove('err');}});
  clearLErr();_payInit=false;_ppLoaded=false;
}
function togglePw(){const i=g('lpw'),ic=g('pw-eye');const h=i.type==='password';i.type=h?'text':'password';ic.className=h?'ti ti-eye-off':'ti ti-eye';}
function showLErr(html){const e=g('lf-err');e.innerHTML=html;e.classList.add('show');}
function clearLErr(){g('lf-err')?.classList.remove('show');['lid','lpw'].forEach(id=>g(id)?.classList.remove('err'));}

/* ═══════════════════════════════════════════════════════════════
   CURRENCIES
═══════════════════════════════════════════════════════════════ */
const FALLBACK=[
  {code:'USD',name:'US Dollar',symbol:'$',flag:'🇺🇸',rate:1,popular:true},
  {code:'EUR',name:'Euro',symbol:'€',flag:'🇪🇺',rate:.92,popular:true},
  {code:'GBP',name:'British Pound',symbol:'£',flag:'🇬🇧',rate:.79,popular:true},
  {code:'INR',name:'Indian Rupee',symbol:'₹',flag:'🇮🇳',rate:83.5,popular:true},
  {code:'AUD',name:'Australian Dollar',symbol:'A$',flag:'🇦🇺',rate:1.53,popular:true},
  {code:'CAD',name:'Canadian Dollar',symbol:'C$',flag:'🇨🇦',rate:1.36,popular:true},
  {code:'SGD',name:'Singapore Dollar',symbol:'S$',flag:'🇸🇬',rate:1.34,popular:true},
  {code:'AED',name:'UAE Dirham',symbol:'AED',flag:'🇦🇪',rate:3.67,popular:true},
  {code:'JPY',name:'Japanese Yen',symbol:'¥',flag:'🇯🇵',rate:149.5,popular:true},
  {code:'CHF',name:'Swiss Franc',symbol:'CHF',flag:'🇨🇭',rate:.89,popular:true},
  {code:'SAR',name:'Saudi Riyal',symbol:'SAR',flag:'🇸🇦',rate:3.75,popular:false},
  {code:'KWD',name:'Kuwaiti Dinar',symbol:'KD',flag:'🇰🇼',rate:.308,popular:false},
  {code:'QAR',name:'Qatari Riyal',symbol:'QAR',flag:'🇶🇦',rate:3.64,popular:false},
  {code:'MYR',name:'Malaysian Ringgit',symbol:'RM',flag:'🇲🇾',rate:4.72,popular:false},
  {code:'THB',name:'Thai Baht',symbol:'฿',flag:'🇹🇭',rate:35.1,popular:false},
  {code:'HKD',name:'Hong Kong Dollar',symbol:'HK$',flag:'🇭🇰',rate:7.82,popular:false},
  {code:'NZD',name:'New Zealand Dollar',symbol:'NZ$',flag:'🇳🇿',rate:1.63,popular:false},
  {code:'BRL',name:'Brazilian Real',symbol:'R$',flag:'🇧🇷',rate:5.0,popular:false},
  {code:'MXN',name:'Mexican Peso',symbol:'$',flag:'🇲🇽',rate:17.1,popular:false},
  {code:'ZAR',name:'South African Rand',symbol:'R',flag:'🇿🇦',rate:18.6,popular:false},
  {code:'PKR',name:'Pakistani Rupee',symbol:'₨',flag:'🇵🇰',rate:279,popular:false},
  {code:'BDT',name:'Bangladeshi Taka',symbol:'৳',flag:'🇧🇩',rate:110,popular:false},
  {code:'EGP',name:'Egyptian Pound',symbol:'EGP',flag:'🇪🇬',rate:30.9,popular:false},
  {code:'TRY',name:'Turkish Lira',symbol:'₺',flag:'🇹🇷',rate:30.7,popular:false},
  {code:'PLN',name:'Polish Zloty',symbol:'zł',flag:'🇵🇱',rate:4.01,popular:false},
  {code:'SEK',name:'Swedish Krona',symbol:'kr',flag:'🇸🇪',rate:10.4,popular:false},
  {code:'NOK',name:'Norwegian Krone',symbol:'kr',flag:'🇳🇴',rate:10.6,popular:false},
  {code:'ILS',name:'Israeli Shekel',symbol:'₪',flag:'🇮🇱',rate:3.68,popular:false},
  {code:'KRW',name:'South Korean Won',symbol:'₩',flag:'🇰🇷',rate:1330,popular:false},
  {code:'IDR',name:'Indonesian Rupiah',symbol:'Rp',flag:'🇮🇩',rate:15650,popular:false},
  {code:'PHP',name:'Philippine Peso',symbol:'₱',flag:'🇵🇭',rate:56.1,popular:false},
  {code:'NGN',name:'Nigerian Naira',symbol:'₦',flag:'🇳🇬',rate:1580,popular:false},
  {code:'KES',name:'Kenyan Shilling',symbol:'KSh',flag:'🇰🇪',rate:129,popular:false},
  {code:'GHS',name:'Ghanaian Cedi',symbol:'₵',flag:'🇬🇭',rate:12.3,popular:false},
];
async function loadRates(){
  try{const r=await fetch(`${API_URL}/rates`);const d=await r.json();if(d.currencies)currencies=d.currencies;else currencies=FALLBACK;}
  catch{currencies=FALLBACK;}
}
function renderList(filter=''){
  const el=g('curr-list'),low=filter.toLowerCase();
  const pop=currencies.filter(c=>c.popular&&(!low||c.code.toLowerCase().includes(low)||c.name.toLowerCase().includes(low)));
  const oth=currencies.filter(c=>!c.popular&&(!low||c.code.toLowerCase().includes(low)||c.name.toLowerCase().includes(low)));
  let html=pop.map(ci).join('');
  if(oth.length&&!low)html+='<div class="curr-sep"></div><div class="curr-section-lbl">All currencies</div>';
  html+=oth.map(ci).join('');
  el.innerHTML=html||'<div style="padding:16px;text-align:center;font-size:12px;color:var(--t4)">No results</div>';
}
function ci(c){
  const s=c.code===selCurr.code?'sel':'';
  const r=c.rate?`1 USD = ${c.rate<1?c.rate.toFixed(3):c.rate>999?Math.round(c.rate):c.rate.toFixed(2)} ${c.code}`:'';
  const pp=PP_UNSUPPORTED.includes(c.code)?'<span style="font-size:9px;color:var(--t4);margin-left:4px">(via USD)</span>':'';
  return `<div class="curr-item ${s}" onclick="pickCurr('${c.code}')"><span class="ci-flag">${c.flag}</span><div class="ci-info"><div class="ci-code">${c.code}${pp}</div><div class="ci-name">${c.name}</div></div><div class="ci-rate">${r}</div></div>`;
}
function openCurr(){g('curr-btn').classList.add('open');g('curr-dd').classList.add('open');g('curr-chev').style.transform='rotate(180deg)';setTimeout(()=>g('curr-search')?.focus(),50);}
function closeCurr(){g('curr-btn')?.classList.remove('open');g('curr-dd')?.classList.remove('open');if(g('curr-chev'))g('curr-chev').style.transform='';}
function filterCurr(v){renderList(v);}
function pickCurr(code){
  const c=currencies.find(x=>x.code===code);if(!c)return;
  selCurr=c;g('curr-flag').textContent=c.flag;g('curr-code').textContent=c.code;g('amt-sym').textContent=c.symbol;
  // Show PayPal note for unsupported currencies
  const note=g('pp-curr-note');
  if(note) note.style.display=PP_UNSUPPORTED.includes(c.code)?'flex':'none';
  renderList(g('curr-search')?.value||'');closeCurr();updateQuickBtns();onAmountChange();updateSummary();
  if(_ppClientId) reloadPayPal();
}

/* ═══════════════════════════════════════════════════════════════
   AMOUNT
═══════════════════════════════════════════════════════════════ */
function onAmountChange(){
  const v=parseFloat(g('amt-input')?.value)||0;curAmount=v;
  const el=g('inr-equiv');
  if(v>0&&selCurr.code!=='INR'){
    const ir=(currencies.find(x=>x.code==='INR')?.rate||83.5);
    el.textContent=`≈ ₹${((v/selCurr.rate)*ir).toLocaleString('en-IN',{maximumFractionDigits:2})} INR`;
  }else el.textContent='';
  updateSummary();
}
function updateSummary(){
  const a=curAmount,c=selCurr;
  g('os-amount').textContent=a>0?`${c.symbol}${a.toFixed(2)}`:'—';
  g('os-curr').textContent=`${c.code} — ${c.name}`;
  g('os-total').textContent=a>0?`${c.symbol}${a.toFixed(2)} ${c.code}`:'—';
  // Show PayPal amount if currency unsupported
  const ppEl=g('os-pp-amt');
  if(ppEl&&a>0&&PP_UNSUPPORTED.includes(c.code)){
    const usd=(a/c.rate).toFixed(2);
    ppEl.textContent=`PayPal will charge: $${usd} USD`;ppEl.style.display='block';
  }else if(ppEl){ppEl.style.display='none';}
}
function setQuick(usd){const v=parseFloat((usd*selCurr.rate).toFixed(2));g('amt-input').value=v;curAmount=v;onAmountChange();}
function updateQuickBtns(){
  const base=[50,100,250,500,1000];
  document.querySelectorAll('.qbtn').forEach((btn,i)=>{
    const v=base[i]*selCurr.rate;const d=v>=1000?Math.round(v).toLocaleString():v.toFixed(v<1?2:0);
    btn.textContent=`${selCurr.symbol}${d}`;btn.onclick=()=>setQuick(base[i]);
  });
}

/* ═══════════════════════════════════════════════════════════════
   VALIDATION
═══════════════════════════════════════════════════════════════ */
function validate(){
  const amt=parseFloat(g('amt-input')?.value||0);
  const email=(g('payer-email')?.value||'').trim();
  if(!amt||amt<=0){showMsg('err','Please enter a valid payment amount.');return false;}
  if(amt<1){showMsg('err',`Minimum amount is 1 ${selCurr.code}.`);return false;}
  if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){showMsg('err','Please enter a valid email address.');return false;}
  return true;
}

/* ═══════════════════════════════════════════════════════════════
   PAYPAL — REAL CHARGING
═══════════════════════════════════════════════════════════════ */
async function loadPayPalSDK(){
  if(g('pp-loading'))g('pp-loading').style.display='flex';
  if(g('pp-buttons'))g('pp-buttons').innerHTML='';
  try{
    const r=await fetch(`${API_URL}/paypal/order`,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({_ping:true})
    });
    const d=await r.json();
    if(!d.clientId||d.clientId.length<8){
      g('pp-loading').innerHTML='<span style="color:var(--err);font-size:12px;text-align:center;line-height:1.8">PayPal not configured.<br/><small>Add PAYPAL_CLIENT_ID in Vercel environment variables, then redeploy.</small></span>';
      return;
    }
    _ppClientId=d.clientId;
    injectPPSDK(d.clientId);
  }catch(e){
    if(g('pp-loading'))g('pp-loading').innerHTML='<span style="color:var(--err);font-size:12px;text-align:center;line-height:1.8">Cannot reach payment server.<br/><small>Check API_URL in script.js</small></span>';
  }
}

function injectPPSDK(clientId){
  const old=document.getElementById('pp-sdk');if(old)old.remove();
  _ppLoaded=false;
  const ppCurr=PP_UNSUPPORTED.includes(selCurr.code)?'USD':selCurr.code;
  const s=document.createElement('script');s.id='pp-sdk';
  s.src=`https://www.paypal.com/sdk/js?client-id=${clientId}&currency=${ppCurr}&intent=capture&components=buttons`;
  s.onload=()=>{_ppLoaded=true;renderPayPalButtons();};
  s.onerror=()=>{
    if(g('pp-loading'))g('pp-loading').innerHTML='<span style="color:var(--err);font-size:12px">PayPal SDK failed to load. Check your Client ID.</span>';
  };
  document.head.appendChild(s);
}

function reloadPayPal(){
  if(!_ppClientId)return;
  _ppLoaded=false;
  const old=document.getElementById('pp-sdk');if(old)old.remove();
  if(g('pp-loading'))g('pp-loading').style.display='flex';
  if(g('pp-buttons'))g('pp-buttons').innerHTML='';
  injectPPSDK(_ppClientId);
}

function renderPayPalButtons(){
  if(!g('pp-loading')||!g('pp-buttons'))return;
  g('pp-loading').style.display='none';
  if(!window.paypal){
    g('pp-buttons').innerHTML='<p style="color:var(--err);font-size:12px;text-align:center">PayPal could not be loaded.</p>';
    return;
  }
  g('pp-buttons').innerHTML='';
  window.paypal.Buttons({
    style:{layout:'vertical',color:'gold',shape:'pill',label:'pay',height:48},
    createOrder:async()=>{
      clearMsg();if(!validate())throw new Error('Validation failed');
      showMsg('info','Creating secure payment order…');
      const rawAmt=parseFloat(g('amt-input').value);
      const ppCurr=PP_UNSUPPORTED.includes(selCurr.code)?'USD':selCurr.code;
      const ppAmt=PP_UNSUPPORTED.includes(selCurr.code)?(rawAmt/selCurr.rate).toFixed(2):rawAmt.toFixed(2);
      const r=await fetch(`${API_URL}/paypal/order`,{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          amount:      ppAmt,
          currency:    ppCurr,
          description: g('payer-desc')?.value||'Payment to InterPayCom',
          customerEmail:g('payer-email')?.value?.trim()||undefined,
          customerName: g('payer-name')?.value?.trim()||undefined,
        })
      });
      const d=await r.json();
      if(!r.ok||d.error)throw new Error(d.error||'Order creation failed');
      clearMsg();return d.orderId;
    },
    onApprove:async(data)=>{
      showMsg('info','Verifying and capturing payment…');
      try{
        const r=await fetch(`${API_URL}/paypal/capture`,{
          method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({orderId:data.orderID})
        });
        const result=await r.json();
        if(!r.ok||result.error)throw new Error(result.error||'Capture failed');
        showSuccess(result);
      }catch(e){showMsg('err',e.message||'Payment capture failed. Please contact support.');}
    },
    onError:(err)=>{console.error('[PayPal]',err);showMsg('err','PayPal encountered an error. Please try again.');},
    onCancel:()=>{showMsg('warn','Payment cancelled. You can try again anytime.');},
  }).render('#pp-buttons');
}

/* ═══════════════════════════════════════════════════════════════
   SUCCESS
═══════════════════════════════════════════════════════════════ */
function showSuccess(r){
  g('pay-card').classList.add('hidden');
  g('success-card').classList.remove('hidden');
  g('success-details').innerHTML=[
    ['Status',         '✅ Payment Complete'],
    ['Transaction ID', r.captureId||r.orderId||'—'],
    ['Amount Charged', `${selCurr.symbol}${parseFloat(r.amount||curAmount).toFixed(2)} ${r.currency||selCurr.code}`],
    ['Method',         '🅿️ PayPal'],
    ['Payer',          r.payerEmail||g('payer-email')?.value||'—'],
    ['Date & Time',    new Date().toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})+' IST'],
  ].map(([k,v])=>`<div class="sd-row"><span>${k}</span><span>${v}</span></div>`).join('');
  toast('Payment received successfully! 🎉');
}
function resetPayment(){
  g('success-card').classList.add('hidden');g('pay-card').classList.remove('hidden');
  ['amt-input','payer-name','payer-email','payer-desc'].forEach(id=>{if(g(id))g(id).value='';});
  curAmount=0;onAmountChange();clearMsg();
  // Reload PayPal buttons
  if(_ppClientId)reloadPayPal();
}

/* ═══════════════════════════════════════════════════════════════
   MESSAGES + TOAST
═══════════════════════════════════════════════════════════════ */
function showMsg(t,m){const e=g('pay-msg');e.className=`pay-msg ${t}`;e.textContent=m;e.classList.remove('hidden');}
function clearMsg(){g('pay-msg')?.classList.add('hidden');}
function toast(msg,icon='ti-circle-check'){
  const t=g('toast');t.innerHTML=`<i class="ti ${icon}" aria-hidden="true"></i> ${msg}`;
  t.classList.add('on');clearTimeout(t._t);t._t=setTimeout(()=>t.classList.remove('on'),4500);
}

/* ═══════════════════════════════════════════════════════════════
   COUNTER ANIMATION
═══════════════════════════════════════════════════════════════ */
function animateCount(el,target,suffix=''){
  let cur=0;const step=target/60;
  const iv=setInterval(()=>{
    cur=Math.min(cur+step,target);
    el.textContent=Math.round(cur)+(suffix);
    if(cur>=target)clearInterval(iv);
  },16);
}

/* ═══════════════════════════════════════════════════════════════
   INIT APP
═══════════════════════════════════════════════════════════════ */
async function initApp(){
  if(_payInit)return;_payInit=true;
  await loadRates();
  renderList();updateQuickBtns();updateSummary();
  loadPayPalSDK();
  // Animate hero counters
  setTimeout(()=>{
    const c1=document.querySelector('.stat-countries');
    const c2=document.querySelector('.stat-currencies');
    if(c1)animateCount(c1,190,'+');
    if(c2)animateCount(c2,50,'+');
  },300);
  document.addEventListener('click',e=>{if(!e.target.closest('.curr-wrap'))closeCurr();});
}

/* ═══════════════════════════════════════════════════════════════
   BOOTSTRAP
═══════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded',()=>{
  initParticles();
  ['lid','lpw'].forEach(id=>{
    const el=g(id);if(!el)return;
    el.addEventListener('keydown',e=>{if(e.key==='Enter')doLogin();});
    el.addEventListener('input',clearLErr);
  });
  if(sessionStorage.getItem('ipc_ok')==='1'){
    g('scr-login').classList.remove('active');
    g('scr-main').classList.add('active');
    initApp();
  }else{
    g('scr-login').classList.add('active');
  }
});

Object.assign(window,{doLogin,doLogout,togglePw,openCurr,closeCurr,filterCurr,pickCurr,onAmountChange,setQuick,resetPayment});
