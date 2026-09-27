const BUILD = 'V3 · build 05 ESSENTIAL';
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const uid = (p='id') => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`;
const clamp = (n,a,b) => Math.max(a,Math.min(b,n));
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const photoThumb = src => src ? `./photo_thumbs/${String(src).split('/').pop().split('?')[0]}` : '';
const stickerThumb = file => file ? `./thumbs/${String(file).split('/').pop().split('?')[0]}` : '';
const uiPhoto = src => src ? `./ui_photos/${String(src).split('/').pop().split('?')[0]}` : '';

let photos = [];
let phrases = [];
let stickers = [];
let projects = [];
let heroIndex = 0;
let toastTimer;
let currentScreen = 'home';
let objectUrls = [];
let templateCategory = 'all';
let templateQuery = '';
let projectFilter = 'all';
let revision = 0;
let exportWarmupTimer = null;
let exportCache = {revision:-1, files:null};
const imagePromiseCache = new Map();
const mediaPersistPromises = new Map();
const QUICK_STICKER_IDS = new Set(['ia_stk_001','ia_stk_002','ia_stk_003','ia_stk_010','ia_stk_011','ia_stk_012','ia_stk_013','ia_stk_016','ia_stk_018','ia_stk_026','ia_stk_027','ia_stk_030','ia_stk_033','ia_stk_035','ia_stk_046','ia_stk_047','ia_stk_048','ia_stk_049','ia_stk_050','ia_stk_051','ia_stk_052','ia_stk_053','ia_stk_070','ia_stk_078']);


const state = {
  kind: 'story',
  format: 'story',
  activeSlide: 0,
  slides: [],
  selectedLayerId: null,
  projectId: null,
  title: 'Nuovo progetto'
};

const templateDefs = [
  {id:'morning_script',cat:'morning',title:'Buongiorno essenziale',subtitle:'corsivo + respiro',text:'Buongiorno. Oggi con calma, ma non troppa.',bg:'cream',font:'script',look:'original',bgColor:'#f4eadf',preview:'script',tall:true},
  {id:'morning_editorial',cat:'morning',title:'Mattino editoriale',subtitle:'serif + accento',text:'Piccole cose. Grandi giornate.',bg:'none',font:'editorial',look:'original',bgColor:'#171310',preview:'dark'},
  {id:'story_minimal',cat:'story',title:'Nota minima',subtitle:'pulito e diretto',text:'Una cosa alla volta. Il resto può aspettare.',bg:'paper',font:'modern',look:'original',bgColor:'#efe2d5',preview:'minimal'},
  {id:'story_acid',cat:'story',title:'Pensiero acido',subtitle:'nero + arancio',text:'La mia pace interiore ha degli orari molto limitati.',bg:'none',font:'serif',look:'original',bgColor:'#0f0f0f',preview:'acid',tall:true},
  {id:'quote_book',cat:'quote',title:'Citazione editoriale',subtitle:'grande frase centrale',text:'Ci sono libri che finiscono. E libri che continuano a parlare.',bg:'none',font:'editorial',look:'original',bgColor:'#f5eee7',preview:'quote'},
  {id:'quote_script',cat:'quote',title:'Corsivo breve',subtitle:'una frase, molto spazio',text:'Resto dove le parole fanno rumore.',bg:'none',font:'script',look:'original',bgColor:'#231914',preview:'script-dark'},
  {id:'carousel_editorial',cat:'carousel',title:'Carosello editoriale',subtitle:'5 slide · stesso stile',text:'Una storia in cinque passaggi.',bg:'cream',font:'editorial',look:'original',bgColor:'#f3e7dc',preview:'carousel',tall:true},
  {id:'carousel_question',cat:'carousel',title:'Carosello domanda',subtitle:'hook + sviluppo + domanda',text:'Da dove cominciamo?',bg:'none',font:'serif',look:'original',bgColor:'#171310',preview:'carousel-dark'}
];

function defaultLayer(text='Scrivi qui', opts={}){
  return {
    id: uid('txt'), type:'text', text,
    x: opts.x ?? .5, y: opts.y ?? .72,
    width: opts.width ?? 74, fontSize: opts.fontSize ?? 52,
    font: opts.font || 'editorial', color: opts.color || (['cream','paper'].includes(opts.background || 'cream') ? '#24150f' : '#fffaf5'),
    background: opts.background || 'cream', bgOpacity: opts.bgOpacity ?? 76,
    align: opts.align || 'center'
  };
}
function signatureLayer(){ return {id:uid('sig'),type:'signature',x:.5,y:.92,width:56}; }
function newSlide(opts={}){
  return {
    id:uid('slide'), mediaType:opts.mediaType||null, assetSrc:opts.assetSrc||null, mediaBlob:null, mediaUrl:null,
    fit:opts.fit||'cover', look:opts.look||'soft', strength:opts.strength??80, bgColor:opts.bgColor||'#201713',
    layers:opts.layers||[]
  };
}
function currentSlide(){ return state.slides[state.activeSlide]; }

async function hydrateData(){
  try{
    // I dati statici rendono l'app subito utilizzabile. Il refresh da JSON/IndexedDB avviene dopo il primo paint.
    if(location.protocol !== 'file:'){
      const loadJson = async (url, ms=2500) => {
        const ctl = new AbortController(); const timer = setTimeout(()=>ctl.abort(), ms);
        try{ const r = await fetch(url,{cache:'no-store',signal:ctl.signal}); if(!r.ok) throw new Error(`${r.status} ${url}`); return await r.json(); }
        finally{ clearTimeout(timer); }
      };
      const results = await Promise.allSettled([
        loadJson('./photos.json?v=350'), loadJson('./stickers.json?v=350'), loadJson('./phrases.json?v=350')
      ]);
      if(results[0].status==='fulfilled') photos = results[0].value || photos;
      if(results[1].status==='fulfilled') stickers = results[1].value.stickers || stickers;
      if(results[2].status==='fulfilled') phrases = results[2].value.entries || phrases;
    }

    await IADB.open();
    let dbPhrases = await IADB.getAll('phrases');
    if(!dbPhrases.length){ await IADB.bulkPut('phrases', phrases); dbPhrases = phrases; }
    phrases = dbPhrases;
    let dbStickers = await IADB.getAll('stickers');
    if(!dbStickers.length){ await IADB.bulkPut('stickers', stickers); dbStickers = stickers; }
    stickers = dbStickers;
    const sp=$('#sticker-picker');if(sp){sp.dataset.ready='';sp.innerHTML='';}
    projects = await IADB.getAll('projects');

    renderTemplateGrid(); renderCounts(); renderProjects(); renderPhraseBank();
  }catch(err){
    console.error('Hydration fallback attivo',err);
    toast('Modalità locale attiva');
  }
}

async function boot(){
  const fallback = window.IA_STATIC_DATA || {photos:[],stickers:[],phrases:[]};
  photos = fallback.photos || [];
  stickers = fallback.stickers || [];
  phrases = fallback.phrases || [];

  renderTemplateGrid(); renderCounts(); renderProjects(); renderPhraseBank();
  bindEvents();

  // Il primo paint non aspetta rete o IndexedDB: evita splash bloccato su iPhone.
  await sleep(70);
  $('#boot').classList.add('hidden'); $('#app').classList.remove('hidden');

  // Aggiornamento dati e progetti in background.
  hydrateData();
}

function bindEvents(){
  document.addEventListener('error', e=>{
    const img=e.target;
    if(img instanceof HTMLImageElement && !img.dataset.fallbackApplied){
      img.dataset.fallbackApplied='1';
      img.classList.add('image-failed');
    }
  }, true);
  document.addEventListener('click', e=>{
    const nav=e.target.closest('[data-nav]'); if(nav){ showScreen(nav.dataset.nav); return; }
    const cr=e.target.closest('[data-create]'); if(cr){ closeSheets(); startCreation(cr.dataset.create); return; }
    if(e.target.closest('[data-sheet-close]')) closeSheets();
  });
  $('#hero-create').onclick=()=>openCreateSheet();
  $('#editor-close').onclick=()=>showScreen('home');
  $('#editor-save').onclick=saveProject;
  $('#editor-export').onclick=exportCurrent;
  $('#pick-photo').onclick=()=>$('#photo-input').click();
  $('#pick-video').onclick=()=>$('#video-input').click();
  $('#photo-input').onchange=e=>{ const f=e.target.files?.[0]; if(f) loadLocalMedia(f,'image'); e.target.value=''; };
  $('#video-input').onchange=e=>{ const f=e.target.files?.[0]; if(f) loadLocalMedia(f,'video'); e.target.value=''; };
  $('#stage-empty').onclick=()=>$('#photo-input').click();
  $('#add-text').onclick=()=>addTextLayer();
  $('#text-input').oninput=e=>updateSelectedText({text:e.target.value});
  $('#text-size').oninput=e=>{updateSelectedText({fontSize:+e.target.value});$('#text-size-out').value=e.target.value;};
  $('#text-width').oninput=e=>{updateSelectedText({width:+e.target.value});$('#text-width-out').value=e.target.value+'%';};
  $('#text-bg-opacity').oninput=e=>{updateSelectedText({bgOpacity:+e.target.value});$('#text-bg-opacity-out').value=e.target.value+'%';};
  $('#filter-strength').oninput=e=>{const v=+e.target.value;if(state.kind==='carousel')state.slides.forEach(sl=>sl.strength=v);else currentSlide().strength=v;$('#filter-strength-out').value=e.target.value+'%';markDirty();renderMediaLook();};
  $('#add-signature').onclick=()=>{ const targets=state.kind==='carousel'?state.slides:[currentSlide()];targets.forEach(s=>{if(!s.layers.some(x=>x.type==='signature'))s.layers.push(signatureLayer());});state.selectedLayerId=null;markDirty();renderStage(); };
  $('#remove-signature').onclick=()=>{ const targets=state.kind==='carousel'?state.slides:[currentSlide()];targets.forEach(s=>s.layers=s.layers.filter(x=>x.type!=='signature'));markDirty();renderStage(); };
  $('#new-phrase').onclick=addCustomPhrase;
  $('#delete-layer').onclick=deleteSelectedLayer;
  $('#duplicate-layer').onclick=duplicateSelectedLayer;
  $('#phrase-search').oninput=renderPhraseBank;

  $$('#editor-rail [data-tool]').forEach(b=>b.onclick=()=>selectTool(b.dataset.tool));
  $$('.editor-subtabs [data-subtab]').forEach(b=>b.onclick=()=>{
    $$('.editor-subtabs button').forEach(x=>x.classList.toggle('selected',x===b));
    $$('.subpanel').forEach(x=>x.classList.toggle('active',x.dataset.subpanel===b.dataset.subtab));
  });
  $$('.fit-row [data-fit]').forEach(b=>b.onclick=()=>{currentSlide().fit=b.dataset.fit;$$('.fit-row button').forEach(x=>x.classList.toggle('selected',x===b));markDirty();renderMediaLook();});
  $('#template-chips').onclick=e=>{const b=e.target.closest('button[data-category]');if(!b)return;templateCategory=b.dataset.category;$$('#template-chips button').forEach(x=>x.classList.toggle('selected',x===b));renderTemplateGrid();};
  $('#template-search-toggle').onclick=()=>{const i=$('#template-search');i.classList.toggle('hidden');if(!i.classList.contains('hidden'))i.focus();};
  $('#template-search').oninput=e=>{templateQuery=e.target.value.toLowerCase().trim();renderTemplateGrid();};
  $('#project-chips').onclick=e=>{const b=e.target.closest('[data-project-kind]');if(!b)return;projectFilter=b.dataset.projectKind;$$('#project-chips button').forEach(x=>x.classList.toggle('selected',x===b));renderProjects();};
}

function openCreateSheet(){ $('#create-sheet').classList.remove('hidden'); }
function closeSheets(){ $$('.sheet').forEach(s=>s.classList.add('hidden')); }
function showScreen(name){
  currentScreen=name;
  $$('.screen').forEach(s=>s.classList.toggle('active',s.dataset.screen===name));
  $('#bottom-dock').classList.toggle('hidden',name==='editor');
  const dockName=['phrases','stickers','settings'].includes(name)?'profile':name;
  $$('#bottom-dock [data-nav]').forEach(b=>b.classList.toggle('selected',b.dataset.nav===dockName || (dockName==='home'&&b.dataset.nav==='home')));
  if(name==='projects') renderProjects();
  if(name==='phrases') renderPhraseBank();
  if(name==='stickers') renderStickerBank();
  if(name==='editor')window.scrollTo(0,0);else window.scrollTo({top:0,behavior:'smooth'});
}
function toast(msg){ const t=$('#toast');t.textContent=msg;t.classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.add('hidden'),2300); }

function renderCounts(){ $('#phrase-count').textContent=`${phrases.length} frasi`;$('#sticker-count').textContent=`${stickers.length} elementi`; }
function renderTemplateGrid(){
  const list=templateDefs.filter(t=>(templateCategory==='all'||t.cat===templateCategory) && (!templateQuery || `${t.title} ${t.subtitle} ${t.cat}`.toLowerCase().includes(templateQuery)));
  $('#template-grid').innerHTML=list.map(t=>`<button class="template-card type-template ${t.tall?'tall':''} preview-${t.preview||'minimal'}" data-template-id="${t.id}"><span class="template-arrow">↗</span><div class="type-preview"><i>IRONICAMENTE ACIDA</i><strong>${escapeHtml(t.text)}</strong><u></u></div><div class="template-text"><b>${escapeHtml(t.title)}</b><small>${escapeHtml(t.subtitle)}</small></div></button>`).join('');
  $$('#template-grid [data-template-id]').forEach(b=>b.onclick=()=>useTemplate(b.dataset.templateId));
}
function renderProjects(){
  const list=[...projects].filter(p=>projectFilter==='all'||p.kind===projectFilter).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
  const html=list.length?list.map(p=>`<button class="project-card" data-project-id="${p.id}">${p.thumb?`<img src="${p.thumb}" alt="" loading="lazy" decoding="async" fetchpriority="low">`:''}<div><b>${escapeHtml(p.title||'Progetto')}</b><small>${p.kind||'contenuto'} · ${new Date(p.updatedAt||p.createdAt).toLocaleDateString('it-IT')}</small></div></button>`).join(''):'<div class="empty-state">Nessun progetto salvato.</div>';
  $('#project-grid').innerHTML=html;
  $('#home-recent').innerHTML=list.length?list.slice(0,4).map(p=>`<button class="project-card" data-project-id="${p.id}">${p.thumb?`<img src="${p.thumb}" alt="" loading="lazy" decoding="async" fetchpriority="low">`:''}<div><b>${escapeHtml(p.title||'Progetto')}</b><small>${p.kind||''}</small></div></button>`).join(''):'<div class="empty-mini">I progetti salvati appariranno qui.</div>';
  $$('[data-project-id]').forEach(b=>b.onclick=()=>openProject(b.dataset.projectId));
}
function renderPhraseBank(){
  const q=($('#phrase-search')?.value||'').toLowerCase().trim();
  const list=phrases.filter(p=>!q||(p.testo||'').toLowerCase().includes(q)).slice(0,100);
  $('#phrase-bank').innerHTML=list.map(p=>`<article class="phrase-item"><p>${escapeHtml(p.testo||'')}</p><small>${escapeHtml(p.categoria||'')}</small><button data-use-phrase="${p.id}">Usa</button></article>`).join('');
  $$('[data-use-phrase]').forEach(b=>b.onclick=()=>{const p=phrases.find(x=>x.id===b.dataset.usePhrase);startCreation('story',p?.testo);});
}
let stickerBankCategory='Tutti';
let stickerBankLimit=24;
function renderStickerBank(){
  const cats=['Tutti',...new Set(stickers.map(s=>s.category).filter(Boolean))];
  $('#sticker-chips').innerHTML=cats.map(c=>`<button class="${c===stickerBankCategory?'selected':''}" data-sticker-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('');
  const all=stickers.filter(s=>stickerBankCategory==='Tutti'||s.category===stickerBankCategory);
  const list=all.slice(0,stickerBankLimit);
  $('#sticker-bank').innerHTML=list.map(s=>`<button class="sticker-item"><img src="${stickerThumb(s.file)}" alt="${escapeHtml(s.title||'')}" loading="lazy" decoding="async" fetchpriority="low"></button>`).join('') + (all.length>list.length?`<button class="sticker-more" id="sticker-more">Mostra altri <small>${all.length-list.length}</small></button>`:'');
  $('#sticker-chips').onclick=e=>{const b=e.target.closest('[data-sticker-cat]');if(!b)return;stickerBankCategory=b.dataset.stickerCat;stickerBankLimit=24;renderStickerBank();};
  const more=$('#sticker-more');if(more)more.onclick=()=>{stickerBankLimit+=24;renderStickerBank();};
}

