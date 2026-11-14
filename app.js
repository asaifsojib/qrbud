
(function(){
'use strict';
var doc = document;
doc.documentElement.classList.add('js');
var reduced = false;
try{ reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }catch(e){}

/* ---------- helpers ---------- */
function $(s,c){ return (c||doc).querySelector(s); }
function $$(s,c){ return Array.prototype.slice.call((c||doc).querySelectorAll(s)); }
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function byId(id){ return doc.getElementById(id); }

/* ---------- toast + copy ---------- */
var toastEl = byId('toast'), toastTimer = null;
function toast(msg){
  if(!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  if(toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ toastEl.classList.remove('show'); }, 2000);
}
function fallbackCopy(t){
  try{
    var ta = doc.createElement('textarea');
    ta.value = t; ta.setAttribute('readonly','');
    ta.style.position = 'fixed'; ta.style.top = '0'; ta.style.opacity = '0';
    doc.body.appendChild(ta); ta.select();
    var ok = false;
    try{ ok = doc.execCommand('copy'); }catch(e){ ok = false; }
    ta.remove();
    return !!ok;
  }catch(e){ return false; }
}
function copyText(t){
  return new Promise(function(resolve){
    try{
      if(navigator.clipboard && window.isSecureContext){
        navigator.clipboard.writeText(t).then(function(){ resolve(true); }, function(){ resolve(fallbackCopy(t)); });
        return;
      }
    }catch(e){}
    resolve(fallbackCopy(t));
  });
}

/* ---------- QR state + content types ---------- */
var state = {
  type: 'link',
  fg: '#212121',
  bg: '#ffffff',
  dots: 'rounded',
  corners: 'extra-rounded',
  values: { url: 'https://google.com', enc: 'WPA2' },
  frame: { on: true, text: 'Scan me', style: 'kiwi' }
};

var TYPES = [
  { id:'link', name:'Link',
    hint:'https:// is added for you if you leave it out.',
    fields:[['url','Website link','https://example.com','url']] },
  { id:'text', name:'Text',
    hint:'Any words at all. The phone just shows the text.',
    fields:[['text','Your text','Type anything here','textarea']] },
  { id:'wifi', name:'WiFi',
    hint:'Guests scan once and join. The password stays inside the code.',
    fields:[['ssid','Network name (SSID)','My WiFi','text'],['password','Password','••••••••','text'],['enc','Security','WPA2','select:WPA2,WPA,WEP,None']] },
  { id:'contact', name:'Contact',
    hint:'Saved straight into the address book when scanned.',
    fields:[['name','Full name','Saif Shojib','text'],['phone','Phone','+8801XXXXXXXXX','tel'],['email','Email','name@mail.com','email']] },
  { id:'email', name:'Email',
    hint:'Opens a ready-written email on the scanning phone.',
    fields:[['to','To','name@mail.com','email'],['subject','Subject','Hello','text'],['body','Message','','textarea']] },
  { id:'phone', name:'Phone',
    hint:'Opens the dialer with the number ready to call.',
    fields:[['number','Phone number','+8801XXXXXXXXX','tel']] }
];

function escWifi(s){ return String(s||'').replace(/\\/g,'\\\\').replace(/;/g,'\\;').replace(/,/g,'\\,').replace(/:/g,'\\:'); }

function buildData(){
  var v = state.values, t = state.type;
  if(t === 'link'){
    var u = (v.url || '').trim();
    if(!u) return '';
    if(!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(u)) u = 'https://' + u;
    return u;
  }
  if(t === 'text') return (v.text || '').trim();
  if(t === 'wifi'){
    var ssid = escWifi(v.ssid || ''), pw = escWifi(v.password || '');
    if(!ssid) return '';
    var enc = v.enc || 'WPA2'; if(enc === 'None') enc = 'nopass';
    return 'WIFI:T:' + enc + ';S:' + ssid + (enc === 'nopass' ? '' : ';P:' + pw) + ';H:false;;';
  }
  if(t === 'contact'){
    var fn = (v.name || '').trim(), ph = (v.phone || '').trim(), em = (v.email || '').trim();
    if(!fn && !ph && !em) return '';
    var lines = ['BEGIN:VCARD','VERSION:3.0'];
    if(fn) lines.push('FN:' + fn);
    if(ph) lines.push('TEL:' + ph);
    if(em) lines.push('EMAIL:' + em);
    lines.push('END:VCARD');
    return lines.join('\n');
  }
  if(t === 'email'){
    var to = (v.to || '').trim(); if(!to) return '';
    var q = [];
    if((v.subject || '').trim()) q.push('subject=' + encodeURIComponent(v.subject.trim()));
    if((v.body || '').trim()) q.push('body=' + encodeURIComponent(v.body.trim()));
    return 'mailto:' + to + (q.length ? '?' + q.join('&') : '');
  }
  if(t === 'phone'){
    var n = (v.number || '').trim(); if(!n) return '';
    return 'tel:' + n.replace(/[\s-]/g,'');
  }
  return '';
}

/* ---------- contrast check ---------- */
function hexRgb(hex){
  var m = /^#([0-9a-fA-F]{6})$/.exec(hex || '');
  if(!m) return null;
  var n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function luminance(rgb){
  function ch(c){
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  return 0.2126 * ch(rgb[0]) + 0.7152 * ch(rgb[1]) + 0.0722 * ch(rgb[2]);
}
function contrastTooLow(){
  var a = hexRgb(state.fg), b = hexRgb(state.bg);
  if(!a || !b) return false;
  var l1 = luminance(a), l2 = luminance(b);
  var ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  return ratio < 1.8;
}

/* ---------- QR engine ---------- */
var qr = null, engineOK = (typeof QRCodeStyling !== 'undefined'), qrError = false;
var stage = byId('qrStage'), qrbox = byId('qrbox');

function currentOpts(){
  return {
    width: 640, height: 640,
    data: buildData() || ' ',
    dotsOptions: { color: state.fg, type: state.dots },
    cornersSquareOptions: { color: state.fg, type: state.corners },
    cornersDotOptions: { color: state.fg, type: state.corners === 'dot' ? 'dot' : 'square' },
    backgroundOptions: { color: state.bg },
    qrOptions: { errorCorrectionLevel: byId('ecSel').value },
    imageOptions: { crossOrigin: 'anonymous', margin: 8 }
  };
}
function setButtonsEnabled(on){
  ['dlPng','dlSvg','copyBtn','copyTextBtn'].forEach(function(id){
    var b = byId(id); if(b) b.disabled = !on;
  });
}
function renderQR(){
  var data = buildData();
  var encoded = byId('encodedText'), count = byId('charCount');
  if(encoded) encoded.textContent = data || 'Nothing yet — type something above';
  if(count) count.textContent = data ? (data.length + ' chars') : '0 chars';
  qrError = false;
  if(stage){
    stage.classList.toggle('empty', !data);
    stage.classList.remove('error');
  }
  if(!engineOK){ setButtonsEnabled(false); return; }
  if(data){
    try{
      if(!qr){ qr = new QRCodeStyling(currentOpts()); qr.append(qrbox); }
      else{ qr.update(currentOpts()); }
    }catch(e){ qrError = true; }
  }
  if(qrError && stage){
    stage.classList.remove('empty');
    stage.classList.add('error');
  }
  if(stage){
    stage.classList.toggle('framed', state.frame.on && !!data && !qrError);
    var fl = byId('frameLabel');
    if(fl) fl.textContent = state.frame.text || 'Scan me';
  }
  updateSticky(data);
  var warn = byId('warn');
  if(warn) warn.classList.toggle('show', !!data && !qrError && contrastTooLow());
  setButtonsEnabled(!!data && !qrError);
}
var deb = null;
function scheduleRender(){ clearTimeout(deb); deb = setTimeout(renderQR, 220); }

/* ---------- tabs + form ---------- */
var tabs = $$('#tabs .tab');
function typeDef(id){
  for(var i = 0; i < TYPES.length; i++){ if(TYPES[i].id === id) return TYPES[i]; }
  return TYPES[0];
}
function selectTab(tab, focusTab){
  state.type = tab;
  tabs.forEach(function(t){
    var on = t.getAttribute('data-tab') === tab;
    t.setAttribute('aria-selected', on ? 'true' : 'false');
    t.tabIndex = on ? 0 : -1;
    if(on && focusTab){ try{ t.focus(); }catch(e){} }
  });
  renderForm();
  scheduleRender();
}
function renderForm(){
  var t = typeDef(state.type);
  var box = byId('form'); if(!box) return;
  box.innerHTML = '';
  t.fields.forEach(function(f){
    var key = f[0], label = f[1], ph = f[2], kind = f[3];
    var wrap = doc.createElement('div'); wrap.className = 'field';
    var lab = doc.createElement('label'); lab.textContent = label; lab.htmlFor = 'f-' + key;
    wrap.appendChild(lab);
    var input;
    if(kind === 'textarea'){
      input = doc.createElement('textarea'); input.placeholder = ph;
    }else if(kind.indexOf('select:') === 0){
      input = doc.createElement('select');
      kind.slice(7).split(',').forEach(function(o){
        var op = doc.createElement('option'); op.value = o; op.textContent = o; input.appendChild(op);
      });
      input.value = state.values[key] || ph;
    }else{
      input = doc.createElement('input'); input.type = kind; input.placeholder = ph;
      if(kind === 'url') input.setAttribute('inputmode', 'url');
      if(kind === 'tel') input.setAttribute('inputmode', 'tel');
    }
    input.className = 'input'; input.id = 'f-' + key;
    if(kind.indexOf('select:') !== 0) input.value = state.values[key] || '';
    input.addEventListener('input', function(){ state.values[key] = input.value; scheduleRender(); });
    input.addEventListener('change', function(){ state.values[key] = input.value; scheduleRender(); });
    wrap.appendChild(input);
    box.appendChild(wrap);
  });
  if(t.hint){
    var hint = doc.createElement('p'); hint.className = 'hint';
    hint.style.cssText = 'font-weight:400;color:var(--olive);font-size:clamp(13px,.86vw,15px);margin-top:4px';
    hint.textContent = t.hint;
    box.appendChild(hint);
  }
}
tabs.forEach(function(t){
  t.addEventListener('click', function(){ selectTab(t.getAttribute('data-tab'), false); });
});
var tabsWrap = byId('tabs');
if(tabsWrap){
  tabsWrap.addEventListener('keydown', function(ev){
    if(ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return;
    var i = tabs.indexOf(doc.activeElement);
    if(i === -1) return;
    ev.preventDefault();
    var next = (i + (ev.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    selectTab(tabs[next].getAttribute('data-tab'), true);
  });
}

/* ---------- styling controls ---------- */
var PRESETS = {
  classic:  { fg:'#212121', bg:'#ffffff', dots:'rounded', corners:'extra-rounded' },
  kiwi:     { fg:'#58A60A', bg:'#F4FFEB', dots:'rounded', corners:'extra-rounded' },
  midnight: { fg:'#ffffff', bg:'#212121', dots:'rounded', corners:'extra-rounded' },
  sky:      { fg:'#194965', bg:'#DFF1FC', dots:'dots',   corners:'dot' },
  rose:     { fg:'#C2185B', bg:'#FFF5F8', dots:'rounded', corners:'extra-rounded' },
  violet:   { fg:'#5B3EDB', bg:'#F2EFFF', dots:'classy-rounded', corners:'extra-rounded' }
};
function markPreset(name){
  $$('#presetChips .chip').forEach(function(c){
    c.setAttribute('aria-pressed', c.getAttribute('data-preset') === name ? 'true' : 'false');
  });
}
function applyPreset(name){
  var p = PRESETS[name]; if(!p) return;
  state.fg = p.fg; state.bg = p.bg; state.dots = p.dots; state.corners = p.corners;
  markPreset(name);
  renderSwatches(); renderSegs(); renderQR();
}
$$('#presetChips .chip').forEach(function(chip){
  chip.addEventListener('click', function(){ applyPreset(chip.getAttribute('data-preset')); });
});

var FG = ['#212121','#58A60A','#194965','#0A0A0A'];
var BG = ['#ffffff','#F4FFEB','#DFF1FC','#212121'];
function renderSwatches(){
  function fill(boxId, colors, key){
    var box = byId(boxId); if(!box) return;
    box.innerHTML = '';
    colors.forEach(function(c){
      var s = doc.createElement('button');
      s.type = 'button';
      s.className = 'swatch' + (state[key].toLowerCase() === c.toLowerCase() ? ' active' : '');
      s.style.background = c;
      s.title = c;
      s.setAttribute('aria-label', (key === 'fg' ? 'Code color ' : 'Background ') + c);
      s.setAttribute('aria-pressed', state[key].toLowerCase() === c.toLowerCase() ? 'true' : 'false');
      s.addEventListener('click', function(){ state[key] = c; markPreset(null); renderSwatches(); renderQR(); });
      box.appendChild(s);
    });
    var cp = doc.createElement('label'); cp.className = 'color-pick';
    var inp = doc.createElement('input'); inp.type = 'color';
    inp.value = /^#[0-9a-fA-F]{6}$/.test(state[key]) ? state[key] : '#212121';
    inp.setAttribute('aria-label', key === 'fg' ? 'Custom code color' : 'Custom background color');
    inp.addEventListener('input', function(){ state[key] = inp.value; markPreset(null); renderSwatches(); scheduleRender(); });
    cp.appendChild(inp);
    var sp = doc.createElement('span'); sp.textContent = 'Custom'; cp.appendChild(sp);
    box.appendChild(cp);
  }
  fill('fgSwatches', FG, 'fg');
  fill('bgSwatches', BG, 'bg');
}
function renderSegs(){
  function seg(id, options, key){
    var box = byId(id); if(!box) return;
    box.innerHTML = '';
    options.forEach(function(o){
      var b = doc.createElement('button');
      b.type = 'button';
      b.textContent = o[1];
      b.setAttribute('aria-pressed', state[key] === o[0] ? 'true' : 'false');
      b.addEventListener('click', function(){ state[key] = o[0]; markPreset(null); renderSegs(); renderQR(); });
      box.appendChild(b);
    });
  }
  seg('dotSeg', [['rounded','Rounded'],['dots','Dots'],['classy','Classy'],['classy-rounded','Classy round'],['extra-rounded','Extra round'],['square','Square']], 'dots');
  seg('cornerSeg', [['extra-rounded','Round'],['square','Square'],['dot','Dot']], 'corners');
  (function(){
    var box = byId('cardStyleSeg'); if(!box) return;
    box.innerHTML = '';
    [['kiwi','Kiwi'],['white','Plain white'],['midnight','Midnight'],['mono','Mono']].forEach(function(o){
      var b = doc.createElement('button');
      b.type = 'button';
      b.textContent = o[1];
      b.setAttribute('aria-pressed', state.frame.style === o[0] ? 'true' : 'false');
      b.addEventListener('click', function(){ state.frame.style = o[0]; renderSegs(); });
      box.appendChild(b);
    });
  })();
}
var sizeSel = byId('sizeSel'), ecSel = byId('ecSel');
if(ecSel) ecSel.addEventListener('change', renderQR);

/* ---------- v2 beauty: sticky card, hero + showcase QRs, frame, shuffle, recents ---------- */
var stickyQr = null, stickyDismissed = false;
function updateSticky(data){
  var card = byId('stickyQr');
  if(!card || stickyDismissed) return;
  if(!data || qrError || !engineOK){ card.classList.add('hidden'); return; }
  card.classList.remove('hidden');
  try{
    if(!stickyQr){
      stickyQr = new QRCodeStyling({ width: 116, height: 116, data: data,
        dotsOptions: { color: '#212121', type: 'rounded' },
        cornersSquareOptions: { color: '#212121', type: 'extra-rounded' },
        cornersDotOptions: { color: '#212121', type: 'square' },
        backgroundOptions: { color: '#ffffff' },
        qrOptions: { errorCorrectionLevel: 'M' } });
      stickyQr.append(byId('stickyQrBox'));
    }else{
      stickyQr.update({ data: data });
    }
  }catch(e){ card.classList.add('hidden'); }
}
var stickyClose = byId('stickyClose');
if(stickyClose) stickyClose.addEventListener('click', function(){
  stickyDismissed = true;
  var card = byId('stickyQr'); if(card) card.classList.add('hidden');
});

function initHeroQr(){
  if(!engineOK) return;
  var box = byId('heroQrBox'); if(!box) return;
  try{
    var hq = new QRCodeStyling({ width: 520, height: 520, data: 'https://google.com',
      dotsOptions: { color: '#212121', type: 'rounded' },
      cornersSquareOptions: { color: '#212121', type: 'extra-rounded' },
      cornersDotOptions: { color: '#212121', type: 'square' },
      backgroundOptions: { color: '#ffffff' },
      qrOptions: { errorCorrectionLevel: 'M' } });
    hq.append(box);
    var card = box.closest ? box.closest('.clay-qr') : null;
    if(card) card.classList.add('has-qr');
  }catch(e){}
}
function initShowcase(){
  if(!engineOK) return;
  var defs = [
    { id: 'showQr1', data: 'https://google.com', fg: '#58A60A', bg: '#F4FFEB', dots: 'dots', corners: 'dot' },
    { id: 'showQr2', data: 'WIFI:T:WPA2;S:QRbud Cafe;P:kiwi1234;H:false;;', fg: '#ffffff', bg: '#212121', dots: 'rounded', corners: 'extra-rounded' },
    { id: 'showQr3', data: 'Hello from QRbud!', fg: '#194965', bg: '#DFF1FC', dots: 'classy', corners: 'square' }
  ];
  defs.forEach(function(d){
    var box = byId(d.id); if(!box) return;
    try{
      var q = new QRCodeStyling({ width: 300, height: 300, data: d.data,
        dotsOptions: { color: d.fg, type: d.dots },
        cornersSquareOptions: { color: d.fg, type: d.corners },
        cornersDotOptions: { color: d.fg, type: d.corners === 'dot' ? 'dot' : 'square' },
        backgroundOptions: { color: d.bg },
        qrOptions: { errorCorrectionLevel: 'M' } });
      q.append(box);
      var tile = box.parentNode;
      if(tile && tile.classList) tile.classList.add('has-qr');
    }catch(e){}
  });
}
function initArtQrs(){
  if(!engineOK) return;
  var defs = [
    { id: 'artQrBig', data: 'https://google.com', fg: '#212121', bg: '#ffffff', cd: '#58A60A' },
    { id: 'artQrSmall', data: 'https://google.com', fg: '#ffffff', bg: '#212121', cd: '#BDE930' }
  ];
  defs.forEach(function(d){
    var box = byId(d.id); if(!box) return;
    try{
      var q = new QRCodeStyling({ width: 300, height: 300, data: d.data,
        dotsOptions: { color: d.fg, type: 'dots' },
        cornersSquareOptions: { color: d.fg, type: 'extra-rounded' },
        cornersDotOptions: { color: d.cd, type: 'dot' },
        backgroundOptions: { color: d.bg },
        qrOptions: { errorCorrectionLevel: 'M' } });
      q.append(box);
      var card = box.parentNode;
      if(card && card.classList) card.classList.add('has-qr');
    }catch(e){}
  });
}

/* Photo frame controls */
var frameToggle = byId('frameToggle'), frameTextRow = byId('frameTextRow'), frameText = byId('frameText'), cardStyleRow = byId('cardStyleRow');
if(frameToggle){
  frameToggle.addEventListener('click', function(){
    var on = frameToggle.getAttribute('aria-checked') !== 'true';
    frameToggle.setAttribute('aria-checked', on ? 'true' : 'false');
    state.frame.on = on;
    if(frameTextRow){ if(on) frameTextRow.removeAttribute('hidden'); else frameTextRow.setAttribute('hidden', ''); }
    if(cardStyleRow){ if(on) cardStyleRow.removeAttribute('hidden'); else cardStyleRow.setAttribute('hidden', ''); }
    renderQR();
  });
}
if(frameText){
  frameText.addEventListener('input', function(){
    state.frame.text = frameText.value;
    var fl = byId('frameLabel'); if(fl) fl.textContent = frameText.value || 'Scan me';
  });
}
/* Friendly caption for the download card: the readable thing inside the code */
function captionFor(){
  var v = state.values || {};
  if(state.type === 'link'){ var u = (v.url || '').trim(); if(u && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(u)) u = 'https://' + u; return u; }
  if(state.type === 'text') return (v.text || '').trim();
  if(state.type === 'wifi') return (v.ssid || '').trim() ? ('WiFi · ' + v.ssid.trim()) : '';
  if(state.type === 'contact') return (v.name || v.phone || v.email || '').trim();
  if(state.type === 'email') return (v.to || '').trim();
  if(state.type === 'phone') return (v.number || '').trim();
  return '';
}
function typeName(){
  for(var i = 0; i < TYPES.length; i++){ if(TYPES[i].id === state.type) return TYPES[i].name; }
  return 'QR';
}
function rrPath(ctx, x, y, w, h, r){
  ctx.beginPath();
  if(ctx.roundRect){ ctx.roundRect(x, y, w, h, r); return; }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function star4(ctx, cx, cy, r){
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.quadraticCurveTo(cx, cy, cx + r, cy);
  ctx.quadraticCurveTo(cx, cy, cx, cy + r);
  ctx.quadraticCurveTo(cx, cy, cx - r, cy);
  ctx.quadraticCurveTo(cx, cy, cx, cy - r);
  ctx.closePath();
}
function fitText(ctx, text, maxW){
  var t = String(text || '');
  if(!t || ctx.measureText(t).width <= maxW) return t;
  while(t.length > 1 && ctx.measureText(t + '…').width > maxW){ t = t.slice(0, -1); }
  return t + '…';
}
/* Download card styles: same layout, different moods */
var CARD_STYLES = {
  kiwi:     { bg:'#F4FFEB', glow:true,  dots:true,  sparkles:true,  ring:'dark',  plate:'#D1FFAB', cardShadow:true,  cardBorder:null,    wordmark:'#212121', typeStroke:'#212121', typeFill:'rgba(255,255,255,.65)', typeText:'#212121', scanCorners:true,  pillFill:'#212121', pillText:'#ffffff', caption:'#555C4D', frame:null },
  white:    { bg:'#ffffff', glow:false, dots:false, sparkles:false, ring:null,    plate:null,     cardShadow:false, cardBorder:'#E7ECEF', wordmark:'#212121', typeStroke:'#212121', typeFill:'#ffffff',             typeText:'#212121', scanCorners:false, pillFill:'#212121', pillText:'#ffffff', caption:'#555C4D', frame:null },
  midnight: { bg:'#0A0A0A', glow:'faint', dots:false, sparkles:false, ring:'light', plate:'#1F1F1F', cardShadow:false, cardBorder:null,    wordmark:'#ffffff', typeStroke:'#ffffff', typeFill:'rgba(255,255,255,.08)', typeText:'#ffffff', scanCorners:true,  pillFill:'#ffffff', pillText:'#212121', caption:'#B9BFC2', frame:null },
  mono:     { bg:'#FAF2E6', glow:false, dots:false, sparkles:false, ring:null,    plate:null,     cardShadow:false, cardBorder:'#212121', wordmark:'#212121', typeStroke:'#212121', typeFill:'rgba(255,255,255,.5)',  typeText:'#212121', scanCorners:false, pillFill:'#212121', pillText:'#ffffff', caption:'#555C4D', frame:'#212121' }
};
/* Styled download card: kiwi canvas, glow discs, orbit ring, stack plate, scan corners */
function buildFramedPng(blob, sizePx, label, caption, typeLabel, style){
  return new Promise(function(resolve, reject){
    var url = URL.createObjectURL(blob);
    var img = new Image();
    img.onload = function(){
      var draw = function(){
        try{
          var cfg = CARD_STYLES[style] || CARD_STYLES.kiwi;
          var S = sizePx, k = S / 1024;
          var outer = 72 * k, inner = 40 * k;
          var cardW = S + inner * 2, cardX = outer;
          var W = Math.round(cardW + outer * 2);
          var topBarH = 96 * k, gap1 = 28 * k, gap2 = 44 * k, pillH = 92 * k, gap3 = 30 * k, capH = 44 * k, botPad = 72 * k;
          var cardY = topBarH + gap1;
          var H = Math.round(topBarH + gap1 + cardW + gap2 + pillH + gap3 + capH + botPad);
          var cv = doc.createElement('canvas'); cv.width = W; cv.height = H;
          var ctx = cv.getContext('2d');
          ctx.fillStyle = cfg.bg; ctx.fillRect(0, 0, W, H);
          if(cfg.frame){
            ctx.strokeStyle = cfg.frame; ctx.lineWidth = 3 * k;
            ctx.strokeRect(14 * k, 14 * k, W - 28 * k, H - 28 * k);
            ctx.lineWidth = 1.5 * k;
            ctx.strokeRect(26 * k, 26 * k, W - 52 * k, H - 52 * k);
          }
          if(cfg.glow){
            var faint = cfg.glow === 'faint';
            var g1 = ctx.createRadialGradient(W * 0.88, H * 0.08, 10, W * 0.88, H * 0.08, 430 * k);
            g1.addColorStop(0, faint ? 'rgba(129,216,41,.14)' : 'rgba(129,216,41,.38)'); g1.addColorStop(1, 'rgba(129,216,41,0)');
            ctx.fillStyle = g1; ctx.fillRect(0, 0, W, H);
            var g2 = ctx.createRadialGradient(W * 0.05, H * 0.94, 10, W * 0.05, H * 0.94, 400 * k);
            g2.addColorStop(0, faint ? 'rgba(159,220,255,.10)' : 'rgba(159,220,255,.5)'); g2.addColorStop(1, 'rgba(159,220,255,0)');
            ctx.fillStyle = g2; ctx.fillRect(0, 0, W, H);
          }
          if(cfg.dots){
            var dots = [[0.06,0.20,9,'#81D829'],[0.94,0.30,7,'#BDE930'],[0.07,0.56,7,'#FF9AE4'],[0.94,0.60,9,'#9DECFF'],[0.09,0.88,7,'#BDE930'],[0.92,0.90,8,'#81D829'],[0.16,0.05,6,'#9DECFF'],[0.84,0.05,6,'#FF9AE4']];
            dots.forEach(function(d){
              ctx.beginPath(); ctx.arc(W * d[0], H * d[1], d[2] * k, 0, Math.PI * 2); ctx.fillStyle = d[3]; ctx.fill();
            });
          }
          if(cfg.sparkles){
            ctx.fillStyle = '#58A60A'; star4(ctx, W * 0.90, topBarH * 0.52, 17 * k); ctx.fill();
            ctx.fillStyle = '#BDE930'; star4(ctx, outer * 0.55, cardY + cardW * 0.88, 14 * k); ctx.fill();
            ctx.fillStyle = '#FF9AE4'; star4(ctx, W * 0.94, H * 0.44, 11 * k); ctx.fill();
          }
          var ccx = W / 2, ccy = cardY + cardW / 2;
          if(cfg.ring){
            ctx.save();
            ctx.beginPath(); ctx.arc(ccx, ccy, cardW * 0.63, 0, Math.PI * 2);
            ctx.setLineDash([16 * k, 14 * k]); ctx.lineWidth = 3 * k;
            ctx.strokeStyle = cfg.ring === 'light' ? 'rgba(255,255,255,.25)' : 'rgba(33,33,33,.28)'; ctx.stroke();
            ctx.restore();
          }
          if(cfg.plate){
            ctx.save();
            ctx.translate(ccx, ccy); ctx.rotate(-5 * Math.PI / 180);
            rrPath(ctx, -cardW / 2, -cardW / 2, cardW, cardW, 56 * k);
            ctx.fillStyle = cfg.plate; ctx.fill();
            ctx.restore();
          }
          ctx.save();
          if(cfg.cardShadow){ ctx.shadowColor = 'rgba(33,33,33,.16)'; ctx.shadowBlur = 36 * k; ctx.shadowOffsetY = 14 * k; }
          rrPath(ctx, cardX, cardY, cardW, cardW, 56 * k);
          ctx.fillStyle = '#ffffff'; ctx.fill();
          ctx.restore();
          if(cfg.cardBorder){
            rrPath(ctx, cardX, cardY, cardW, cardW, 56 * k);
            ctx.lineWidth = 2 * k; ctx.strokeStyle = cfg.cardBorder; ctx.stroke();
          }
          if(cfg.scanCorners){
            var ci = 18 * k, arm = 54 * k;
            ctx.strokeStyle = '#212121'; ctx.lineWidth = 7 * k; ctx.lineCap = 'round';
            var corners = [
              [cardX + ci, cardY + ci, 1, 1], [cardX + cardW - ci, cardY + ci, -1, 1],
              [cardX + ci, cardY + cardW - ci, 1, -1], [cardX + cardW - ci, cardY + cardW - ci, -1, -1]
            ];
            corners.forEach(function(c){
              ctx.beginPath();
              ctx.moveTo(c[0] + arm * c[2], c[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(c[0], c[1] + arm * c[3]);
              ctx.stroke();
            });
          }
          ctx.drawImage(img, cardX + inner, cardY + inner, S, S);
          ctx.textBaseline = 'middle';
          ctx.textAlign = 'left';
          ctx.fillStyle = cfg.wordmark;
          ctx.font = '800 ' + Math.round(54 * k) + 'px Sora, Arial, sans-serif';
          ctx.fillText('qrbud.', outer, topBarH / 2 + 2 * k);
          var tn = typeLabel || 'QR';
          ctx.font = '700 ' + Math.round(30 * k) + 'px Sora, Arial, sans-serif';
          var tnW = ctx.measureText(tn).width;
          var tpH = 52 * k, tpW = tnW + 44 * k, tpX = W - outer - tpW, tpY = (topBarH - tpH) / 2;
          rrPath(ctx, tpX, tpY, tpW, tpH, tpH / 2);
          ctx.fillStyle = cfg.typeFill; ctx.fill();
          ctx.lineWidth = 2.5 * k; ctx.strokeStyle = cfg.typeStroke; ctx.stroke();
          ctx.fillStyle = cfg.typeText; ctx.textAlign = 'center';
          ctx.fillText(tn, tpX + tpW / 2, tpY + tpH / 2 + 1 * k);
          var txt = (label || 'Scan me').slice(0, 24) || 'Scan me';
          ctx.font = '700 ' + Math.round(44 * k) + 'px Sora, Arial, sans-serif';
          var tw = ctx.measureText(txt).width;
          var pillW = Math.min(W * 0.8, tw + pillH * 1.5);
          var px = (W - pillW) / 2, py = cardY + cardW + gap2;
          rrPath(ctx, px, py, pillW, pillH, pillH / 2);
          ctx.fillStyle = cfg.pillFill; ctx.fill();
          ctx.fillStyle = cfg.pillText; ctx.textAlign = 'center';
          ctx.fillText(txt, W / 2, py + pillH / 2 + 1 * k);
          var cap = (caption || '').trim();
          if(cap){
            ctx.font = '500 ' + Math.round(34 * k) + 'px Sora, Arial, sans-serif';
            ctx.fillStyle = cfg.caption; ctx.textAlign = 'center';
            ctx.fillText(fitText(ctx, cap, W * 0.86), W / 2, py + pillH + gap3 + capH / 2);
          }
          URL.revokeObjectURL(url);
          if(cv.toBlob){ cv.toBlob(function(b){ b ? resolve(b) : reject(new Error('toBlob failed')); }, 'image/png'); }
          else{ reject(new Error('toBlob unavailable')); }
        }catch(e){ URL.revokeObjectURL(url); reject(e); }
      };
      if(doc.fonts && doc.fonts.ready){
        var fired = false;
        var timer = setTimeout(function(){ if(!fired){ fired = true; draw(); } }, 900);
        doc.fonts.ready.then(function(){ if(!fired){ fired = true; clearTimeout(timer); draw(); } });
      } else { draw(); }
    };
    img.onerror = function(){ URL.revokeObjectURL(url); reject(new Error('image load failed')); };
    img.src = url;
  });
}
function downloadBlob(blob, filename){
  var url = URL.createObjectURL(blob);
  var a = doc.createElement('a');
  a.href = url; a.download = filename;
  doc.body.appendChild(a); a.click(); a.remove();
  setTimeout(function(){ try{ URL.revokeObjectURL(url); }catch(e){} }, 800);
}

/* Shuffle: a fresh, contrast-safe look in one tap */
var SHUFFLE_PAIRS = [
  ['#212121','#ffffff'],['#58A60A','#F4FFEB'],['#ffffff','#212121'],
  ['#194965','#DFF1FC'],['#C2185B','#FFF5F8'],['#5B3EDB','#F2EFFF'],
  ['#0A0A0A','#DFF1FC'],['#194965','#ffffff'],['#58A60A','#ffffff'],['#212121','#DFF1FC']
];
var SHUFFLE_DOTS = ['rounded','dots','classy','classy-rounded','extra-rounded','square'];
var SHUFFLE_CORNERS = ['extra-rounded','square','dot'];
function shuffleStyle(){
  var picked = null;
  for(var i = 0; i < 16; i++){
    var pair = SHUFFLE_PAIRS[Math.floor(Math.random() * SHUFFLE_PAIRS.length)];
    var cand = { fg: pair[0], bg: pair[1],
      dots: SHUFFLE_DOTS[Math.floor(Math.random() * SHUFFLE_DOTS.length)],
      corners: SHUFFLE_CORNERS[Math.floor(Math.random() * SHUFFLE_CORNERS.length)] };
    var keepFg = state.fg, keepBg = state.bg;
    state.fg = cand.fg; state.bg = cand.bg;
    var ok = !contrastTooLow();
    state.fg = keepFg; state.bg = keepBg;
    if(ok && (cand.fg !== state.fg || cand.bg !== state.bg || cand.dots !== state.dots)){ picked = cand; break; }
    if(ok && !picked) picked = cand;
  }
  if(!picked) picked = { fg:'#212121', bg:'#ffffff', dots:'rounded', corners:'extra-rounded' };
  state.fg = picked.fg; state.bg = picked.bg; state.dots = picked.dots; state.corners = picked.corners;
  markPreset(null); renderSwatches(); renderSegs(); renderQR();
  toast('New look!');
}
var shuffleBtn = byId('shuffleBtn');
if(shuffleBtn) shuffleBtn.addEventListener('click', shuffleStyle);

/* Recent codes: links + plain text only, on this device only */
var RECENT_KEY = 'qrbud:recent:v1';
var recents = [];
try{
  var rawRecent = localStorage.getItem(RECENT_KEY);
  if(rawRecent){ var parsed = JSON.parse(rawRecent); if(Object.prototype.toString.call(parsed) === '[object Array]') recents = parsed; }
}catch(e){ recents = []; }
function saveRecents(){ try{ localStorage.setItem(RECENT_KEY, JSON.stringify(recents)); }catch(e){} }
function renderRecents(){
  var wrap = byId('recentWrap'), chips = byId('recentChips');
  if(!wrap || !chips) return;
  if(!recents.length){ wrap.setAttribute('hidden', ''); chips.innerHTML = ''; return; }
  wrap.removeAttribute('hidden');
  var html = '';
  recents.forEach(function(r, i){
    var dot = r.type === 'text' ? '#FF9AE4' : '#9DECFF';
    html += '<button class="recent-chip" type="button" data-recent="' + i + '"><span class="dot" style="background:' + dot + '"></span><span class="lbl">' + esc(r.data) + '</span></button>';
  });
  chips.innerHTML = html;
}
function addRecent(){
  var data = buildData();
  if(!data || qrError) return;
  if(state.type !== 'link' && state.type !== 'text') return;
  recents = recents.filter(function(r){ return r.data !== data; });
  recents.unshift({ type: state.type, data: data });
  recents = recents.slice(0, 6);
  saveRecents(); renderRecents();
}
var recentChips = byId('recentChips');
if(recentChips){
  recentChips.addEventListener('click', function(ev){
    var chip = ev.target && ev.target.closest ? ev.target.closest('.recent-chip') : null;
    if(!chip) return;
    var r = recents[parseInt(chip.getAttribute('data-recent'), 10)];
    if(!r) return;
    if(r.type === 'link') state.values.url = r.data;
    else state.values.text = r.data;
    selectTab(r.type, false);
    renderQR();
    var gen = byId('generator');
    if(gen){ try{ gen.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' }); }catch(e){} }
  });
}
var recentClear = byId('recentClear');
if(recentClear) recentClear.addEventListener('click', function(){
  recents = []; saveRecents(); renderRecents(); toast('Recent codes cleared');
});

/* Tiny confetti burst on download */
function burstConfetti(){
  if(reduced) return;
  var host = byId('qrStage'); if(!host) return;
  var colors = ['#81D829','#BDE930','#FF9AE4','#9DECFF','#E389FF','#9681FF'];
  for(var i = 0; i < 16; i++){
    (function(i){
      var d = doc.createElement('span');
      d.className = 'confetti-dot';
      d.style.background = colors[i % colors.length];
      d.style.left = '50%'; d.style.top = '50%';
      host.appendChild(d);
      var ang = (Math.PI * 2 * i / 16) + Math.random() * 0.5;
      var dist = 90 + Math.random() * 110;
      var dx = Math.cos(ang) * dist, dy = Math.sin(ang) * dist - 40;
      try{
        var anim = d.animate([
          { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
          { transform: 'translate(calc(-50% + ' + dx + 'px), calc(-50% + ' + dy + 'px)) scale(.4)', opacity: 0 }
        ], { duration: 750 + Math.random() * 250, easing: 'cubic-bezier(.16,1,.3,1)' });
        anim.onfinish = function(){ d.remove(); };
      }catch(e){ d.remove(); }
    })(i);
  }
}

/* ---------- download, copy, clear ---------- */
function withSize(fn){
  if(!qr) return;
  var s = parseInt((sizeSel && sizeSel.value) || '1024', 10) || 1024;
  qr.update({ width: s, height: s });
  try{ fn(); }finally{ qr.update({ width: 640, height: 640 }); }
}
function needData(){
  if(!buildData() || qrError){ toast('Type something first, then download'); return false; }
  return true;
}
var dlPng = byId('dlPng');
if(dlPng) dlPng.addEventListener('click', function(){
  if(!engineOK || !needData()) return;
  if(state.frame.on){
    var s = parseInt((sizeSel && sizeSel.value) || '1024', 10) || 1024;
    try{ qr.update({ width: s, height: s }); }catch(e){}
    qr.getRawData('png').then(function(blob){
      try{ qr.update({ width: 640, height: 640 }); }catch(e){}
      if(!blob) throw new Error('empty');
      return buildFramedPng(blob, s, state.frame.text || 'Scan me', captionFor(), typeName(), state.frame.style);
    }).then(function(fblob){
      downloadBlob(fblob, 'qrbud-card.png');
      toast('Card PNG downloaded'); burstConfetti(); addRecent();
    }).catch(function(){
      try{ qr.update({ width: 640, height: 640 }); }catch(e){}
      toast('Card failed, downloading plain PNG');
      withSize(function(){ qr.download({ name: 'qrbud-code', extension: 'png' }); });
    });
    return;
  }
  withSize(function(){ qr.download({ name: 'qrbud-code', extension: 'png' }); });
  toast('PNG downloaded'); burstConfetti(); addRecent();
});
var dlSvg = byId('dlSvg');
if(dlSvg) dlSvg.addEventListener('click', function(){
  if(!engineOK || !needData()) return;
  withSize(function(){ qr.download({ name: 'qrbud-code', extension: 'svg' }); });
  toast('SVG downloaded'); burstConfetti(); addRecent();
});
var copyBtn = byId('copyBtn');
if(copyBtn) copyBtn.addEventListener('click', function(){
  if(!engineOK || !needData()) return;
  if(state.frame.on){
    var s = parseInt((sizeSel && sizeSel.value) || '1024', 10) || 1024;
    try{ qr.update({ width: s, height: s }); }catch(e){}
    qr.getRawData('png').then(function(blob){
      try{ qr.update({ width: 640, height: 640 }); }catch(e){}
      if(!blob) throw new Error('empty');
      return buildFramedPng(blob, s, state.frame.text || 'Scan me', captionFor(), typeName(), state.frame.style);
    }).then(function(cardBlob){
      return navigator.clipboard.write([new ClipboardItem({ 'image/png': cardBlob })]);
    }).then(function(){ toast('Card image copied to clipboard'); addRecent(); })
      .catch(function(){ try{ qr.update({ width: 640, height: 640 }); }catch(e){} toast('Copy blocked by the browser, use Download instead'); });
    return;
  }
  withSize(function(){
    qr.getRawData('png').then(function(blob){
      if(!blob) throw new Error('empty');
      return navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    }).then(function(){ toast('Image copied to clipboard'); addRecent(); })
      .catch(function(){ toast('Copy blocked by the browser, use Download instead'); });
  });
});
var copyTextBtn = byId('copyTextBtn');
if(copyTextBtn) copyTextBtn.addEventListener('click', function(){
  var data = buildData();
  if(!data || qrError){ toast('Type something first'); return; }
  copyText(data).then(function(ok){
    if(ok) addRecent();
    toast(ok ? 'Copied the text' : 'Copy did not work here');
  });
});
var clearBtn = byId('clearBtn');
if(clearBtn) clearBtn.addEventListener('click', function(){
  state.values = { enc: 'WPA2' };
  selectTab('link', false);
  toast('Cleared — start fresh');
});

/* type cards + footer links jump into the generator */
$$('[data-type-link]').forEach(function(a){
  a.addEventListener('click', function(){ selectTab(a.getAttribute('data-type-link'), false); });
});
$$('[data-foot-tab]').forEach(function(a){
  a.addEventListener('click', function(){ selectTab(a.getAttribute('data-foot-tab'), false); });
});

/* ---------- navbar hide/show + burger ---------- */
var nav = byId('navbar'), lastY = 0, navTick = false;
function onScrollNav(){
  var y = window.pageYOffset || 0;
  if(!nav) return;
  if(y > 320 && y > lastY + 4 && !nav.classList.contains('open')){ nav.classList.add('hidden'); }
  else if(y < lastY - 4 || y <= 320){ nav.classList.remove('hidden'); }
  lastY = y; navTick = false;
}
window.addEventListener('scroll', function(){
  if(!navTick){ navTick = true; requestAnimationFrame(onScrollNav); }
}, { passive: true });
var burger = byId('burger');
if(burger && nav){
  burger.addEventListener('click', function(){
    var open = nav.classList.toggle('open');
    burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    if(open) nav.classList.remove('hidden');
  });
  $$('#navPanel a').forEach(function(a){
    a.addEventListener('click', function(){
      nav.classList.remove('open');
      burger.setAttribute('aria-expanded', 'false');
    });
  });
}

/* ---------- scroll statement word reveal ---------- */
var stmtText = byId('statementText'), stmtWords = [];
if(stmtText){
  try{
    var words = ['Point.','Scan.','Done.','One','little','square','takes','you','straight','there.'];
    stmtText.innerHTML = words.map(function(w, i){
      return '<span class="w' + (i === 5 ? ' hl' : '') + '">' + esc(w) + '</span>';
    }).join(' ');
    stmtWords = $$('.w', stmtText);
  }catch(e){ stmtWords = []; }
}
function revealStatement(){
  if(!stmtWords.length) return;
  var sec = byId('statement');
  if(!sec){ stmtWords.forEach(function(w){ w.classList.add('on'); }); return; }
  var r = sec.getBoundingClientRect(), vh = window.innerHeight || 600;
  var p = (vh - r.top) / (r.height + vh * 0.6);
  p = Math.max(0, Math.min(1, p));
  var n = Math.round(p * stmtWords.length);
  stmtWords.forEach(function(w, i){ if(i < n) w.classList.add('on'); });
}
window.addEventListener('scroll', function(){ if(!reduced) revealStatement(); }, { passive: true });
window.addEventListener('resize', function(){ if(!reduced) revealStatement(); });

/* ---------- reveal-on-scroll (gated, with fallback) ---------- */
function revealAll(){
  $$('.reveal').forEach(function(el){ el.classList.add('in'); });
  stmtWords.forEach(function(w){ w.classList.add('on'); });
}
if(reduced){
  revealAll();
}else{
  try{
    if('IntersectionObserver' in window){
      var io = new IntersectionObserver(function(entries){
        entries.forEach(function(en){ if(en.isIntersecting){ en.target.classList.add('in'); io.unobserve(en.target); } });
      }, { threshold: 0.12 });
      $$('.reveal').forEach(function(el){ io.observe(el); });
    }else{ revealAll(); }
  }catch(e){ revealAll(); }
  setTimeout(revealAll, 2500);
  revealStatement();
}

/* ---------- carousel ---------- */
var carousel = byId('carousel'), dotsWrap = byId('carouselDots');
if(carousel){
  var cards = $$('.style-card', carousel);
  function cardStep(){ return cards.length ? (cards[0].offsetWidth + 24) : 320; }
  var prev = byId('carPrev'), next = byId('carNext');
  if(prev){ prev.addEventListener('click', function(){ carousel.scrollBy({ left: -cardStep(), behavior: reduced ? 'auto' : 'smooth' }); }); }
  if(next){ next.addEventListener('click', function(){ carousel.scrollBy({ left: cardStep(), behavior: reduced ? 'auto' : 'smooth' }); }); }
  if(dotsWrap && cards.length){
    cards.forEach(function(_, i){
      var d = doc.createElement('button');
      d.setAttribute('aria-label', 'Go to type ' + (i + 1));
      if(i === 0) d.className = 'active';
      d.addEventListener('click', function(){ carousel.scrollTo({ left: i * cardStep(), behavior: reduced ? 'auto' : 'smooth' }); });
      dotsWrap.appendChild(d);
    });
    carousel.addEventListener('scroll', function(){
      var idx = Math.round(carousel.scrollLeft / cardStep());
      $$('button', dotsWrap).forEach(function(d, i){ d.classList.toggle('active', i === idx); });
    }, { passive: true });
  }
}

/* ---------- marquee: duplicate track for a seamless loop ---------- */
var track = byId('marqueeTrack');
if(track){
  try{ track.innerHTML += track.innerHTML; }catch(e){}
}

/* ---------- init ---------- */
renderForm(); renderSwatches(); renderSegs(); renderQR();
renderRecents(); initHeroQr(); initShowcase(); initArtQrs();
if(!engineOK){
  var emptyMsg = $('#qrEmpty div', stage);
  if(emptyMsg) emptyMsg.textContent = 'Could not load the QR engine. Reload the page to try again.';
  setButtonsEnabled(false);
}

/* test hooks (used only by automated verification) */
window.__qrbud = {
  buildData: buildData,
  state: state,
  selectTab: function(t){ selectTab(t, false); },
  renderQR: renderQR,
  engineOK: function(){ return engineOK; },
  qrReady: function(){ return !!qr; },
  qrError: function(){ return qrError; },
  shuffleStyle: shuffleStyle,
  addRecent: addRecent,
  recents: function(){ return recents.slice(); },
  buildFramedPng: buildFramedPng,
  burstConfetti: burstConfetti
};
})();
