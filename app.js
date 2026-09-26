const BUILD = 'V3 · build 01';
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const uid = (p='id') => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`;
const clamp = (n,a,b) => Math.max(a,Math.min(b,n));
const sleep = ms => new Promise(r=>setTimeout(r,ms));

let photos = [];
let phrases = [];
let stickers = [];
let projects = [];
let heroIndex = 0;
let toastTimer;
let currentScreen = 'home';
let objectUrls = [];

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
  {id:'morning_garden',cat:'morning',photo:2,title:'Buongiorno',subtitle:'piccole cose, grandi giornate',text:'Buongiorno. Piccole cose che rendono la giornata più leggera.',bg:'cream',font:'script',look:'warm',tall:true},
  {id:'morning_flowers',cat:'morning',photo:7,title:'Un giorno alla volta',subtitle:'storia del buongiorno',text:'Un giorno alla volta. E possibilmente con un caffè.',bg:'dark',font:'editorial',look:'soft'},
  {id:'story_library',cat:'story',photo:0,title:'Libri, luoghi, persone',subtitle:'storia',text:'Ci sono luoghi in cui le idee sembrano avere più spazio.',bg:'glass',font:'serif',look:'cinema',tall:true},
  {id:'story_arch',cat:'story',photo:3,title:'La bellezza nelle cose semplici',subtitle:'storia',text:'La bellezza, a volte, è solo una porta aperta al momento giusto.',bg:'paper',font:'editorial',look:'warm'},
  {id:'quote_cream',cat:'quote',photo:null,title:'Pensieri (ironici)',subtitle:'frase',text:'La mia pace interiore esiste. Ha degli orari molto limitati.',bg:'cream',font:'serif',look:'original',tall:true},
  {id:'quote_coffee',cat:'quote',photo:8,title:'Caffè + parole',subtitle:'frase',text:'Cinque minuti di silenzio, un caffè e l’illusione di avere il controllo.',bg:'paper',font:'rounded',look:'warm'},
  {id:'carousel_trip',cat:'carousel',photo:4,title:'Luoghi che restano',subtitle:'carosello 5 slide',text:'Luoghi che restano nel cuore.',bg:'dark',font:'editorial',look:'cinema',tall:true},
  {id:'carousel_books',cat:'carousel',photo:0,title:'Tra pagine e persone',subtitle:'carosello 5 slide',text:'Tra pagine, luoghi e persone.',bg:'glass',font:'serif',look:'soft'},
  {id:'reel_flowers',cat:'reel',photo:7,title:'Piccole fughe',subtitle:'reel',text:'Piccole fughe, grandi respiri.',bg:'none',font:'script',look:'warm',tall:true},
  {id:'reel_food',cat:'reel',photo:9,title:'Dolci giornate',subtitle:'reel',text:'Cose belle che meritano un secondo sguardo.',bg:'dark',font:'editorial',look:'warm'}
];

function defaultLayer(text='Scrivi qui', opts={}){
  return {
    id: uid('txt'), type:'text', text,
    x: opts.x ?? .5, y: opts.y ?? .72,
    width: opts.width ?? 74, fontSize: opts.fontSize ?? 52,
    font: opts.font || 'editorial', color: opts.color || '#fffaf5',
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

async function boot(){
  try{
    // During development we deliberately remove old PWA caches. This prevents stale builds on iPhone.
    if('serviceWorker' in navigator){
      const regs = await navigator.serviceWorker.getRegistrations().catch(()=>[]);
      regs.forEach(r=>r.unregister().catch(()=>{}));
    }
    if('caches' in window){ (await caches.keys().catch(()=>[])).forEach(k=>caches.delete(k)); }
    const [pRes,sRes,phRes] = await Promise.all([fetch('./photos.json?v=300'),fetch('./stickers.json?v=300'),fetch('./phrases.json?v=300')]);
    photos = await pRes.json();
    const sData = await sRes.json(); stickers = sData.stickers || [];
    const phData = await phRes.json();
    const builtPhrases = phData.entries || [];
    await IADB.open();
    let dbPhrases = await IADB.getAll('phrases');
    if(!dbPhrases.length){ await IADB.bulkPut('phrases', builtPhrases); dbPhrases = builtPhrases; }
    phrases = dbPhrases;
    let dbStickers = await IADB.getAll('stickers');
    if(!dbStickers.length){ await IADB.bulkPut('stickers', stickers); dbStickers = stickers; }
    stickers = dbStickers;
    projects = await IADB.getAll('projects');
  }catch(err){ console.error(err); }

  $('#boot-strip').style.backgroundImage = `url('${photos[7]?.src || './ia_photo_08.webp'}')`;
  renderHomePhotoRibbon(); renderTemplateGrid(); renderCounts(); renderProjects(); renderPhraseBank(); renderStickerBank(); renderLibrary();
  bindEvents();
  await sleep(850);
  $('#boot').classList.add('hidden'); $('#app').classList.remove('hidden');
  startHeroMotion();
}

function bindEvents(){
  document.addEventListener('click', e=>{
    const nav=e.target.closest('[data-nav]'); if(nav){ showScreen(nav.dataset.nav); return; }
    const cr=e.target.closest('[data-create]'); if(cr){ closeSheets(); startCreation(cr.dataset.create); return; }
    if(e.target.closest('[data-sheet-close]')) closeSheets();
    if(e.target.closest('[data-library-close]')) $('#library-sheet').classList.add('hidden');
  });
  $('#hero-create').onclick=()=>openCreateSheet();
  $('#editor-close').onclick=()=>showScreen('home');
  $('#editor-save').onclick=saveProject;
  $('#editor-project').onclick=saveProject;
  $('#editor-export').onclick=exportCurrent;
  $('#pick-photo').onclick=()=>$('#photo-input').click();
  $('#pick-video').onclick=()=>$('#video-input').click();
  $('#use-library-photo').onclick=()=>$('#library-sheet').classList.remove('hidden');
  $('#photo-input').onchange=e=>{ const f=e.target.files?.[0]; if(f) loadLocalMedia(f,'image'); e.target.value=''; };
  $('#video-input').onchange=e=>{ const f=e.target.files?.[0]; if(f) loadLocalMedia(f,'video'); e.target.value=''; };
  $('#stage-empty').onclick=()=>$('#photo-input').click();
  $('#add-text').onclick=()=>addTextLayer();
  $('#text-input').oninput=e=>updateSelectedText({text:e.target.value});
  $('#text-size').oninput=e=>{updateSelectedText({fontSize:+e.target.value});$('#text-size-out').value=e.target.value;};
  $('#text-width').oninput=e=>{updateSelectedText({width:+e.target.value});$('#text-width-out').value=e.target.value+'%';};
  $('#text-bg-opacity').oninput=e=>{updateSelectedText({bgOpacity:+e.target.value});$('#text-bg-opacity-out').value=e.target.value+'%';};
  $('#filter-strength').oninput=e=>{currentSlide().strength=+e.target.value;$('#filter-strength-out').value=e.target.value+'%';renderMediaLook();};
  $('#add-signature').onclick=()=>{ const s=currentSlide(); if(!s.layers.some(x=>x.type==='signature')){ const l=signatureLayer(); s.layers.push(l); state.selectedLayerId=l.id; renderStage(); }};
  $('#remove-signature').onclick=()=>{ const s=currentSlide(); s.layers=s.layers.filter(x=>x.type!=='signature'); renderStage(); };
  $('#new-phrase').onclick=addCustomPhrase;
  $('#delete-layer').onclick=deleteSelectedLayer;
  $('#duplicate-layer').onclick=duplicateSelectedLayer;
  $('#phrase-search').oninput=renderPhraseBank;

  $$('#editor-rail [data-tool]').forEach(b=>b.onclick=()=>selectTool(b.dataset.tool));
  $$('.editor-subtabs [data-subtab]').forEach(b=>b.onclick=()=>{
    $$('.editor-subtabs button').forEach(x=>x.classList.toggle('selected',x===b));
    $$('.subpanel').forEach(x=>x.classList.toggle('active',x.dataset.subpanel===b.dataset.subtab));
  });
  $$('.fit-row [data-fit]').forEach(b=>b.onclick=()=>{currentSlide().fit=b.dataset.fit;$$('.fit-row button').forEach(x=>x.classList.toggle('selected',x===b));renderMediaLook();});
  $('#template-chips').onclick=e=>{const b=e.target.closest('button[data-category]');if(!b)return;$$('#template-chips button').forEach(x=>x.classList.toggle('selected',x===b));renderTemplateGrid(b.dataset.category);};
}

function startHeroMotion(){
  const slides=$$('.hero-slide'), dots=$$('#hero-progress i');
  setInterval(()=>{slides[heroIndex].classList.remove('active');dots[heroIndex].classList.remove('active');heroIndex=(heroIndex+1)%slides.length;slides[heroIndex].classList.add('active');dots[heroIndex].classList.add('active');},4500);
}
function openCreateSheet(){ $('#create-sheet').classList.remove('hidden'); }
function closeSheets(){ $$('.sheet').forEach(s=>s.classList.add('hidden')); }
function showScreen(name){
  currentScreen=name;
  $$('.screen').forEach(s=>s.classList.toggle('active',s.dataset.screen===name));
  $('#bottom-dock').classList.toggle('hidden',name==='editor');
  const dockName=['phrases','stickers'].includes(name)?'profile':name;
  $$('#bottom-dock [data-nav]').forEach(b=>b.classList.toggle('selected',b.dataset.nav===dockName || (dockName==='home'&&b.dataset.nav==='home')));
  if(name==='projects') renderProjects();
  if(name==='phrases') renderPhraseBank();
  if(name==='stickers') renderStickerBank();
  window.scrollTo({top:0,behavior:'smooth'});
}
function toast(msg){ const t=$('#toast');t.textContent=msg;t.classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.add('hidden'),2300); }

function renderHomePhotoRibbon(){
  $('#home-photo-ribbon').innerHTML=photos.map((p,i)=>`<button data-photo-index="${i}"><img src="${p.src}" alt=""></button>`).join('');
  $$('#home-photo-ribbon [data-photo-index]').forEach(b=>b.onclick=()=>startFromLibraryPhoto(+b.dataset.photoIndex));
}
function renderLibrary(){
  $('#library-grid').innerHTML=photos.map((p,i)=>`<button data-lib-photo="${i}"><img src="${p.src}" alt=""></button>`).join('');
  $$('#library-grid [data-lib-photo]').forEach(b=>b.onclick=()=>{ const s=currentSlide(); s.assetSrc=photos[+b.dataset.libPhoto].src;s.mediaType='image';s.mediaBlob=null;revokeSlideUrl(s);$('#library-sheet').classList.add('hidden');renderStage(); });
}
function renderCounts(){ $('#phrase-count').textContent=`${phrases.length} frasi`;$('#sticker-count').textContent=`${stickers.length} elementi`; }
function renderTemplateGrid(category='all'){
  const list=templateDefs.filter(t=>category==='all'||t.cat===category);
  $('#template-grid').innerHTML=list.map(t=>`<button class="template-card ${t.tall?'tall':''}" data-template-id="${t.id}">${t.photo!==null?`<img src="${photos[t.photo]?.src}" alt="">`:''}<span class="template-arrow">↗</span><div class="template-text"><b>${t.title}</b><small>${t.subtitle}</small></div></button>`).join('');
  $$('#template-grid [data-template-id]').forEach(b=>b.onclick=()=>useTemplate(b.dataset.templateId));
}
function renderProjects(){
  const list=[...projects].sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
  const html=list.length?list.map(p=>`<button class="project-card" data-project-id="${p.id}">${p.thumb?`<img src="${p.thumb}" alt="">`:''}<div><b>${escapeHtml(p.title||'Progetto')}</b><small>${p.kind||'contenuto'} · ${new Date(p.updatedAt||p.createdAt).toLocaleDateString('it-IT')}</small></div></button>`).join(''):'<div class="empty-state">Nessun progetto salvato.</div>';
  $('#project-grid').innerHTML=html;
  $('#home-recent').innerHTML=list.length?list.slice(0,4).map(p=>`<button class="project-card" data-project-id="${p.id}">${p.thumb?`<img src="${p.thumb}" alt="">`:''}<div><b>${escapeHtml(p.title||'Progetto')}</b><small>${p.kind||''}</small></div></button>`).join(''):'<div class="empty-mini">I progetti salvati appariranno qui.</div>';
  $$('[data-project-id]').forEach(b=>b.onclick=()=>openProject(b.dataset.projectId));
}
function renderPhraseBank(){
  const q=($('#phrase-search')?.value||'').toLowerCase().trim();
  const list=phrases.filter(p=>!q||(p.testo||'').toLowerCase().includes(q)).slice(0,100);
  $('#phrase-bank').innerHTML=list.map(p=>`<article class="phrase-item"><p>${escapeHtml(p.testo||'')}</p><small>${escapeHtml(p.categoria||'')}</small><button data-use-phrase="${p.id}">Usa</button></article>`).join('');
  $$('[data-use-phrase]').forEach(b=>b.onclick=()=>{const p=phrases.find(x=>x.id===b.dataset.usePhrase);startCreation('story',p?.testo);});
}
function renderStickerBank(){
  const cats=['Tutti',...new Set(stickers.map(s=>s.category).filter(Boolean))];
  $('#sticker-chips').innerHTML=cats.map((c,i)=>`<button class="${i===0?'selected':''}" data-sticker-cat="${c}">${c}</button>`).join('');
  const render=(cat='Tutti')=>{ const list=stickers.filter(s=>cat==='Tutti'||s.category===cat);$('#sticker-bank').innerHTML=list.map(s=>`<button class="sticker-item"><img src="./${s.file}" alt="${escapeHtml(s.title||'')}"></button>`).join(''); };
  render();
  $('#sticker-chips').onclick=e=>{const b=e.target.closest('[data-sticker-cat]');if(!b)return;$$('#sticker-chips button').forEach(x=>x.classList.toggle('selected',x===b));render(b.dataset.stickerCat);};
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
    showEditor(); setTimeout(()=>$('#video-input').click(),180); return;
  }
  if(kind==='carousel'){
    state.kind='carousel';state.format='carousel';state.title='Nuovo carosello';
    const texts=['Una storia da raccontare.','Un dettaglio che resta.','Una pausa tra le cose.','Le immagini parlano.','E poi si ricomincia.'];
    state.slides=[0,4,7,8,3].map((pi,i)=>newSlide({mediaType:'image',assetSrc:photos[pi]?.src,look:i%2?'soft':'warm',layers:[defaultLayer(i===0?'Storie di un’estate qualunque':texts[i],{y:i===0?.74:.8,background:i===0?'dark':'cream',font:i===0?'editorial':'serif',fontSize:i===0?58:44}),signatureLayer()]}));
    showEditor();return;
  }
  state.kind='story';state.format='story';state.title=kind==='morning'?'Storia del buongiorno':'Nuova storia';
  const idx=kind==='morning'?2:Math.floor(Math.random()*Math.min(photos.length,10));
  const text=forcedText || randomPhrase(kind==='morning'?'morning':'generic');
  state.slides=[newSlide({mediaType:'image',assetSrc:photos[idx]?.src,look:kind==='morning'?'warm':'soft',layers:[defaultLayer(text,{y:.76,background:'cream',font:kind==='morning'?'script':'editorial',fontSize:kind==='morning'?56:50}),signatureLayer()]})];
  showEditor();
}
function startFromLibraryPhoto(index){
  state.kind='story';state.format='story';state.title='Nuova storia';state.projectId=null;state.activeSlide=0;
  state.slides=[newSlide({mediaType:'image',assetSrc:photos[index].src,look:'soft',layers:[defaultLayer('Aggiungi una frase',{y:.78,background:'glass',font:'editorial'}),signatureLayer()]})];
  showEditor();
}
function useTemplate(id){
  const t=templateDefs.find(x=>x.id===id); if(!t)return;
  if(t.cat==='carousel'){ startCreation('carousel'); currentSlide().layers[0].text=t.text; renderStage(); return; }
  if(t.cat==='reel'){ startCreation('reel'); currentSlide().layers[0].text=t.text; return; }
  state.kind='template';state.format='story';state.title=t.title;state.projectId=null;state.activeSlide=0;
  state.slides=[newSlide({mediaType:t.photo!==null?'image':null,assetSrc:t.photo!==null?photos[t.photo]?.src:null,look:t.look,layers:[defaultLayer(t.text,{y:t.photo===null?.5:.75,background:t.bg,font:t.font,fontSize:t.photo===null?58:50}),signatureLayer()],bgColor:t.photo===null?'#f5eee6':'#201713'})];
  showEditor();
}
function showEditor(){ showScreen('editor'); $('#editor-mode-label').textContent=state.kind==='carousel'?'Carosello':state.kind==='reel'?'Reel':state.kind==='template'?'Template':'Storia'; $('#editor-build').textContent=BUILD; renderAllEditorControls(); renderStage(); }

function revokeSlideUrl(slide){ if(slide.mediaUrl?.startsWith('blob:')){URL.revokeObjectURL(slide.mediaUrl);objectUrls=objectUrls.filter(x=>x!==slide.mediaUrl);} slide.mediaUrl=null; }
function loadLocalMedia(file,type){
  const s=currentSlide();revokeSlideUrl(s);s.mediaBlob=file;s.mediaType=type;s.assetSrc=null;s.mediaUrl=URL.createObjectURL(file);objectUrls.push(s.mediaUrl);
  renderStage();
  toast(type==='image'?'Foto caricata':'Video caricato');
}
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
  img.hidden=true;vid.hidden=true;empty.classList.toggle('hidden',!!url);
  if(url && s.mediaType==='image'){
    img.hidden=false;img.src=url;img.onload=()=>{};img.onerror=()=>toast('Questa foto non viene letta da Safari. Prova un’altra copia o JPEG/PNG.');
  }else if(url && s.mediaType==='video'){
    vid.hidden=false;if(vid.src!==url)vid.src=url;vid.onerror=()=>toast('Questo video non viene letto da Safari. Prova MP4/H.264.');
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
    const im=new Image();im.src=layer.src;im.alt='';el.appendChild(im);
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
  const up=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);renderStage();};
  window.addEventListener('pointermove',move);window.addEventListener('pointerup',up,{once:true});
}
function renderCarouselStrip(){
  const strip=$('#carousel-strip'); if(state.kind!=='carousel'){strip.classList.add('hidden');strip.innerHTML='';return;} strip.classList.remove('hidden');
  strip.innerHTML=state.slides.map((s,i)=>`<button class="carousel-thumb ${i===state.activeSlide?'selected':''}" data-slide-index="${i}"><img src="${resolveMediaUrl(s)||'./ia_photo_01.webp'}" alt=""></button>`).join('');
  $$('#carousel-strip [data-slide-index]').forEach(b=>b.onclick=()=>{state.activeSlide=+b.dataset.slideIndex;state.selectedLayerId=null;renderStage();});
}

function deleteSelectedLayer(){
  if(!state.selectedLayerId)return;const s=currentSlide();s.layers=s.layers.filter(x=>x.id!==state.selectedLayerId);state.selectedLayerId=null;renderStage();
}
function duplicateSelectedLayer(){
  if(!state.selectedLayerId)return;const s=currentSlide(),l=s.layers.find(x=>x.id===state.selectedLayerId);if(!l)return;const copy={...l,id:uid(l.type==='text'?'txt':l.type==='sticker'?'stk':'sig'),x:clamp(l.x+.06,.08,.92),y:clamp(l.y+.05,.08,.92)};s.layers.push(copy);state.selectedLayerId=copy.id;renderStage();
}

function selectTool(tool){
  if(tool==='text'){const t=currentSlide()?.layers.find(x=>x.type==='text');if(t)state.selectedLayerId=t.id;}
  $$('#editor-rail button').forEach(b=>b.classList.toggle('selected',b.dataset.tool===tool));
  $$('.tool-panel').forEach(p=>p.classList.toggle('active',p.dataset.panel===tool));
  if(tool==='phrases')renderPhrasePicker();if(tool==='stickers')renderStickerPicker();if(tool==='look')renderLookRow();
}
function renderAllEditorControls(){ renderFonts();renderBackgrounds();renderColors();renderLookRow();renderPhrasePicker();renderStickerPicker(); }
function selectedText(){ return currentSlide()?.layers.find(x=>x.id===state.selectedLayerId&&x.type==='text') || currentSlide()?.layers.find(x=>x.type==='text'); }
function syncTextControls(){
  const l=selectedText();if(!l)return;state.selectedLayerId=state.selectedLayerId||l.id;$('#text-input').value=l.text;$('#text-size').value=l.fontSize;$('#text-size-out').value=l.fontSize;$('#text-width').value=l.width;$('#text-width-out').value=l.width+'%';$('#text-bg-opacity').value=l.bgOpacity??70;$('#text-bg-opacity-out').value=(l.bgOpacity??70)+'%';
  $$('.font-option').forEach(b=>b.classList.toggle('selected',b.dataset.font===l.font));$$('.background-option').forEach(b=>b.classList.toggle('selected',b.dataset.background===l.background));$$('.color-chip').forEach(b=>b.classList.toggle('selected',b.dataset.color===l.color));$$('.align-row button').forEach(b=>b.classList.toggle('selected',b.dataset.align===l.align));
}
function updateSelectedText(patch){ const l=selectedText();if(!l)return;Object.assign(l,patch);renderStage(); }
function addTextLayer(text='Nuova frase'){ const l=defaultLayer(text,{y:.55,background:'glass',font:'rounded',fontSize:44});currentSlide().layers.push(l);state.selectedLayerId=l.id;renderStage();selectTool('text'); }
function renderFonts(){
  const fonts=[['editorial','Aa','Editoriale'],['script','Aa','Corsivo'],['serif','Aa','Classica'],['rounded','Aa','Rotonda'],['modern','Aa','Moderna']];
  $('#font-row').innerHTML=fonts.map(([id,s,n])=>`<button class="font-option font-${id}" data-font="${id}"><b>${s}</b><small>${n}</small></button>`).join('');
  $$('.font-option').forEach(b=>b.onclick=()=>updateSelectedText({font:b.dataset.font}));
}
function renderBackgrounds(){
  const bgs=[['none','Nessuno'],['cream','Avorio'],['dark','Scuro'],['glass','Vetro'],['paper','Carta'],['outline','Linea']];
  $('#background-row').innerHTML=bgs.map(([id,n])=>`<button class="background-option bg-preview-${id}" data-background="${id}" title="${n}"></button>`).join('');
  $$('.background-option').forEach(b=>b.onclick=()=>updateSelectedText({background:b.dataset.background}));
}
function renderColors(){
  const colors=['#fffaf5','#f6f2ea','#e45718','#f5b08b','#2a211d','#0d0d0d','#ffffff'];
  $('#color-row').innerHTML=colors.map(c=>`<button class="color-chip" data-color="${c}" style="background:${c}"></button>`).join('');
  $$('.color-chip').forEach(b=>b.onclick=()=>updateSelectedText({color:b.dataset.color}));
  $$('.align-row button').forEach(b=>b.onclick=()=>updateSelectedText({align:b.dataset.align}));
}
function renderLookRow(){
  const looks=[['original','Originale'],['warm','Caldo'],['soft','Soft'],['cinema','Cinema'],['bw','B/N']];const s=currentSlide();
  $('#look-row').innerHTML=looks.map(([id,n])=>`<button class="look-option ${s.look===id?'selected':''}" data-look="${id}"><div class="look-thumb" style="filter:${filterCss({...s,look:id})}"></div><b>${n}</b></button>`).join('');
  $$('.look-option').forEach(b=>b.onclick=()=>{s.look=b.dataset.look;renderMediaLook();renderLookRow();});
}
function renderPhrasePicker(){
  const list=[...phrases].sort(()=>Math.random()-.5).slice(0,18);$('#phrase-picker').innerHTML=list.map(p=>`<button class="phrase-pick" data-phrase-pick="${p.id}"><p>${escapeHtml(p.testo)}</p><small>${escapeHtml((p.categoria||'').replaceAll('_',' '))}</small></button>`).join('');
  $$('[data-phrase-pick]').forEach(b=>b.onclick=()=>{const p=phrases.find(x=>x.id===b.dataset.phrasePick);const l=selectedText();if(l){l.text=p.testo;renderStage();}else addTextLayer(p.testo);});
}
function renderStickerPicker(){
  $('#sticker-picker').innerHTML=stickers.slice(0,40).map(s=>`<button class="sticker-item" data-sticker-pick="${s.id}"><img src="./${s.file}" alt=""></button>`).join('');
  $$('[data-sticker-pick]').forEach(b=>b.onclick=()=>{const s=stickers.find(x=>x.id===b.dataset.stickerPick);const l={id:uid('stk'),type:'sticker',src:'./'+s.file,x:.5,y:.55,width:30};currentSlide().layers.push(l);state.selectedLayerId=l.id;renderStage();});
}
async function addCustomPhrase(){
  const t=prompt('Scrivi la nuova frase');if(!t?.trim())return;const p={id:uid('USR'),categoria:'personali',testo:t.trim(),attiva_per_suggerimenti:true,gia_usata:false};await IADB.put('phrases',p);phrases.push(p);renderPhraseBank();renderCounts();toast('Frase aggiunta');
}

async function saveProject(){
  try{
    const thumb=await renderComposite(260, state.format==='carousel'?325:462, currentSlide());
    const rec={id:state.projectId||uid('project'),title:state.title,kind:state.kind,createdAt:Date.now(),updatedAt:Date.now(),state:serializeState(),thumb:thumb.toDataURL('image/jpeg',.72)};
    state.projectId=rec.id;await IADB.put('projects',rec);projects=await IADB.getAll('projects');renderProjects();toast('Progetto salvato');
  }catch(e){console.error(e);toast('Non sono riuscita a salvare il progetto');}
}
function serializeState(){ return {kind:state.kind,format:state.format,activeSlide:state.activeSlide,title:state.title,slides:state.slides.map(s=>({...s,mediaUrl:null}))}; }
async function openProject(id){
  const p=projects.find(x=>x.id===id);if(!p)return;state.projectId=p.id;state.kind=p.state.kind;state.format=p.state.format;state.activeSlide=p.state.activeSlide||0;state.title=p.state.title||p.title;state.slides=p.state.slides;state.selectedLayerId=null;showEditor();
}

async function exportCurrent(){
  try{
    if(state.kind==='reel' && currentSlide().mediaType==='video') return await exportReel();
    if(state.kind==='carousel') return await exportCarousel();
    const w=1080,h=1920;const canvas=await renderComposite(w,h,currentSlide());const blob=await new Promise(r=>canvas.toBlob(r,'image/jpeg',.94));await shareBlob(blob,`IA_story_${dateStamp()}.jpg`,'La tua storia è pronta');
    markUsedPhrase();
  }catch(e){console.error(e);toast('Esportazione non riuscita');}
}
async function exportCarousel(){
  const files=[];for(let i=0;i<state.slides.length;i++){const c=await renderComposite(1080,1350,state.slides[i]);const b=await new Promise(r=>c.toBlob(r,'image/jpeg',.94));files.push(new File([b],`IA_carosello_${dateStamp()}_${i+1}.jpg`,{type:'image/jpeg'}));}
  if(navigator.canShare?.({files}) && navigator.share){await navigator.share({files,title:'Ironicamente Acida · Carosello'});}else{for(const f of files)downloadBlob(f,f.name);}
  toast('Carosello pronto');
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
  const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d');ctx.fillStyle=slide.bgColor||'#201713';ctx.fillRect(0,0,w,h);
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
function loadImage(src){return new Promise((res,rej)=>{const im=new Image();im.onload=()=>res(im);im.onerror=rej;im.src=src;});}
function escapeHtml(s=''){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}

boot();