function randomPhrase(group='generic'){
  let list=phrases.filter(p=>p.attiva_per_suggerimenti!==false);
  if(group==='morning') list=list.filter(p=>(p.categoria||'').startsWith('buongiorno_'));
  else if(group==='books') list=list.filter(p=>p.categoria==='libri');
  else if(group==='travel') list=list.filter(p=>p.categoria==='viaggi');
  else list=list.filter(p=>['vita_reale','libri','viaggi','maternita'].includes(p.categoria));
  return (list[Math.floor(Math.random()*Math.max(1,list.length))]||phrases[0]||{testo:'Una piccola storia da raccontare.'}).testo;
}
function startCreation(kind, forcedText=null){
  closeSheets(); state.projectId=null; state.activeSlide=0; state.selectedLayerId=null;
  if(kind==='reel'){
    state.kind='reel';state.format='story';state.title='Nuovo reel';state.slides=[newSlide({mediaType:null,layers:[defaultLayer('Racconta la tua storia',{y:.78,background:'dark',font:'script'}),signatureLayer()]})];
    markDirty();showEditor(); setTimeout(()=>$('#video-input').click(),180); return;
  }
  if(kind==='carousel'){
    state.kind='carousel';state.format='carousel';state.title='Nuovo carosello';
    const texts=['Titolo del carosello','Seconda idea','Terzo passaggio','Un dettaglio importante','E tu cosa ne pensi?'];
    state.slides=texts.map((text,i)=>newSlide({mediaType:null,look:'original',strength:0,bgColor:'#f3e7dc',layers:[defaultLayer(text,{y:i===0?.50:.54,background:'none',font:'editorial',fontSize:i===0?58:46,color:'#24150f'}),signatureLayer()]}));
    markDirty();showEditor();return;
  }
  state.kind='story';state.format='story';state.title=kind==='morning'?'Storia del buongiorno':'Nuova storia';
  const text=forcedText || randomPhrase(kind==='morning'?'morning':'generic');
  state.slides=[newSlide({mediaType:null,look:'original',strength:0,bgColor:kind==='morning'?'#f3e7dc':'#171310',layers:[defaultLayer(text,{y:.52,background:'none',font:kind==='morning'?'script':'editorial',fontSize:kind==='morning'?58:52,color:kind==='morning'?'#24150f':'#fffaf5'}),signatureLayer()]})];
  markDirty();showEditor();
}
function useTemplate(id){
  const t=templateDefs.find(x=>x.id===id); if(!t)return;
  if(t.cat==='carousel'){
    state.kind='carousel';state.format='carousel';state.title=t.title;state.projectId=null;state.activeSlide=0;
    const texts=[t.text,'Seconda slide','Terza slide','Quarta slide','Chiudi con una domanda.'];
    state.slides=texts.map((text,i)=>newSlide({mediaType:null,look:'original',strength:0,bgColor:t.bgColor,layers:[defaultLayer(text,{y:.52,background:t.bg,font:t.font,fontSize:i===0?58:44,color:['cream','paper'].includes(t.bg)?'#24150f':(t.bgColor==='#f5eee7'||t.bgColor==='#f3e7dc'?'#24150f':'#fffaf5')}),signatureLayer()]}));
    markDirty();showEditor();return;
  }
  state.kind='template';state.format='story';state.title=t.title;state.projectId=null;state.activeSlide=0;
  const dark=!['#f4eadf','#efe2d5','#f5eee7','#f3e7dc'].includes(t.bgColor);
  state.slides=[newSlide({mediaType:null,look:'original',strength:0,bgColor:t.bgColor,layers:[defaultLayer(t.text,{y:.52,background:t.bg,font:t.font,fontSize:58,color:['cream','paper'].includes(t.bg)?'#24150f':(dark?'#fffaf5':'#24150f')}),signatureLayer()]})];
  markDirty();showEditor();
}
function showEditor(){ showScreen('editor'); $('#editor-mode-label').textContent=state.kind==='carousel'?'Carosello · stile unico':state.kind==='reel'?'Reel':state.kind==='template'?'Template':'Storia'; $('#editor-build').textContent=BUILD; const lock=$('#style-lock');if(lock)lock.textContent=state.kind==='carousel'?'tutte le slide':'rapido'; renderAllEditorControls(); renderStage(); }

