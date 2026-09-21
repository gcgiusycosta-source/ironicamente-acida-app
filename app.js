(() => {
  'use strict';
  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => [...r.querySelectorAll(s)];
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const deepClone = o => JSON.parse(JSON.stringify(o));
  const nowISO = () => new Date().toISOString();
  const uid = p => `${p}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
  const normalize = s => (s||'').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu,'').replace(/\s+/g,' ').trim();
  const C = { cream:'#F6F1EA', cream2:'#FFFAF4', ink:'#21110D', orange:'#E65F22', orangeSoft:'#F3C7AE', beige:'#D8C5B6', white:'#FFFFFF' };
  const formats = {
    story:{w:1080,h:1920,label:'Story 9:16'}, post45:{w:1080,h:1350,label:'Post 4:5'}, post34:{w:1080,h:1440,label:'Post 3:4'}, square:{w:1080,h:1080,label:'Quadrato 1:1'}
  };
  const categoryLabels = {
    buongiorno_vita_reale:'Buongiorno + vita reale', buongiorno_maternita:'Buongiorno + maternità', buongiorno_libri:'Buongiorno + libri', maternita:'Maternità', vita_reale:'Vita reale', viaggi:'Viaggi', libri:'Libri', amore_coppia_relazioni:'Amore / relazioni'
  };
  const canvas = $('#design-canvas');
  const ctx = canvas.getContext('2d');
  let bgImage = null, signatureImage = null;
  const imageCache = new Map();
  let screen = 'home', previousScreen = 'home', phrasePickerMode = false, stickerPickerMode = false;
  let selectedTemplate = 'editorial';
  let phraseView = { status:'available', category:'all', search:'' };
  let stickerView = { category:'all', search:'', favorites:false };
  let drag = null, autosaveTimer = null;
  let defaults = { filter:'soft', format:'story' };

  function blankState(mode='template') {
    return {
      mode, projectId:null, format:defaults.format || 'story', templateStyle:selectedTemplate,
      photoStyle:'short', filter:defaults.filter || 'soft', filterIntensity:85, bgDataUrl:null,
      photoZoom:1, photoX:0, photoY:0, phrase:'', phraseId:null, highlight:'', textTone:'dark', textSize:82,
      signatureEnabled:true, signaturePosition:'center', signatureSize:78, overlays:[], selectedOverlayId:null,
      createdAt:nowISO(), updatedAt:nowISO()
    };
  }
  let state = blankState();

  // ---------- bootstrap ----------
  document.addEventListener('DOMContentLoaded', init);
  async function init() {
    await IADB.open();
    signatureImage = await loadImage('./signature.svg').catch(()=>null);
    defaults.filter = await IADB.metaGet('default_filter','soft');
    defaults.format = await IADB.metaGet('default_format','story');
    await seedStarter(false);
    await loadSettingsUI();
    bindEvents();
    await refreshAll();
    await sleep(420);
    $('#splash').classList.add('hidden');
    $('#app').classList.remove('hidden');
    showScreen('home', false);
    await offerDraft();
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(()=>{});
  }

  async function seedStarter(forceMerge=false) {
    const seedVersion = await IADB.metaGet('starter_seed_version',0);
    if (seedVersion >= 2 && !forceMerge) return;
    const p = await fetch('./phrases.json').then(r=>r.json());
    const currentPhrases = await IADB.getAll('phrases');
    const phraseByText = new Map(currentPhrases.map(x=>[normalize(x.text),x]));
    const normalizedP = (p.entries||[]).map(e => ({
      id:e.id || uid('ph'), category:e.categoria || 'vita_reale', text:e.testo || '', tags:e.tags||[], recommendedStyles:e.stili_consigliati||[], formats:e.formati||[],
      used:!!e.gia_usata, usedAt:e.gia_usata ? '2026-09-01T00:00:00.000Z' : null, useCount:e.gia_usata?1:0, favorite:false,
      active:e.attiva_per_suggerimenti !== false, source:e.fonte || 'starter', createdAt:nowISO(), updatedAt:nowISO()
    })).filter(e=>e.text.trim());
    const addP = normalizedP.filter(e=>!phraseByText.has(normalize(e.text)));
    if (addP.length) await IADB.bulkPut('phrases', addP);

    const sm = await fetch('./stickers.json').then(r=>r.json());
    const currentStickers = await IADB.getAll('stickers');
    const stickerKeys = new Set(currentStickers.map(x=>`${normalize(x.title)}|${x.style||''}`));
    const addS = (sm.stickers||[]).map(s=>({
      id:s.id || uid('stk'), title:s.title || 'Sticker', category:s.category || 'Importati', style:s.style || 'starter', tags:s.tags||[], favorite:false, active:s.active!==false,
      src:`./${s.file}`, sourceType:'starter', source:'Starter Pack 48', createdAt:nowISO(), updatedAt:nowISO()
    })).filter(s=>!stickerKeys.has(`${normalize(s.title)}|${s.style||''}`));
    if (addS.length) await IADB.bulkPut('stickers', addS);
    await IADB.metaSet('starter_seed_version',2);
  }

  async function refreshAll() {
    await Promise.all([refreshHome(), renderPhrases(), renderStickers(), renderProjects(), updateStats(), renderEditorStickerGrid()]);
  }

  // ---------- navigation ----------
  function showScreen(name, remember=true) {
    if (remember && screen !== name) previousScreen = screen;
    screen = name;
    $$('.screen').forEach(s=>s.classList.toggle('active',s.dataset.screen===name));
    $$('#bottom-nav button').forEach(b=>b.classList.toggle('selected',b.dataset.nav===name));
    const editorish = name==='editor';
    $('#bottom-nav').classList.toggle('hidden', editorish || name==='templates');
    $('#global-header').classList.toggle('hidden', editorish);
    $('#header-back').style.visibility = name==='home' ? 'hidden' : 'visible';
    $('#header-settings').style.visibility = ['home','phrases','stickers','projects'].includes(name) ? 'visible' : 'hidden';
    const sub = {home:'studio',templates:'template',phrases:'frasi',stickers:'sticker',projects:'progetti',settings:'impostazioni'}[name] || 'studio';
    $('#header-subtitle').textContent=sub;
    if (name==='phrases') renderPhrases();
    if (name==='stickers') renderStickers();
    if (name==='projects') renderProjects();
    if (name==='settings') updateStats();
    window.scrollTo({top:0,behavior:'instant'});
  }

  // ---------- events ----------
  function bindEvents() {
    $$('[data-nav]').forEach(b=>b.addEventListener('click',()=>showScreen(b.dataset.nav)));
    $('#header-back').addEventListener('click',()=>{if(screen==='phrases')phrasePickerMode=false;if(screen==='stickers')stickerPickerMode=false;showScreen(previousScreen || 'home', false);});
    $('#header-settings').addEventListener('click',()=>showScreen('settings'));
    $('#home-template').addEventListener('click',()=>showScreen('templates'));
    $('#home-photo').addEventListener('click',()=>{ $('#photo-file').dataset.action='new'; $('#photo-file').click(); });

    $$('#template-picker [data-template]').forEach(b=>b.addEventListener('click',()=>{
      selectedTemplate=b.dataset.template; $$('#template-picker [data-template]').forEach(x=>x.classList.toggle('selected',x===b));
    }));
    $('#use-template').addEventListener('click',()=>startTemplate());

    $$('#tool-tabs [data-tool]').forEach(b=>b.addEventListener('click',()=>openTool(b.dataset.tool)));
    $$('#format-options button').forEach(b=>b.addEventListener('click',()=>{state.format=b.dataset.value; syncChoice('#format-options',state.format); resizeCanvas(); changed();}));
    $$('#filter-options button').forEach(b=>b.addEventListener('click',()=>{state.filter=b.dataset.value; syncChoice('#filter-options',state.filter); changed();}));
    $('#filter-intensity').addEventListener('input',e=>{state.filterIntensity=+e.target.value;e.target.nextElementSibling.value=state.filterIntensity+'%';changed(false);});
    $('#photo-zoom').addEventListener('input',e=>{state.photoZoom=+e.target.value;e.target.nextElementSibling.value=Math.round(state.photoZoom*100)+'%';changed(false);});
    $('#photo-x').addEventListener('input',e=>{state.photoX=+e.target.value;e.target.nextElementSibling.value=Math.round(state.photoX*100);changed(false);});
    $('#photo-y').addEventListener('input',e=>{state.photoY=+e.target.value;e.target.nextElementSibling.value=Math.round(state.photoY*100);changed(false);});
    $('#phrase-input').addEventListener('input',e=>{state.phrase=e.target.value;state.phraseId=null;changed(false);});
    $('#highlight-input').addEventListener('input',e=>{state.highlight=e.target.value;changed(false);});
    $('#text-size').addEventListener('input',e=>{state.textSize=+e.target.value;e.target.nextElementSibling.value=state.textSize;changed(false);});
    $$('#text-tone button').forEach(b=>b.addEventListener('click',()=>{state.textTone=b.dataset.value;syncChoice('#text-tone',state.textTone);changed();}));
    $('#signature-enabled').addEventListener('change',e=>{state.signatureEnabled=e.target.checked;changed();});
    $$('#signature-position button').forEach(b=>b.addEventListener('click',()=>{state.signaturePosition=b.dataset.value;syncChoice('#signature-position',state.signaturePosition);changed();}));
    $('#signature-size').addEventListener('input',e=>{state.signatureSize=+e.target.value;e.target.nextElementSibling.value=state.signatureSize+'%';changed(false);});
    $('#replace-photo').addEventListener('click',()=>{$('#photo-file').dataset.action='replace';$('#photo-file').click();});
    $('#photo-file').addEventListener('change',handlePhotoFile);
    $('#add-image').addEventListener('click',()=>$('#overlay-file').click());
    $('#overlay-file').addEventListener('change',handleOverlayFile);
    $('#choose-phrase').addEventListener('click',()=>{phrasePickerMode=true;previousScreen='editor';showScreen('phrases',false);});
    $('#go-sticker-library').addEventListener('click',()=>{stickerPickerMode=true;previousScreen='editor';showScreen('stickers',false);});
    $('#preview-button').addEventListener('click',openPreview);
    $('#save-project-button').addEventListener('click',saveProject);
    $('#export-button').addEventListener('click',exportDesign);
    $('#preview-export').addEventListener('click',exportDesign);
    $('#preview-close').addEventListener('click',closePreview); $('#preview-back').addEventListener('click',closePreview);

    canvas.addEventListener('pointerdown',pointerDown); canvas.addEventListener('pointermove',pointerMove); canvas.addEventListener('pointerup',pointerUp); canvas.addEventListener('pointercancel',pointerUp);

    // phrase manager
    $('#phrase-search').addEventListener('input',e=>{phraseView.search=e.target.value;renderPhrases();});
    $$('#phrase-status-tabs button').forEach(b=>b.addEventListener('click',()=>{phraseView.status=b.dataset.status;$$('#phrase-status-tabs button').forEach(x=>x.classList.toggle('selected',x===b));renderPhrases();}));
    $('#new-phrase').addEventListener('click',()=>openPhraseForm());
    $('#bulk-phrases').addEventListener('click',openBulkPhraseForm);
    $('#import-phrases').addEventListener('click',()=>$('#phrase-pack-file').click());
    $('#phrase-pack-file').addEventListener('change',importPhrasePack);

    // sticker manager
    $('#sticker-search').addEventListener('input',e=>{stickerView.search=e.target.value;renderStickers();});
    $('#new-sticker').addEventListener('click',()=>{$('#sticker-file').dataset.action='new';$('#sticker-file').click();});
    $('#sticker-file').addEventListener('change',handleNewStickerFile);
    $('#import-sticker-zip').addEventListener('click',()=>$('#sticker-zip-file').click());
    $('#sticker-zip-file').addEventListener('change',importStickerZip);
    $('#sticker-favorites').addEventListener('click',()=>{stickerView.favorites=!stickerView.favorites;$('#sticker-favorites').classList.toggle('selected',stickerView.favorites);renderStickers();});

    // settings
    $('#default-filter').addEventListener('change',async e=>{defaults.filter=e.target.value;await IADB.metaSet('default_filter',defaults.filter);toast('Filtro predefinito aggiornato.');});
    $('#default-format').addEventListener('change',async e=>{defaults.format=e.target.value;await IADB.metaSet('default_format',defaults.format);toast('Formato predefinito aggiornato.');});
    $('#backup-content').addEventListener('click',()=>backup(false));
    $('#backup-full').addEventListener('click',()=>backup(true));
    $('#restore-backup').addEventListener('click',()=>$('#backup-file').click());
    $('#backup-file').addEventListener('change',restoreBackup);
    $('#reseed-content').addEventListener('click',async()=>{await seedStarter(true);await refreshAll();toast('Starter Pack ripristinato.');});

    $('#modal-close').addEventListener('click',closeModal);
    $('#modal').addEventListener('click',e=>{if(e.target===$('#modal'))closeModal();});
  }

  function syncChoice(root,value){$$(root+' button').forEach(b=>b.classList.toggle('selected',b.dataset.value===value));}

  // ---------- editor lifecycle ----------
  async function startTemplate() {
    state=blankState('template'); state.templateStyle=selectedTemplate; state.phrase='Le parole giuste, al momento giusto.'; state.textSize=88;
    bgImage=null; await enterEditor(); openTool('text');
  }
  async function handlePhotoFile(e) {
    const f=e.target.files?.[0]; if(!f)return; const data=await fileToDataURL(f);
    if(e.target.dataset.action==='new') { state=blankState('photo'); state.filter=defaults.filter; state.bgDataUrl=data; state.photoStyle='short'; }
    else state.bgDataUrl=data;
    bgImage=await loadImage(data); e.target.value=''; await enterEditor(); if(e.target.dataset.action==='new')openTool('filter');
  }
  async function enterEditor() {
    await hydrateImages(); populateStyleOptions(); syncEditorControls(); showScreen('editor'); resizeCanvas(); renderCanvas(); scheduleDraft();
  }
  function openTool(tool){$$('#tool-tabs button').forEach(b=>b.classList.toggle('selected',b.dataset.tool===tool));$$('.tool-panel').forEach(p=>p.classList.toggle('active',p.dataset.panel===tool));}
  function populateStyleOptions(){
    const el=$('#style-options');
    const opts=state.mode==='template' ? [
      ['editorial','Editoriale'],['minimal','Minimal'],['highlight','Highlight']
    ] : [['clean','Foto pulita'],['short','Frase breve'],['thought','Pensiero'],['details','Dettagli grafici']];
    const current=state.mode==='template'?state.templateStyle:state.photoStyle;
    el.innerHTML=opts.map(([v,l])=>`<button data-value="${v}" class="${v===current?'selected':''}">${l}</button>`).join('');
    el.onclick=e=>{const b=e.target.closest('button[data-value]');if(!b)return;if(state.mode==='template')state.templateStyle=b.dataset.value;else state.photoStyle=b.dataset.value;populateStyleOptions();changed();};
    $('#style-panel-title').textContent=state.mode==='template'?'Stile template':'Stile foto';
    $('#style-help').textContent=state.mode==='template'?'Mantiene la palette e la firma approvate.':'Foto pulita nasconde il testo; le altre varianti mantengono la fotografia protagonista.';
    $$('[data-photo-only]').forEach(x=>x.classList.toggle('hidden',state.mode!=='photo'));
  }
  function syncEditorControls(){
    syncChoice('#format-options',state.format);syncChoice('#filter-options',state.filter);syncChoice('#text-tone',state.textTone);syncChoice('#signature-position',state.signaturePosition);
    $('#filter-intensity').value=state.filterIntensity;$('#filter-intensity').nextElementSibling.value=state.filterIntensity+'%';
    $('#photo-zoom').value=state.photoZoom;$('#photo-zoom').nextElementSibling.value=Math.round(state.photoZoom*100)+'%';
    $('#photo-x').value=state.photoX;$('#photo-x').nextElementSibling.value=Math.round(state.photoX*100);
    $('#photo-y').value=state.photoY;$('#photo-y').nextElementSibling.value=Math.round(state.photoY*100);
    $('#phrase-input').value=state.phrase||'';$('#highlight-input').value=state.highlight||'';$('#text-size').value=state.textSize;$('#text-size').nextElementSibling.value=state.textSize;
    $('#signature-enabled').checked=state.signatureEnabled;$('#signature-size').value=state.signatureSize;$('#signature-size').nextElementSibling.value=state.signatureSize+'%';
    renderLayerControls();
  }
  function changed(doRender=true){state.updatedAt=nowISO();if(doRender)renderCanvas();else requestAnimationFrame(renderCanvas);scheduleDraft();}
  function scheduleDraft(){clearTimeout(autosaveTimer);autosaveTimer=setTimeout(()=>IADB.put('drafts',{key:'current',state:deepClone(state),updatedAt:nowISO()}),800);}
  async function offerDraft(){
    const d=await IADB.get('drafts','current');if(!d?.state)return;
    openModal('Hai una bozza',`<p class="muted">È presente una composizione non conclusa.</p><div class="modal-buttons"><button class="secondary-button" id="discard-draft">Elimina</button><button class="big-button" id="resume-draft">Continua</button></div>`);
    $('#discard-draft').onclick=async()=>{await IADB.del('drafts','current');closeModal();};
    $('#resume-draft').onclick=async()=>{state=d.state;closeModal();await enterEditor();};
  }

  // ---------- canvas ----------
  function resizeCanvas(){const f=formats[state.format]||formats.story;canvas.width=f.w;canvas.height=f.h;renderCanvas();}
  function filterString(){const t=state.filterIntensity/100, mix=(a,b)=>a+(b-a)*t;
    if(state.filter==='soft')return `brightness(${mix(1,1.12)}) contrast(${mix(1,.90)}) saturate(${mix(1,.94)}) sepia(${mix(0,.07)}) hue-rotate(${mix(0,-4)}deg)`;
    if(state.filter==='warm')return `brightness(${mix(1,1.07)}) contrast(${mix(1,.95)}) saturate(${mix(1,1.05)}) sepia(${mix(0,.14)}) hue-rotate(${mix(0,-4)}deg)`;
    if(state.filter==='neutral')return `brightness(${mix(1,1.03)}) contrast(${mix(1,.98)}) saturate(${mix(1,.98)})`;
    return 'none';
  }
  function renderCanvas(){
    const W=canvas.width,H=canvas.height;ctx.clearRect(0,0,W,H);ctx.fillStyle=C.cream;ctx.fillRect(0,0,W,H);
    if(state.mode==='photo'&&bgImage){ctx.save();ctx.filter=filterString();drawCover(bgImage,W,H,state.photoZoom,state.photoX,state.photoY);ctx.restore();}
    else drawTemplateBg(W,H);
    drawOverlays(W,H);
    drawPhrase(W,H);
    if(state.signatureEnabled)drawSignature(W,H);
  }
  function drawCover(img,W,H,zoom=1,px=0,py=0){const s=Math.max(W/img.width,H/img.height)*zoom,dw=img.width*s,dh=img.height*s,ex=Math.max(0,dw-W),ey=Math.max(0,dh-H);ctx.drawImage(img,(W-dw)/2-px*ex/2,(H-dh)/2-py*ey/2,dw,dh);}
  function drawTemplateBg(W,H){ctx.fillStyle=C.cream;ctx.fillRect(0,0,W,H);const st=state.templateStyle;
    if(st==='editorial'){ctx.strokeStyle=C.beige;ctx.lineWidth=Math.max(2,W*.002);ctx.beginPath();ctx.moveTo(W*.15,H*.16);ctx.lineTo(W*.37,H*.16);ctx.moveTo(W*.63,H*.16);ctx.lineTo(W*.85,H*.16);ctx.stroke();ctx.fillStyle=C.orange;ctx.font=`${Math.round(W*.11)}px Georgia`;ctx.textAlign='center';ctx.fillText('“',W/2,H*.205);}
    if(st==='minimal'){ctx.strokeStyle='#eadfd5';ctx.lineWidth=Math.max(2,W*.0015);ctx.strokeRect(W*.065,H*.055,W*.87,H*.89);}
    if(st==='highlight'){ctx.fillStyle='#f8e7dc';ctx.fillRect(W*.09,H*.12,W*.82,H*.012);}
  }
  function drawPhrase(W,H){if(!state.phrase?.trim())return;if(state.mode==='photo'&&state.photoStyle==='clean')return;
    const color=state.textTone==='light'?C.white:C.ink;const fontSize=Math.round(state.textSize*(W/1080));const maxW=W*(state.mode==='template'?.76:.78);let y=H*.48, bg=false;
    if(state.mode==='template'){if(state.templateStyle==='editorial')y=H*.44;if(state.templateStyle==='minimal')y=H*.46;if(state.templateStyle==='highlight')y=H*.43;}
    else {if(state.photoStyle==='short')y=H*.20;if(state.photoStyle==='thought'){y=H*.26;bg=true;}if(state.photoStyle==='details')y=H*.18;}
    if(bg){ctx.save();ctx.fillStyle=state.textTone==='light'?'rgba(33,17,13,.42)':'rgba(246,241,234,.78)';roundRect(ctx,W*.09,H*.12,W*.82,H*.31,30);ctx.fill();ctx.restore();}
    if(state.mode==='photo'&&state.textTone==='light'){ctx.shadowColor='rgba(0,0,0,.32)';ctx.shadowBlur=12;ctx.shadowOffsetY=3;}
    const baseFont=`${fontSize}px Georgia, serif`, accentFont=`italic ${fontSize}px Georgia, serif`;
    drawMixedCentered(state.phrase,state.highlight,W/2,y,maxW,Math.round(fontSize*1.23),baseFont,accentFont,color,C.orange);
    ctx.shadowColor='transparent';ctx.shadowBlur=0;ctx.shadowOffsetY=0;
  }
  function segmentTokens(text,highlight){
    const h=highlight?.trim();if(!h){return text.split(/(\s+)/).filter(Boolean).map(t=>({t,accent:false}));}
    const idx=text.toLowerCase().indexOf(h.toLowerCase());if(idx<0)return text.split(/(\s+)/).filter(Boolean).map(t=>({t,accent:false}));
    const parts=[{s:text.slice(0,idx),a:false},{s:text.slice(idx,idx+h.length),a:true},{s:text.slice(idx+h.length),a:false}];
    return parts.flatMap(p=>p.s.split(/(\s+)/).filter(Boolean).map(t=>({t,accent:p.a})));
  }
  function drawMixedCentered(text,highlight,cx,cy,maxWidth,lineH,baseFont,accentFont,baseColor,accentColor){
    const tokens=segmentTokens(text,highlight);const lines=[];let line=[],w=0;
    for(const tok of tokens){ctx.font=tok.accent?accentFont:baseFont;const tw=ctx.measureText(tok.t).width;if(w+tw>maxWidth&&line.length&&!/^\s+$/.test(tok.t)){lines.push(line);line=[];w=0;}line.push({...tok,w:tw});w+=tw;}
    if(line.length)lines.push(line);const total=lines.length*lineH;let y=cy-total/2+lineH*.78;
    for(const ln of lines){const lw=ln.reduce((a,b)=>a+b.w,0);let x=cx-lw/2;for(const tok of ln){ctx.font=tok.accent?accentFont:baseFont;ctx.fillStyle=tok.accent?accentColor:baseColor;ctx.textAlign='left';ctx.fillText(tok.t,x,y);x+=tok.w;}y+=lineH;}
  }
  function drawSignature(W,H){if(!signatureImage)return;const base=state.mode==='template'?.42:.31;const w=W*base*(state.signatureSize/78),h=w*(signatureImage.height/signatureImage.width);let x=W/2-w/2;if(state.signaturePosition==='left')x=W*.055;if(state.signaturePosition==='right')x=W*.945-w;const y=H-h-H*.045;ctx.drawImage(signatureImage,x,y,w,h);}
  function drawOverlays(W,H){for(const o of state.overlays){const img=imageCache.get(o.id);if(!img)continue;const x=o.x*W,y=o.y*H,w=o.w*W,h=o.h*H;ctx.save();ctx.translate(x,y);ctx.rotate((o.rotation||0)*Math.PI/180);ctx.globalAlpha=o.opacity??1;ctx.drawImage(img,-w/2,-h/2,w,h);if(o.id===state.selectedOverlayId){ctx.globalAlpha=1;ctx.strokeStyle=C.orange;ctx.lineWidth=Math.max(3,W*.003);ctx.setLineDash([14,9]);ctx.strokeRect(-w/2,-h/2,w,h);ctx.setLineDash([]);}ctx.restore();}}
  function roundRect(c,x,y,w,h,r){c.beginPath();c.roundRect?c.roundRect(x,y,w,h,r):(c.rect(x,y,w,h));}

  // ---------- overlays ----------
  async function handleOverlayFile(e){const f=e.target.files?.[0];if(!f)return;if(state.overlays.length>=5){toast('Puoi aggiungere massimo 5 elementi.');return;}const src=await fileToDataURL(f);await addOverlay(src,f.name,'image');e.target.value='';}
  async function addOverlay(src,title,type='image'){const img=await loadImage(src);const id=uid('ov'),aspect=img.width/img.height;const w=.32,h=w/aspect;state.overlays.push({id,type,title,x:.5,y:.5,w,h,rotation:0,opacity:1,src});imageCache.set(id,img);state.selectedOverlayId=id;renderLayerControls();changed();openTool(type==='sticker'?'sticker':'image');}
  function pointerDown(e){const p=canvasPoint(e);const hit=[...state.overlays].reverse().find(o=>hitOverlay(p,o));if(!hit)return;state.selectedOverlayId=hit.id;drag={id:hit.id,dx:p.x-hit.x*canvas.width,dy:p.y-hit.y*canvas.height};canvas.setPointerCapture?.(e.pointerId);renderLayerControls();renderCanvas();}
  function pointerMove(e){if(!drag)return;const o=state.overlays.find(x=>x.id===drag.id);if(!o)return;const p=canvasPoint(e);o.x=Math.max(0,Math.min(1,(p.x-drag.dx)/canvas.width));o.y=Math.max(0,Math.min(1,(p.y-drag.dy)/canvas.height));changed(false);}
  function pointerUp(){if(drag){drag=null;scheduleDraft();}}
  function canvasPoint(e){const r=canvas.getBoundingClientRect();return{x:(e.clientX-r.left)*(canvas.width/r.width),y:(e.clientY-r.top)*(canvas.height/r.height)}}
  function hitOverlay(p,o){const w=o.w*canvas.width,h=o.h*canvas.height,x=o.x*canvas.width,y=o.y*canvas.height;return p.x>x-w/2&&p.x<x+w/2&&p.y>y-h/2&&p.y<y+h/2;}
  function renderLayerControls(){const box=$('#layer-controls'),o=state.overlays.find(x=>x.id===state.selectedOverlayId);if(!o){box.className='layer-controls empty-state';box.innerHTML='Nessun elemento selezionato.';return;}box.className='layer-controls';box.innerHTML=`<div class="layer-card"><b>${escapeHtml(o.title||'Elemento')}</b><button id="layer-delete">Elimina</button></div><label class="range-row">Dimensione <input id="layer-size" type="range" min="8" max="85" value="${Math.round(o.w*100)}"><output>${Math.round(o.w*100)}%</output></label><label class="range-row">Rotazione <input id="layer-rotate" type="range" min="-180" max="180" value="${o.rotation||0}"><output>${o.rotation||0}°</output></label><label class="range-row">Opacità <input id="layer-opacity" type="range" min="10" max="100" value="${Math.round((o.opacity??1)*100)}"><output>${Math.round((o.opacity??1)*100)}%</output></label><button class="secondary-button" id="layer-back">Porta dietro</button><button class="secondary-button" id="layer-front">Porta avanti</button><button class="secondary-button" id="layer-dup">Duplica</button>`;
    $('#layer-size').oninput=e=>{const img=imageCache.get(o.id);const aspect=(img?.width||1)/(img?.height||1);o.w=+e.target.value/100;o.h=o.w/aspect;e.target.nextElementSibling.value=e.target.value+'%';changed(false);};
    $('#layer-rotate').oninput=e=>{o.rotation=+e.target.value;e.target.nextElementSibling.value=e.target.value+'°';changed(false);};
    $('#layer-opacity').oninput=e=>{o.opacity=+e.target.value/100;e.target.nextElementSibling.value=e.target.value+'%';changed(false);};
    $('#layer-delete').onclick=()=>{state.overlays=state.overlays.filter(x=>x.id!==o.id);imageCache.delete(o.id);state.selectedOverlayId=null;renderLayerControls();changed();};
    $('#layer-front').onclick=()=>{state.overlays=state.overlays.filter(x=>x.id!==o.id).concat(o);changed();};
    $('#layer-back').onclick=()=>{state.overlays=[o,...state.overlays.filter(x=>x.id!==o.id)];changed();};
    $('#layer-dup').onclick=async()=>{if(state.overlays.length>=5)return toast('Massimo 5 elementi.');const copy={...deepClone(o),id:uid('ov'),x:Math.min(.9,o.x+.05),y:Math.min(.9,o.y+.05)};state.overlays.push(copy);imageCache.set(copy.id,imageCache.get(o.id));state.selectedOverlayId=copy.id;renderLayerControls();changed();};
  }

  // ---------- phrase manager ----------
  async function renderPhrases(){if(!$('#phrase-list'))return;const all=await IADB.getAll('phrases');
    const cats=[...new Set(all.map(x=>x.category))].sort((a,b)=>(categoryLabels[a]||a).localeCompare(categoryLabels[b]||b));
    const chips=$('#phrase-category-chips');chips.innerHTML=`<button data-cat="all" class="${phraseView.category==='all'?'selected':''}">Tutte</button>`+cats.map(c=>{const rem=all.filter(x=>x.category===c&&!x.used&&x.active).length;return `<button data-cat="${escapeAttr(c)}" class="${phraseView.category===c?'selected':''}">${escapeHtml(categoryLabels[c]||c)} · ${rem}</button>`}).join('');
    chips.onclick=e=>{const b=e.target.closest('button[data-cat]');if(!b)return;phraseView.category=b.dataset.cat;renderPhrases();};
    const q=normalize(phraseView.search);let arr=all.filter(x=>x.active!==false);
    if(phraseView.status==='available')arr=arr.filter(x=>!x.used);if(phraseView.status==='used')arr=arr.filter(x=>x.used);if(phraseView.status==='favorite')arr=arr.filter(x=>x.favorite);
    if(phraseView.category!=='all')arr=arr.filter(x=>x.category===phraseView.category);if(q)arr=arr.filter(x=>normalize(x.text+' '+(x.tags||[]).join(' ')).includes(q));
    arr.sort((a,b)=>(b.favorite-a.favorite)||((b.updatedAt||'').localeCompare(a.updatedAt||'')));
    const list=$('#phrase-list');if(!arr.length){list.innerHTML='<div class="empty-state">Nessuna frase in questa selezione.</div>';return;}
    list.innerHTML=arr.map(x=>`<article class="phrase-item" data-id="${escapeAttr(x.id)}"><p class="phrase-text">${escapeHtml(x.text)}</p><div class="phrase-meta"><small>${escapeHtml(categoryLabels[x.category]||x.category)}${x.used&&x.usedAt?' · usata '+formatDate(x.usedAt):''}</small><div class="phrase-actions"><button data-act="fav">${x.favorite?'♥':'♡'}</button><button data-act="more">•••</button></div></div></article>`).join('');
    list.onclick=async e=>{const item=e.target.closest('.phrase-item');if(!item)return;const id=item.dataset.id;const ph=all.find(x=>x.id===id);const act=e.target.closest('button')?.dataset.act;
      if(act==='fav'){ph.favorite=!ph.favorite;ph.updatedAt=nowISO();await IADB.put('phrases',ph);renderPhrases();return;}
      if(act==='more'){openPhraseDetail(ph);return;}
      if(phrasePickerMode){state.phrase=ph.text;state.phraseId=ph.id;phrasePickerMode=false;showScreen('editor',false);syncEditorControls();renderCanvas();scheduleDraft();}
      else openPhraseDetail(ph);
    };
  }
  function openPhraseDetail(ph){openModal('Dettaglio frase',`<div class="form-stack"><p style="font-family:Georgia,serif;font-size:25px;line-height:1.3">${escapeHtml(ph.text)}</p><p class="muted">${escapeHtml(categoryLabels[ph.category]||ph.category)} · ${ph.used?'già usata':'disponibile'} · ${ph.useCount||0} utilizzi</p></div><div class="modal-buttons"><button class="secondary-button" id="ph-edit">Modifica</button><button class="secondary-button" id="ph-toggle">${ph.used?'Rendi disponibile':'Segna usata'}</button></div><button class="secondary-button full" id="ph-delete" style="color:#b93c2d;border-color:#e9b5ae">Elimina frase</button>`);
    $('#ph-edit').onclick=()=>openPhraseForm(ph);$('#ph-toggle').onclick=async()=>{ph.used=!ph.used;ph.usedAt=ph.used?nowISO():null;if(ph.used)ph.useCount=(ph.useCount||0)+1;ph.updatedAt=nowISO();await IADB.put('phrases',ph);closeModal();renderPhrases();refreshHome();};$('#ph-delete').onclick=async()=>{if(confirm('Eliminare questa frase?')){await IADB.del('phrases',ph.id);closeModal();renderPhrases();refreshHome();}};
  }
  function openPhraseForm(ph=null){const cats=Object.entries(categoryLabels);openModal(ph?'Modifica frase':'Nuova frase',`<div class="form-stack"><label>Testo<textarea id="pf-text" rows="5">${ph?escapeHtml(ph.text):''}</textarea></label><label>Categoria<select id="pf-cat">${cats.map(([v,l])=>`<option value="${v}" ${ph?.category===v?'selected':''}>${l}</option>`).join('')}<option value="__new">+ Nuova categoria</option></select></label><label>Tag, separati da virgola<input id="pf-tags" class="field" value="${escapeAttr((ph?.tags||[]).join(', '))}"></label><label class="checkbox-row"><input id="pf-fav" type="checkbox" ${ph?.favorite?'checked':''}> Preferita</label><label class="checkbox-row"><input id="pf-used" type="checkbox" ${ph?.used?'checked':''}> Già utilizzata</label></div><div class="modal-buttons"><button class="secondary-button" id="pf-cancel">Annulla</button><button class="big-button" id="pf-save">Salva</button></div>`);
    $('#pf-cancel').onclick=closeModal;$('#pf-save').onclick=async()=>{let cat=$('#pf-cat').value;if(cat==='__new'){cat=prompt('Nome nuova categoria:')?.trim();if(!cat)return;cat=normalize(cat).replace(/[^a-z0-9]+/g,'_');categoryLabels[cat]=prompt('Etichetta categoria:')?.trim()||cat.replaceAll('_',' ');}const text=$('#pf-text').value.trim();if(!text)return toast('Inserisci il testo.');const rec=ph?{...ph}:{id:uid('ph'),createdAt:nowISO(),useCount:0,source:'manuale',active:true};rec.text=text;rec.category=cat;rec.tags=$('#pf-tags').value.split(',').map(x=>x.trim()).filter(Boolean);rec.favorite=$('#pf-fav').checked;const newUsed=$('#pf-used').checked;if(newUsed&&!rec.used){rec.usedAt=nowISO();rec.useCount=(rec.useCount||0)+1;}if(!newUsed)rec.usedAt=null;rec.used=newUsed;rec.updatedAt=nowISO();await IADB.put('phrases',rec);closeModal();await renderPhrases();await refreshHome();toast('Frase salvata.');};
  }
  function openBulkPhraseForm(){openModal('Aggiungi più frasi',`<div class="form-stack"><p class="muted">Incolla una frase per riga oppure separale con una riga vuota.</p><label>Frasi<textarea id="bulk-text" rows="10"></textarea></label><label>Categoria<select id="bulk-cat">${Object.entries(categoryLabels).map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select></label></div><div class="modal-buttons"><button class="secondary-button" id="bulk-cancel">Annulla</button><button class="big-button" id="bulk-save">Aggiungi</button></div>`);$('#bulk-cancel').onclick=closeModal;$('#bulk-save').onclick=async()=>{const raw=$('#bulk-text').value.trim();if(!raw)return;const pieces=raw.includes('\n\n')?raw.split(/\n\s*\n/):raw.split(/\n+/);const existing=new Set((await IADB.getAll('phrases')).map(x=>normalize(x.text)));const recs=pieces.map(x=>x.trim()).filter(Boolean).filter(x=>!existing.has(normalize(x))).map(text=>({id:uid('ph'),category:$('#bulk-cat').value,text,tags:[],used:false,usedAt:null,useCount:0,favorite:false,active:true,source:'manuale_bulk',createdAt:nowISO(),updatedAt:nowISO()}));await IADB.bulkPut('phrases',recs);closeModal();renderPhrases();refreshHome();toast(`${recs.length} frasi aggiunte.`);};}
  async function importPhrasePack(e){const f=e.target.files?.[0];if(!f)return;try{let recs=[];if(f.name.toLowerCase().endsWith('.zip')){const zip=await IAZip.read(f);const key=[...zip.keys()].find(k=>k.toLowerCase().endsWith('.json'))||[...zip.keys()].find(k=>k.toLowerCase().endsWith('.csv'));if(!key)throw new Error('Nel pacchetto non c’è un file JSON o CSV.');recs=parsePhraseData(key.toLowerCase().endsWith('.json')?JSON.parse(IAZip.text(zip.get(key))):IAZip.text(zip.get(key)),key);}else if(f.name.toLowerCase().endsWith('.json'))recs=parsePhraseData(JSON.parse(await f.text()),f.name);else recs=parsePhraseData(await f.text(),f.name);const existing=new Set((await IADB.getAll('phrases')).map(x=>normalize(x.text)));recs=recs.filter(x=>x.text&&!existing.has(normalize(x.text)));if(recs.length)await IADB.bulkPut('phrases',recs);toast(`${recs.length} nuove frasi importate.`);await renderPhrases();await refreshHome();}catch(err){toast('Importazione non riuscita: '+err.message);}e.target.value='';}
  function parsePhraseData(data,name=''){let rows=[];if(typeof data==='string'){const lines=data.split(/\r?\n/).filter(Boolean);if(!lines.length)return[];const sep=lines[0].includes(';')?';':',';const header=parseCSVLine(lines.shift(),sep).map(x=>normalize(x));rows=lines.map(l=>{const vals=parseCSVLine(l,sep);const o={};header.forEach((h,i)=>o[h]=vals[i]||'');return o;});}else rows=Array.isArray(data)?data:(data.entries||data.phrases||[]);return rows.map(r=>({id:uid('ph'),category:r.category||r.categoria||'vita_reale',text:r.text||r.testo||r.frase||'',tags:Array.isArray(r.tags)?r.tags:String(r.tags||'').split(',').map(x=>x.trim()).filter(Boolean),used:!!(r.used??r.gia_usata),usedAt:(r.used??r.gia_usata)?nowISO():null,useCount:(r.used??r.gia_usata)?1:0,favorite:!!r.favorite,active:r.active!==false&&r.attiva_per_suggerimenti!==false,source:'import:'+name,createdAt:nowISO(),updatedAt:nowISO()}));}
  function parseCSVLine(line,sep=','){const out=[];let cur='',q=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(q&&line[i+1]==='"'){cur+='"';i++;}else q=!q;}else if(c===sep&&!q){out.push(cur);cur='';}else cur+=c;}out.push(cur);return out;}

  // ---------- sticker manager ----------
  async function renderStickers(){if(!$('#sticker-grid'))return;const all=await IADB.getAll('stickers');const cats=[...new Set(all.map(x=>x.category))].sort();const chips=$('#sticker-category-chips');chips.innerHTML=`<button data-cat="all" class="${stickerView.category==='all'?'selected':''}">Tutti</button>`+cats.map(c=>`<button data-cat="${escapeAttr(c)}" class="${stickerView.category===c?'selected':''}">${escapeHtml(c)}</button>`).join('');chips.onclick=e=>{const b=e.target.closest('button[data-cat]');if(!b)return;stickerView.category=b.dataset.cat;renderStickers();};const q=normalize(stickerView.search);let arr=all.filter(x=>x.active!==false);if(stickerView.category!=='all')arr=arr.filter(x=>x.category===stickerView.category);if(stickerView.favorites)arr=arr.filter(x=>x.favorite);if(q)arr=arr.filter(x=>normalize(x.title+' '+x.category+' '+(x.tags||[]).join(' ')).includes(q));const grid=$('#sticker-grid');if(!arr.length){grid.innerHTML='<div class="empty-state" style="grid-column:1/-1">Nessuno sticker.</div>';return;}grid.innerHTML=arr.map(s=>`<div class="sticker-card" data-id="${escapeAttr(s.id)}"><img loading="lazy" src="${escapeAttr(s.src)}" alt="${escapeAttr(s.title)}"><button class="fav" data-act="fav">${s.favorite?'♥':'♡'}</button><div class="title">${escapeHtml(s.title)}</div></div>`).join('');grid.onclick=async e=>{const card=e.target.closest('.sticker-card');if(!card)return;const s=all.find(x=>x.id===card.dataset.id);if(e.target.closest('[data-act=fav]')){s.favorite=!s.favorite;s.updatedAt=nowISO();await IADB.put('stickers',s);renderStickers();renderEditorStickerGrid();return;}if(stickerPickerMode){stickerPickerMode=false;await addOverlay(s.src,s.title,'sticker');showScreen('editor',false);}else openStickerDetail(s);};}
  async function renderEditorStickerGrid(){const all=await IADB.getAll('stickers');const cats=[...new Set(all.map(x=>x.category))].sort();const chip=$('#editor-sticker-cats');if(!chip)return;let cat=chip.dataset.cat||'all';chip.innerHTML=`<button data-cat="all" class="${cat==='all'?'selected':''}">Tutti</button>`+cats.slice(0,8).map(c=>`<button data-cat="${escapeAttr(c)}" class="${cat===c?'selected':''}">${escapeHtml(c)}</button>`).join('');chip.onclick=e=>{const b=e.target.closest('button[data-cat]');if(!b)return;chip.dataset.cat=b.dataset.cat;renderEditorStickerGrid();};let arr=all.filter(x=>x.active!==false);if(cat!=='all')arr=arr.filter(x=>x.category===cat);arr=arr.slice(0,16);const grid=$('#editor-sticker-grid');grid.innerHTML=arr.map(s=>`<button class="sticker-card" data-id="${escapeAttr(s.id)}"><img src="${escapeAttr(s.src)}" alt=""><div class="title">${escapeHtml(s.title)}</div></button>`).join('');grid.onclick=async e=>{const c=e.target.closest('.sticker-card');if(!c)return;const s=all.find(x=>x.id===c.dataset.id);await addOverlay(s.src,s.title,'sticker');};}
  function openStickerDetail(s){openModal(s.title,`<div style="text-align:center"><img src="${escapeAttr(s.src)}" style="max-width:260px;max-height:260px;object-fit:contain"><p class="muted">${escapeHtml(s.category)} · ${escapeHtml(s.style||'')}</p></div><div class="modal-buttons"><button class="secondary-button" id="stk-fav">${s.favorite?'Togli preferito':'Preferito'}</button><button class="secondary-button" id="stk-delete">Elimina</button></div>`);$('#stk-fav').onclick=async()=>{s.favorite=!s.favorite;await IADB.put('stickers',s);closeModal();renderStickers();renderEditorStickerGrid();};$('#stk-delete').onclick=async()=>{if(confirm('Eliminare questo sticker dalla libreria?')){await IADB.del('stickers',s.id);closeModal();renderStickers();renderEditorStickerGrid();refreshHome();}};}
  async function handleNewStickerFile(e){const f=e.target.files?.[0];if(!f)return;const src=await fileToDataURL(f);openModal('Nuovo sticker',`<div style="text-align:center"><img src="${escapeAttr(src)}" style="max-width:220px;max-height:220px;object-fit:contain"></div><div class="form-stack"><label>Nome<input class="field" id="ns-title" value="${escapeAttr(f.name.replace(/\.[^.]+$/,''))}"></label><label>Categoria<input class="field" id="ns-cat" value="Lifestyle"></label><label>Tag<input class="field" id="ns-tags"></label><label class="checkbox-row"><input id="ns-fav" type="checkbox"> Preferito</label></div><div class="modal-buttons"><button class="secondary-button" id="ns-cancel">Annulla</button><button class="big-button" id="ns-save">Salva</button></div>`);$('#ns-cancel').onclick=closeModal;$('#ns-save').onclick=async()=>{const rec={id:uid('stk'),title:$('#ns-title').value.trim()||'Sticker',category:$('#ns-cat').value.trim()||'Importati',style:'custom',tags:$('#ns-tags').value.split(',').map(x=>x.trim()).filter(Boolean),favorite:$('#ns-fav').checked,active:true,src,sourceType:'custom',source:'manuale',createdAt:nowISO(),updatedAt:nowISO()};await IADB.put('stickers',rec);closeModal();renderStickers();renderEditorStickerGrid();refreshHome();toast('Sticker aggiunto.');};e.target.value='';}
  async function importStickerZip(e){const f=e.target.files?.[0];if(!f)return;try{toast('Sto leggendo il pacchetto…');const zip=await IAZip.read(f);const keys=[...zip.keys()];const manifestKey=keys.find(k=>k.toLowerCase().endsWith('manifest.json'));let recs=[];if(manifestKey){const m=JSON.parse(IAZip.text(zip.get(manifestKey)));for(const s of m.stickers||[]){const imgKey=keys.find(k=>k.endsWith('/'+s.file)||k.endsWith(s.file));if(!imgKey)continue;recs.push({id:uid('stk'),title:s.title||fileTitle(imgKey),category:s.category||'Importati',style:s.style||'pack',tags:s.tags||[],favorite:false,active:s.active!==false,src:IAZip.dataUrl(zip.get(imgKey),IAZip.mimeFor(imgKey)),sourceType:'custom',source:f.name,createdAt:nowISO(),updatedAt:nowISO()});}}else{for(const k of keys.filter(k=>/\.(png|webp|jpe?g)$/i.test(k))){recs.push({id:uid('stk'),title:fileTitle(k),category:'Importati',style:'pack',tags:[],favorite:false,active:true,src:IAZip.dataUrl(zip.get(k),IAZip.mimeFor(k)),sourceType:'custom',source:f.name,createdAt:nowISO(),updatedAt:nowISO()});}}
      const existing=new Set((await IADB.getAll('stickers')).map(x=>`${normalize(x.title)}|${x.style||''}`));recs=recs.filter(x=>!existing.has(`${normalize(x.title)}|${x.style||''}`));if(recs.length)await IADB.bulkPut('stickers',recs);toast(`${recs.length} sticker importati.`);await renderStickers();await renderEditorStickerGrid();await refreshHome();}catch(err){toast('ZIP non importato: '+err.message);}e.target.value='';}

  // ---------- projects ----------
  async function saveProject(){const preview=canvas.toDataURL('image/jpeg',.72);const rec={id:state.projectId||uid('prj'),title:projectTitle(),state:deepClone(state),preview,createdAt:state.projectId?(await IADB.get('projects',state.projectId))?.createdAt||nowISO():nowISO(),updatedAt:nowISO()};rec.state.projectId=rec.id;state.projectId=rec.id;await IADB.put('projects',rec);await IADB.del('drafts','current');toast('Progetto salvato.');await refreshHome();await renderProjects();scheduleDraft();}
  async function renderProjects(){const all=(await IADB.getAll('projects')).sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||''));const box=$('#projects-list');if(!box)return;if(!all.length){box.innerHTML='<div class="empty-state" style="grid-column:1/-1">Nessun progetto salvato.</div>';return;}box.innerHTML=all.map(p=>`<article class="project-card" data-id="${escapeAttr(p.id)}"><img src="${escapeAttr(p.preview)}" alt=""><div class="project-card-info"><strong>${escapeHtml(p.title)}</strong><small>${formatDate(p.updatedAt)}</small></div><div class="project-actions"><button data-act="open">Apri</button><button data-act="dup">Duplica</button><button data-act="export">Esporta</button><button data-act="delete">Elimina</button></div></article>`).join('');box.onclick=async e=>{const card=e.target.closest('.project-card');if(!card)return;const act=e.target.closest('button')?.dataset.act;if(!act)return;const p=all.find(x=>x.id===card.dataset.id);if(act==='open'){state=deepClone(p.state);state.projectId=p.id;await enterEditor();}if(act==='dup'){const cp=deepClone(p);cp.id=uid('prj');cp.title=p.title+' copia';cp.state.projectId=cp.id;cp.createdAt=cp.updatedAt=nowISO();await IADB.put('projects',cp);renderProjects();refreshHome();toast('Progetto duplicato.');}if(act==='delete'&&confirm('Eliminare questo progetto?')){await IADB.del('projects',p.id);renderProjects();refreshHome();}if(act==='export'){state=deepClone(p.state);state.projectId=p.id;await hydrateImages();resizeCanvas();renderCanvas();await exportDesign();}};}
  function projectTitle(){return `${state.mode==='template'?'Template':'Foto'} · ${formats[state.format].label}`;}

  // ---------- preview/export ----------
  function openPreview(){renderCanvas();const img=document.createElement('img');img.src=canvas.toDataURL('image/png');img.style.maxWidth='94vw';img.style.maxHeight='70dvh';img.style.objectFit='contain';const wrap=$('#preview-canvas-wrap');wrap.innerHTML='';wrap.appendChild(img);$('#preview-overlay').classList.add('open');}
  function closePreview(){$('#preview-overlay').classList.remove('open');}
  async function exportDesign(){try{renderCanvas();if($('#save-manual-phrase').checked&&state.phrase&&!state.phraseId){const ph={id:uid('ph'),category:'vita_reale',text:state.phrase,tags:[],used:true,usedAt:nowISO(),useCount:1,favorite:false,active:true,source:'editor',createdAt:nowISO(),updatedAt:nowISO()};await IADB.put('phrases',ph);state.phraseId=ph.id;}else if(state.phraseId){const ph=await IADB.get('phrases',state.phraseId);if(ph){ph.used=true;ph.usedAt=nowISO();ph.useCount=(ph.useCount||0)+1;ph.updatedAt=nowISO();await IADB.put('phrases',ph);}}
      const isTemplate=state.mode==='template';const mime=isTemplate?'image/png':'image/jpeg',ext=isTemplate?'png':'jpg';const blob=await new Promise(r=>canvas.toBlob(r,mime,isTemplate?1:.94));const file=new File([blob],`IA_${state.format}_${new Date().toISOString().slice(0,10)}_${String(Date.now()).slice(-5)}.${ext}`,{type:mime});closePreview();await IADB.del('drafts','current');await renderPhrases();await refreshHome();if(navigator.canShare?.({files:[file]})){await navigator.share({files:[file],title:'Ironicamente Acida'});}else downloadBlob(blob,file.name);openModal('Fatto ♥',`<p class="muted">La grafica è pronta. ${state.phraseId?'La frase è stata contrassegnata come utilizzata.':''}</p><div class="modal-buttons"><button class="secondary-button" id="done-home">Home</button><button class="big-button" id="done-another">Creane un’altra</button></div>`);$('#done-home').onclick=()=>{closeModal();showScreen('home');};$('#done-another').onclick=()=>{closeModal();if(state.mode==='template')showScreen('templates');else{$('#photo-file').dataset.action='new';$('#photo-file').click();}};}catch(err){if(err?.name!=='AbortError')toast('Salvataggio non riuscito: '+err.message);}}

  // ---------- backup ----------
  async function backup(full){const data={app:'Ironicamente Acida',version:'1.0-master',exportedAt:nowISO(),type:full?'full':'content',phrases:await IADB.getAll('phrases'),stickers:await IADB.getAll('stickers'),meta:{default_filter:defaults.filter,default_format:defaults.format}};if(full)data.projects=await IADB.getAll('projects');const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});downloadBlob(blob,`IA_backup_${full?'completo':'contenuti'}_${new Date().toISOString().slice(0,10)}.json`);toast('Backup creato.');}
  async function restoreBackup(e){const f=e.target.files?.[0];if(!f)return;try{const d=JSON.parse(await f.text());if(d.phrases?.length)await IADB.bulkPut('phrases',d.phrases);if(d.stickers?.length)await IADB.bulkPut('stickers',d.stickers);if(d.projects?.length)await IADB.bulkPut('projects',d.projects);if(d.meta?.default_filter){defaults.filter=d.meta.default_filter;await IADB.metaSet('default_filter',defaults.filter);}if(d.meta?.default_format){defaults.format=d.meta.default_format;await IADB.metaSet('default_format',defaults.format);}await refreshAll();await loadSettingsUI();toast('Backup ripristinato.');}catch(err){toast('Backup non valido: '+err.message);}e.target.value='';}

  // ---------- dashboards ----------
  async function refreshHome(){const phrases=await IADB.getAll('phrases'),stickers=await IADB.getAll('stickers'),projects=(await IADB.getAll('projects')).sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||''));const avail=phrases.filter(x=>!x.used&&x.active!==false).length;$('#home-phrases-count').textContent=`${avail} disponibili`;$('#home-stickers-count').textContent=`${stickers.filter(x=>x.active!==false).length} elementi`;$('#home-projects-count').textContent=`${projects.length} salvati`;const recent=$('#home-recent');if(!projects.length)recent.innerHTML='Nessun progetto salvato.';else{recent.classList.remove('empty-state');recent.innerHTML=projects.slice(0,3).map(p=>`<button class="project-thumb" data-id="${escapeAttr(p.id)}"><img src="${escapeAttr(p.preview)}" alt=""><small>${formatDate(p.updatedAt)}</small></button>`).join('');recent.onclick=async e=>{const b=e.target.closest('[data-id]');if(!b)return;const p=projects.find(x=>x.id===b.dataset.id);state=deepClone(p.state);state.projectId=p.id;await enterEditor();};}
    const counts={};Object.keys(categoryLabels).forEach(c=>counts[c]=0);phrases.filter(x=>!x.used&&x.active!==false).forEach(x=>counts[x.category]=(counts[x.category]||0)+1);const low=Object.entries(counts).filter(([,n])=>n<10);$('#low-phrase-alerts').innerHTML=low.map(([c,n])=>`<div class="warning-card"><strong>${escapeHtml(categoryLabels[c]||c)} sta finendo</strong>Restano ${n} frasi non utilizzate.</div>`).join('');}
  async function updateStats(){const [p,s,pr]=await Promise.all([IADB.getAll('phrases'),IADB.getAll('stickers'),IADB.getAll('projects')]);$('#stats-phrases').textContent=p.length;$('#stats-stickers').textContent=s.length;$('#stats-projects').textContent=pr.length;}
  async function loadSettingsUI(){$('#default-filter').value=defaults.filter;$('#default-format').value=defaults.format;}

  // ---------- utils ----------
  async function hydrateImages(){imageCache.clear();bgImage=state.bgDataUrl?await loadImage(state.bgDataUrl).catch(()=>null):null;for(const o of state.overlays||[]){const img=await loadImage(o.src).catch(()=>null);if(img)imageCache.set(o.id,img);}state.overlays=state.overlays||[];}
  function loadImage(src){if(!src)return Promise.reject(new Error('src vuoto'));return new Promise((res,rej)=>{const im=new Image();im.onload=()=>res(im);im.onerror=()=>rej(new Error('Immagine non leggibile'));im.src=src;});}
  function fileToDataURL(f){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=()=>rej(r.error);r.readAsDataURL(f);});}
  function fileTitle(k){return k.split('/').pop().replace(/\.[^.]+$/,'').replace(/^\d+[_-]?/,'').replace(/[_-]+/g,' ').replace(/\b\w/g,m=>m.toUpperCase());}
  function formatDate(d){try{return new Intl.DateTimeFormat('it-IT',{day:'2-digit',month:'short',year:'numeric'}).format(new Date(d));}catch{return'';}}
  function escapeHtml(s=''){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
  function escapeAttr(s=''){return escapeHtml(s).replace(/'/g,'&#39;');}
  function downloadBlob(blob,name){const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1000);}
  let toastTimer;function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),2600);}
  function openModal(title,html){$('#modal-title').textContent=title;$('#modal-body').innerHTML=html;$('#modal').classList.add('open');$('#modal').setAttribute('aria-hidden','false');}
  function closeModal(){$('#modal').classList.remove('open');$('#modal').setAttribute('aria-hidden','true');}
})();