function revokeSlideUrl(slide){ if(slide.mediaUrl?.startsWith('blob:')){URL.revokeObjectURL(slide.mediaUrl);objectUrls=objectUrls.filter(x=>x!==slide.mediaUrl);} slide.mediaUrl=null; }
async function loadLocalMedia(file,type){
  const s=currentSlide();revokeSlideUrl(s);s.mediaType=type;s.assetSrc=null;s.previewThumb=null;
  s.mediaKey = s.mediaKey || uid('media');
  s.mediaBlob=file;s.mediaUrl=URL.createObjectURL(file);objectUrls.push(s.mediaUrl);
  renderStage();markDirty();
  if(type==='image'){
    toast('Foto pronta');
    const task=optimizeAndPersistImage(s,file).catch(err=>console.warn('Ottimizzazione foto saltata',err));
    mediaPersistPromises.set(s.mediaKey,task);task.finally(()=>mediaPersistPromises.delete(s.mediaKey));
  }else{
    // I video restano nel dispositivo/sessione: non vengono ricopiati nel DB ad ogni salvataggio.
    s.mediaKey=null;
    toast('Video pronto');
  }
}
async function optimizeAndPersistImage(slide,file){
  const result=await optimizeImage(file,2160);
  if(!result?.blob)return;
  if(slide.mediaUrl?.startsWith('blob:')){URL.revokeObjectURL(slide.mediaUrl);objectUrls=objectUrls.filter(x=>x!==slide.mediaUrl);}
  slide.mediaBlob=result.blob;slide.previewThumb=result.thumb;slide.mediaUrl=URL.createObjectURL(result.blob);objectUrls.push(slide.mediaUrl);
  const key=slide.mediaKey || (slide.mediaKey=uid('media'));
  await IADB.put('media',{id:key,blob:result.blob,type:'image',updatedAt:Date.now()});
  if(currentSlide()===slide)renderStage();
  markDirty(false);
}
async function optimizeImage(file,maxEdge=2160){
  let bitmap=null, img=null, tempUrl=null;
  try{
    if('createImageBitmap' in window){ try{ bitmap=await createImageBitmap(file,{imageOrientation:'from-image'}); }catch(_){} }
    if(!bitmap){
      tempUrl=URL.createObjectURL(file);img=await loadImageNoCache(tempUrl);
    }
    const src=bitmap||img;const sw=src.width||src.naturalWidth, sh=src.height||src.naturalHeight;if(!sw||!sh)return {blob:file,thumb:null};
    const scale=Math.min(1,maxEdge/Math.max(sw,sh));const w=Math.max(1,Math.round(sw*scale)),h=Math.max(1,Math.round(sh*scale));
    const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d',{alpha:false});ctx.drawImage(src,0,0,w,h);
    const blob=await canvasToBlob(c,'image/jpeg',.88) || file;
    const tw=Math.min(360,w), th=Math.max(1,Math.round(h*(tw/w)));const tc=document.createElement('canvas');tc.width=tw;tc.height=th;tc.getContext('2d',{alpha:false}).drawImage(c,0,0,tw,th);
    const thumb=tc.toDataURL('image/jpeg',.62);
    return {blob:new File([blob],`IA_${Date.now()}.jpg`,{type:'image/jpeg'}),thumb};
  } finally { if(bitmap?.close)bitmap.close(); if(tempUrl)URL.revokeObjectURL(tempUrl); }
}
function loadImageNoCache(src){return new Promise((res,rej)=>{const im=new Image();im.onload=()=>res(im);im.onerror=rej;im.src=src;});}
function resolveMediaUrl(s){ if(s.mediaUrl)return s.mediaUrl;if(s.mediaBlob){s.mediaUrl=URL.createObjectURL(s.mediaBlob);objectUrls.push(s.mediaUrl);return s.mediaUrl;}return s.assetSrc||null; }
function filterCss(slide){
  const t=(slide.strength??80)/100;
  const looks={
    original:[1,1,1,0,0], soft:[1+.06*t,1-.05*t,1-.03*t,.03*t,0], warm:[1+.05*t,1+.06*t,1-.02*t,.15*t,-5*t], cinema:[1-.01*t,1-.16*t,1+.09*t,.08*t,-2*t], bw:[1,1-.05*t,1+.1*t,0,0]
  };
  const [br,sat,con,sep,hue]=looks[slide.look]||looks.soft;
  return `${slide.look==='bw'?`grayscale(${t}) `:''}brightness(${br}) saturate(${sat}) contrast(${con}) sepia(${sep}) hue-rotate(${hue}deg)`;
}
function renderMediaLook(){ const s=currentSlide(); const img=$('#stage-image'),vid=$('#stage-video'); [img,vid].forEach(el=>{el.style.objectFit=s.fit||'cover';el.style.filter=filterCss(s);}); }
function renderStage(){
  const s=currentSlide();if(!s)return;
  const stage=$('#media-stage');stage.classList.toggle('format-carousel',state.format==='carousel');stage.classList.toggle('format-story',state.format!=='carousel');
  $('#stage-bg').style.background=s.bgColor||'#201713';
  const img=$('#stage-image'),vid=$('#stage-video'),empty=$('#stage-empty'),url=resolveMediaUrl(s);
  img.hidden=true;vid.hidden=true;empty.classList.toggle('hidden',!!url || s.layers.length>0);
  stage.classList.remove('media-loading');
  if(url && s.mediaType==='image'){
    stage.classList.add('media-loading');
    img.onload=()=>stage.classList.remove('media-loading');
    img.onerror=()=>{stage.classList.remove('media-loading');toast('Questa foto non può essere aperta. Prova JPEG, PNG o WebP.');};
    img.hidden=false;
    if(img.src!==url) img.src=url;
    if(img.complete && img.naturalWidth) stage.classList.remove('media-loading');
  }else if(url && s.mediaType==='video'){
    stage.classList.add('media-loading');
    vid.onloadeddata=()=>stage.classList.remove('media-loading');
    vid.onerror=()=>{stage.classList.remove('media-loading');toast('Questo video non può essere aperto. Prova MP4/H.264.');};
    vid.hidden=false;vid.preload='metadata';if(vid.src!==url)vid.src=url;
    if(vid.readyState>=2) stage.classList.remove('media-loading');
  }
  renderMediaLook();
  const root=$('#layer-root');root.innerHTML='';
  s.layers.forEach(layer=>root.appendChild(layerElement(layer)));
  syncTextControls();renderCarouselStrip();
  $('#layer-toolbar').classList.toggle('hidden',!state.selectedLayerId);
}
function layerElement(layer){
  const el=document.createElement('div');el.className=`content-layer ${layer.type}-layer ${layer.id===state.selectedLayerId?'selected':''}`;el.dataset.layerId=layer.id;
  el.style.left=(layer.x*100)+'%';el.style.top=(layer.y*100)+'%';el.style.width=(layer.width||50)+'%';
  if(layer.type==='text'){
    el.classList.add(`font-${layer.font}`,`bg-${layer.background}`);el.style.fontSize=`${layer.fontSize}px`;el.style.color=layer.color;el.style.textAlign=layer.align;el.style.setProperty('--bg-alpha',(layer.bgOpacity??70)/100);el.textContent=layer.text;
  }else if(layer.type==='sticker'){
    const im=new Image();im.src=stickerThumb(layer.src);im.alt='';im.decoding='async';el.appendChild(im);
  }else if(layer.type==='signature'){
    const im=new Image();im.src='./signature.svg';im.alt='Ironicamente Acida';el.appendChild(im);
  }
  el.addEventListener('pointerdown',startLayerDrag);el.onclick=e=>{e.stopPropagation();state.selectedLayerId=layer.id;renderStage();if(layer.type==='text')selectTool('text');};
  return el;
}
function startLayerDrag(e){
  e.preventDefault();const id=e.currentTarget.dataset.layerId;state.selectedLayerId=id;const stage=$('#media-stage'),r=stage.getBoundingClientRect();const s=currentSlide(),layer=s.layers.find(x=>x.id===id);if(!layer)return;
  e.currentTarget.setPointerCapture?.(e.pointerId);
  const move=ev=>{layer.x=clamp((ev.clientX-r.left)/r.width,.04,.96);layer.y=clamp((ev.clientY-r.top)/r.height,.04,.96);e.currentTarget.style.left=(layer.x*100)+'%';e.currentTarget.style.top=(layer.y*100)+'%';};
  const up=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);markDirty();renderStage();};
  window.addEventListener('pointermove',move);window.addEventListener('pointerup',up,{once:true});
}
function renderCarouselStrip(){
  const strip=$('#carousel-strip');if(state.kind!=='carousel'){strip.classList.add('hidden');strip.innerHTML='';strip.dataset.mediaSig='';return;}strip.classList.remove('hidden');
  const mediaSig=state.slides.map(s=>`${s.id}:${s.mediaKey||s.assetSrc||s.mediaUrl||''}`).join('|');
  if(strip.dataset.mediaSig!==mediaSig){
    strip.innerHTML=state.slides.map((s,i)=>{const raw=resolveMediaUrl(s);if(!raw)return `<button class="carousel-thumb carousel-thumb-empty" data-slide-index="${i}"><span>${i+1}</span></button>`;const src=s.assetSrc?photoThumb(raw):raw;return `<button class="carousel-thumb" data-slide-index="${i}"><img src="${src}" alt="" loading="lazy" decoding="async"></button>`;}).join('');
    strip.dataset.mediaSig=mediaSig;
    $$('#carousel-strip [data-slide-index]').forEach(b=>b.onclick=()=>{state.activeSlide=+b.dataset.slideIndex;state.selectedLayerId=null;renderStage();});
  }
  $$('#carousel-strip [data-slide-index]').forEach((b,i)=>b.classList.toggle('selected',i===state.activeSlide));
}


function deleteSelectedLayer(){
  if(!state.selectedLayerId)return;const s=currentSlide();s.layers=s.layers.filter(x=>x.id!==state.selectedLayerId);state.selectedLayerId=null;markDirty();renderStage();
}
function duplicateSelectedLayer(){
  if(!state.selectedLayerId)return;const s=currentSlide(),l=s.layers.find(x=>x.id===state.selectedLayerId);if(!l)return;const copy={...l,id:uid(l.type==='text'?'txt':l.type==='sticker'?'stk':'sig'),x:clamp(l.x+.06,.08,.92),y:clamp(l.y+.05,.08,.92)};s.layers.push(copy);state.selectedLayerId=copy.id;markDirty();renderStage();
}

function selectTool(tool){
  if(tool==='text'){const t=currentSlide()?.layers.find(x=>x.type==='text');if(t)state.selectedLayerId=t.id;}
  $$('#editor-rail button').forEach(b=>b.classList.toggle('selected',b.dataset.tool===tool));
  $$('.tool-panel').forEach(p=>p.classList.toggle('active',p.dataset.panel===tool));
  if(tool==='phrases')renderPhrasePicker();if(tool==='stickers')renderStickerPicker();if(tool==='look')renderLookRow();
}
function renderAllEditorControls(){ renderFonts();renderBackgrounds();renderColors();renderLookRow();renderPhrasePicker(); }
function selectedText(){ return currentSlide()?.layers.find(x=>x.id===state.selectedLayerId&&x.type==='text') || currentSlide()?.layers.find(x=>x.type==='text'); }
function syncTextControls(){
  const l=selectedText();if(!l)return;state.selectedLayerId=state.selectedLayerId||l.id;if($('#text-input').value!==l.text)$('#text-input').value=l.text;$('#text-size').value=l.fontSize;$('#text-size-out').value=l.fontSize;$('#text-width').value=l.width;$('#text-width-out').value=l.width+'%';$('#text-bg-opacity').value=l.bgOpacity??70;$('#text-bg-opacity-out').value=(l.bgOpacity??70)+'%';
  $$('.font-option').forEach(b=>b.classList.toggle('selected',b.dataset.font===l.font));$$('.background-option').forEach(b=>b.classList.toggle('selected',b.dataset.background===l.background));$$('.color-chip').forEach(b=>b.classList.toggle('selected',b.dataset.color===l.color));$$('.align-row button').forEach(b=>b.classList.toggle('selected',b.dataset.align===l.align));
}
function updateSelectedText(patch){
  const l=selectedText();if(!l)return;
  if(patch.background){ const light=['cream','paper'].includes(patch.background); const wasLight=['cream','paper'].includes(l.background); if(light&&!wasLight&&['#fffaf5','#f6f2ea','#ffffff'].includes((l.color||'').toLowerCase())) patch.color='#24150f'; if(!light&&wasLight&&['#24150f','#2a211d','#0d0d0d'].includes((l.color||'').toLowerCase())) patch.color='#fffaf5'; }
  Object.assign(l,patch);
  if(state.kind==='carousel'){
    const sharedKeys=['font','background','color','align','bgOpacity'];const shared=Object.fromEntries(Object.entries(patch).filter(([k])=>sharedKeys.includes(k)));
    if(Object.keys(shared).length)state.slides.forEach(sl=>{const t=sl.layers.find(x=>x.type==='text');if(t&&t!==l)Object.assign(t,shared);});
  }
  markDirty();renderStage();
}
function addTextLayer(text='Nuova frase'){ const l=defaultLayer(text,{y:.55,background:'glass',font:'editorial',fontSize:44});currentSlide().layers.push(l);state.selectedLayerId=l.id;markDirty();renderStage();selectTool('text'); }
function renderFonts(){
  const fonts=[['editorial','Aa','Editoriale'],['script','Aa','Corsivo'],['modern','Aa','Moderna']];
  $('#font-row').innerHTML=fonts.map(([id,s,n])=>`<button class="font-option font-${id}" data-font="${id}"><b>${s}</b><small>${n}</small></button>`).join('');
  $$('.font-option').forEach(b=>b.onclick=()=>updateSelectedText({font:b.dataset.font}));
}
function renderBackgrounds(){
  const bgs=[['cream','Avorio'],['dark','Scuro'],['glass','Vetro']];
  $('#background-row').innerHTML=bgs.map(([id,n])=>`<button class="background-option bg-preview-${id}" data-background="${id}" title="${n}"></button>`).join('');
  $$('.background-option').forEach(b=>b.onclick=()=>updateSelectedText({background:b.dataset.background}));
}
function renderColors(){
  const colors=['#fffaf5','#e45718','#24150f','#0d0d0d'];
  $('#color-row').innerHTML=colors.map(c=>`<button class="color-chip" data-color="${c}" style="background:${c}"></button>`).join('');
  $$('.color-chip').forEach(b=>b.onclick=()=>updateSelectedText({color:b.dataset.color}));
  $$('.align-row button').forEach(b=>b.onclick=()=>updateSelectedText({align:b.dataset.align}));
}
function renderLookRow(){
  const looks=[['original','Naturale'],['soft','Soft'],['warm','Caldo']];const s=currentSlide();
  $('#look-row').innerHTML=looks.map(([id,n])=>`<button class="look-option ${s.look===id?'selected':''}" data-look="${id}"><div class="look-thumb" style="filter:${filterCss({...s,look:id})}"></div><b>${n}</b></button>`).join('');
  $$('.look-option').forEach(b=>b.onclick=()=>{const look=b.dataset.look;if(state.kind==='carousel')state.slides.forEach(sl=>sl.look=look);else s.look=look;markDirty();renderMediaLook();renderLookRow();});
}
function renderPhrasePicker(){
  const list=[...phrases].sort(()=>Math.random()-.5).slice(0,6);$('#phrase-picker').innerHTML=list.map(p=>`<button class="phrase-pick" data-phrase-pick="${p.id}"><p>${escapeHtml(p.testo)}</p><small>${escapeHtml((p.categoria||'').replaceAll('_',' '))}</small></button>`).join('');
  $$('[data-phrase-pick]').forEach(b=>b.onclick=()=>{const p=phrases.find(x=>x.id===b.dataset.phrasePick);const l=selectedText();if(l){l.text=p.testo;markDirty();renderStage();}else addTextLayer(p.testo);});
}
function renderStickerPicker(){
  const root=$('#sticker-picker');if(root.dataset.ready==='1')return;
  let list=stickers.filter(s=>QUICK_STICKER_IDS.has(s.id));if(list.length<12)list=stickers.slice(0,24);
  root.innerHTML=list.map(s=>`<button class="sticker-item" data-sticker-pick="${s.id}"><img src="${stickerThumb(s.file)}" alt="" loading="lazy" decoding="async" fetchpriority="low"></button>`).join('');
  root.dataset.ready='1';
  $$('[data-sticker-pick]',root).forEach(b=>b.onclick=()=>{const st=stickers.find(x=>x.id===b.dataset.stickerPick);if(!st)return;const l={id:uid('stk'),type:'sticker',src:'./'+st.file,x:.5,y:.55,width:30};currentSlide().layers.push(l);state.selectedLayerId=l.id;markDirty();renderStage();});
}
async function addCustomPhrase(){
  const t=prompt('Scrivi la nuova frase');if(!t?.trim())return;const p={id:uid('USR'),categoria:'personali',testo:t.trim(),attiva_per_suggerimenti:true,gia_usata:false};await IADB.put('phrases',p);phrases.push(p);renderPhraseBank();renderCounts();toast('Frase aggiunta');
}

async function saveProject(){
  try{
    const existing=projects.find(p=>p.id===state.projectId);
    const rec={
      id:state.projectId||uid('project'),title:state.title,kind:state.kind,
      createdAt:existing?.createdAt||Date.now(),updatedAt:Date.now(),state:serializeState(),
      thumb:projectPreview(currentSlide()) || existing?.thumb || null
    };
    state.projectId=rec.id;
    const idx=projects.findIndex(p=>p.id===rec.id);if(idx>=0)projects[idx]=rec;else projects.push(rec);
    $('#editor-save').textContent='Salvato';$('#editor-save').classList.add('saved');
    toast('Salvato');
    // Il record è piccolo: il salvataggio parte subito ma non blocca l'interfaccia.
    IADB.put('projects',rec).catch(e=>{console.error(e);toast('Salvataggio locale non riuscito');});
    setTimeout(()=>{$('#editor-save').textContent='Salva';$('#editor-save').classList.remove('saved');},900);
  }catch(e){console.error(e);toast('Non sono riuscita a salvare il progetto');}
}
function projectPreview(slide){
  if(slide?.previewThumb)return slide.previewThumb;
  if(slide?.assetSrc)return photoThumb(slide.assetSrc);
  return null;
}
function serializeState(){
  return {kind:state.kind,format:state.format,activeSlide:state.activeSlide,title:state.title,slides:state.slides.map(s=>{
    const {mediaBlob,mediaUrl,...rest}=s;return {...rest,mediaUrl:null};
  })};
}
async function openProject(id){
  const p=projects.find(x=>x.id===id);if(!p)return;
  state.projectId=p.id;state.kind=p.state.kind;state.format=p.state.format;state.activeSlide=p.state.activeSlide||0;state.title=p.state.title||p.title;state.slides=p.state.slides;
  state.slides.forEach(s=>s.layers?.forEach(l=>{if(l.type==='text'&&['cream','paper'].includes(l.background)&&['#fffaf5','#f6f2ea','#ffffff'].includes((l.color||'').toLowerCase()))l.color='#24150f';}));
  state.selectedLayerId=null;showEditor();
  // Recupera in parallelo solo le immagini locali referenziate, senza appesantire il record progetto.
  Promise.all(state.slides.map(async slide=>{
    if(slide.mediaKey && !slide.mediaBlob){const rec=await IADB.get('media',slide.mediaKey);if(rec?.blob){slide.mediaBlob=rec.blob;slide.mediaUrl=URL.createObjectURL(rec.blob);objectUrls.push(slide.mediaUrl);}}
  })).then(()=>renderStage()).catch(()=>{});
}


async function exportCurrent(){
  try{
    if(state.kind==='reel' && currentSlide().mediaType==='video') return await exportReel();
    const files = exportCache.revision===revision && exportCache.files ? exportCache.files : await prepareExportFiles(true);
    if(!files?.length) throw new Error('Nessun file esportato');
    if(navigator.canShare?.({files}) && navigator.share){await navigator.share({files,title:state.kind==='carousel'?'Ironicamente Acida · Carosello':'Ironicamente Acida'});}
    else{for(const f of files)downloadBlob(f,f.name);}
    markUsedPhrase();toast(state.kind==='carousel'?'Carosello pronto':'Contenuto pronto');
  }catch(e){if(e?.name!=='AbortError'){console.error(e);toast('Esportazione non riuscita');}}
}
async function prepareExportFiles(showStatus=false){
  const rev=revision;if(showStatus)setExportBusy(true,state.kind==='carousel'?'Preparo 5 slide…':'Preparo…');
  try{
    const files=[];
    if(state.kind==='carousel'){
      for(let i=0;i<state.slides.length;i++){
        const c=await renderComposite(1080,1350,state.slides[i]);const b=await canvasToBlob(c,'image/jpeg',.88);files.push(new File([b],`IA_carosello_${dateStamp()}_${i+1}.jpg`,{type:'image/jpeg'}));
        await yieldFrame();
      }
    }else{
      const c=await renderComposite(1080,1920,currentSlide());const b=await canvasToBlob(c,'image/jpeg',.88);files.push(new File([b],`IA_story_${dateStamp()}.jpg`,{type:'image/jpeg'}));
    }
    if(rev===revision)exportCache={revision:rev,files};return files;
  }finally{if(showStatus)setExportBusy(false);}
}
function setExportBusy(on,label='Condividi'){
  const b=$('#editor-export');if(!b)return;b.disabled=on;b.textContent=on?label:'Condividi';b.classList.toggle('busy',on);
}
function canvasToBlob(canvas,type='image/jpeg',quality=.88){return new Promise(r=>canvas.toBlob(r,type,quality));}
function yieldFrame(){return new Promise(r=>requestAnimationFrame(()=>r()));}
function markDirty(warm=true){
  revision++;exportCache={revision:-1,files:null};
  $('#editor-save')?.classList.remove('saved');
  if(exportWarmupTimer){clearTimeout(exportWarmupTimer);exportWarmupTimer=null;}
  if(!warm || state.kind==='reel')return;
  exportWarmupTimer=setTimeout(()=>{
    const run=()=>prepareExportFiles(false).catch(()=>{});
    if('requestIdleCallback' in window)requestIdleCallback(run,{timeout:2500});else run();
  },1600);
}
async function exportReel(){
  const slide=currentSlide();
  if(!slide.mediaBlob){toast('Salva il progetto: l’esportazione reel richiede un video caricato dal telefono.');return;}
  // Stable path first: share the native file. The visual project remains editable and saved.
  const file=slide.mediaBlob instanceof File?slide.mediaBlob:new File([slide.mediaBlob],`IA_reel_${dateStamp()}.mp4`,{type:slide.mediaBlob.type||'video/mp4'});
  if(navigator.canShare?.({files:[file]}) && navigator.share){await navigator.share({files:[file],title:'Ironicamente Acida · Reel'});toast('Video condiviso');}
  else downloadBlob(file,file.name);
}
async function shareBlob(blob,name,title){const f=new File([blob],name,{type:blob.type||'image/jpeg'});if(navigator.canShare?.({files:[f]})&&navigator.share)await navigator.share({files:[f],title});else downloadBlob(blob,name);}
function downloadBlob(blob,name){const u=URL.createObjectURL(blob);const a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),2000);}
function dateStamp(){return new Date().toISOString().slice(0,10);}
function markUsedPhrase(){const l=currentSlide().layers.find(x=>x.type==='text');if(!l)return;const p=phrases.find(x=>x.testo===l.text);if(p){p.gia_usata=true;p.useCount=(p.useCount||0)+1;IADB.put('phrases',p).catch(()=>{});}}

async function renderComposite(w,h,slide){
  const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d',{alpha:false});ctx.fillStyle=slide.bgColor||'#201713';ctx.fillRect(0,0,w,h);
  const src=resolveMediaUrl(slide);
  if(src && slide.mediaType==='image'){
    const im=await loadImage(src);ctx.save();ctx.filter=filterCss(slide);drawImageFit(ctx,im,w,h,slide.fit||'cover');ctx.restore();
  }else if(src && slide.mediaType==='video'){
    const v=$('#stage-video');if(v.readyState>=2){ctx.save();ctx.filter=filterCss(slide);drawImageFit(ctx,v,w,h,slide.fit||'cover');ctx.restore();}
  }
  for(const layer of slide.layers){await drawLayer(ctx,layer,w,h);}
  return c;
}
function drawImageFit(ctx,im,w,h,fit){
  const iw=im.videoWidth||im.naturalWidth||im.width,ih=im.videoHeight||im.naturalHeight||im.height;if(!iw||!ih)return;
  const scale=fit==='contain'?Math.min(w/iw,h/ih):Math.max(w/iw,h/ih);const dw=iw*scale,dh=ih*scale,dx=(w-dw)/2,dy=(h-dh)/2;ctx.drawImage(im,dx,dy,dw,dh);
}
async function drawLayer(ctx,l,w,h){
  const x=l.x*w,y=l.y*h,boxW=(l.width/100)*w;
  if(l.type==='sticker'){const im=await loadImage(l.src);const ratio=im.naturalHeight/im.naturalWidth;ctx.drawImage(im,x-boxW/2,y-boxW*ratio/2,boxW,boxW*ratio);return;}
  if(l.type==='signature'){const im=await loadImage('./signature.svg');const ratio=im.naturalHeight/im.naturalWidth;ctx.drawImage(im,x-boxW/2,y-boxW*ratio/2,boxW,boxW*ratio);return;}
  if(l.type!=='text')return;
  const scale=w/360,font=Math.max(18,l.fontSize*scale);ctx.font=fontString(l,font);ctx.textAlign=l.align==='left'?'left':l.align==='right'?'right':'center';ctx.textBaseline='middle';
  const lines=wrapText(ctx,l.text,boxW-32*scale);const lineH=font*1.08;const textH=lines.length*lineH;const pad=18*scale;const rectH=textH+pad*1.45;const left=x-boxW/2,top=y-rectH/2;
  drawTextBackground(ctx,l,left,top,boxW,rectH,18*scale);
  ctx.fillStyle=l.color||'#fff';const tx=l.align==='left'?left+pad:l.align==='right'?left+boxW-pad:x;lines.forEach((line,i)=>ctx.fillText(line,tx,y-(lines.length-1)*lineH/2+i*lineH));
}
function fontString(l,size){const map={editorial:`${size}px Didot, Georgia, serif`,script:`${size}px 'Snell Roundhand','Bradley Hand',cursive`,serif:`${size}px Georgia,serif`,rounded:`600 ${size}px 'Avenir Next Rounded','Avenir Next',sans-serif`,modern:`600 ${size}px 'Avenir Next',sans-serif`};return map[l.font]||map.editorial;}
function wrapText(ctx,text,maxW){const paras=String(text||'').split('\n'),out=[];for(const p of paras){const words=p.split(/\s+/);let line='';for(const word of words){const test=line?line+' '+word:word;if(ctx.measureText(test).width>maxW&&line){out.push(line);line=word;}else line=test;}if(line)out.push(line);}return out.length?out:[''];}
function drawTextBackground(ctx,l,x,y,w,h,r){const a=(l.bgOpacity??70)/100;if(l.background==='none')return;ctx.save();if(l.background==='cream'||l.background==='paper'){ctx.fillStyle=`rgba(246,242,234,${a})`;}else if(l.background==='dark'){ctx.fillStyle=`rgba(13,13,13,${a})`;}else if(l.background==='glass'){ctx.fillStyle=`rgba(248,232,220,${a*.36})`;ctx.strokeStyle='rgba(255,255,255,.28)';ctx.lineWidth=2;}else if(l.background==='outline'){ctx.fillStyle='rgba(0,0,0,.08)';ctx.strokeStyle=`rgba(255,255,255,${Math.max(.45,a)})`;ctx.lineWidth=2;}roundRect(ctx,x,y,w,h,l.background==='paper'?r*.45:r);ctx.fill();if(['glass','outline'].includes(l.background))ctx.stroke();ctx.restore();}
function roundRect(ctx,x,y,w,h,r){r=Math.min(r,w/2,h/2);ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
function loadImage(src){
  if(imagePromiseCache.has(src))return imagePromiseCache.get(src);
  const p=new Promise((res,rej)=>{const im=new Image();im.decoding='async';im.onload=()=>res(im);im.onerror=()=>{imagePromiseCache.delete(src);rej(new Error('Immagine non caricabile'));};im.src=src;});
  imagePromiseCache.set(src,p);return p;
}
function escapeHtml(s=''){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}

boot();
