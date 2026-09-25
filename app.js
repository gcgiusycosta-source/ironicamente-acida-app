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
    original:{w:null,h:null,label:'Originale'}, ratio43:{w:1440,h:1080,label:'4:3'}, ratio169:{w:1920,h:1080,label:'16:9'}, square:{w:1080,h:1080,label:'1:1'},
    story:{w:1080,h:1920,label:'Story 9:16'}, post45:{w:1080,h:1350,label:'Post 4:5'}, post34:{w:1080,h:1440,label:'Post 3:4'}
  };
  const categoryLabels = {
    buongiorno_vita_reale:'Buongiorno + vita reale', buongiorno_maternita:'Buongiorno + maternità', buongiorno_libri:'Buongiorno + libri', maternita:'Maternità', vita_reale:'Vita reale', viaggi:'Viaggi', libri:'Libri', amore_coppia_relazioni:'Amore / relazioni'
  };
  const canvas = $('#design-canvas');
  const ctx = canvas.getContext('2d');
  let bgImage = null, signatureImage = null, videoEl = null, videoBlob = null, videoObjectUrl = null, videoFrameHandle = null, videoAudioCtx=null, videoAudioSource=null, videoAudioDest=null;
  const imageCache = new Map();
  let photoFilterCacheKey='', photoFilterCanvas=null;
  let screen = 'home', previousScreen = 'home', phrasePickerMode = false, stickerPickerMode = false;
  let selectedTemplate = 'editorial';
  let phraseView = { status:'available', category:'all', search:'' };
  let stickerView = { category:'all', style:'all', search:'', favorites:false };
  let historyStack=[], redoStack=[], historyTimer=null, compareOriginal=false;
  let drag = null, autosaveTimer = null;
  let activeTool = 'format', lastTextBounds = null;
  let defaults = { filter:'soft', format:'original' };

  function blankState(mode='template') {
    const isMedia=mode==='photo'||mode==='video';
    return {
      mode, projectId:null, format:isMedia?(defaults.format||'original'):'story', templateStyle:selectedTemplate,
      photoStyle:'short', filter:defaults.filter || 'soft', filterIntensity:85, bgDataUrl:null,
      photoFit:'cover', photoZoom:1, photoX:0, photoY:0,
      adjustments:{exposure:0,contrast:0,highlights:0,shadows:0,temperature:0,saturation:0,sharpness:0,vignette:0},
      videoTrimStart:0, videoTrimEnd:null, videoMuted:false, videoDuration:0,
      phrase:'', phraseId:null, highlight:'', textTone:'dark', textSize:82,
      textFont:'editorial', textColor:C.ink, textWeight:'normal', textItalic:false, textWidth:.78, textLineHeight:1.23,
      textAlign:'center', textX:.5, textY:isMedia?.22:.45,
      signatureEnabled:mode==='template', signaturePosition:'center', signatureSize:100, signatureY:.92, overlays:[], selectedOverlayId:null,
      createdAt:nowISO(), updatedAt:nowISO()
    };
  }
  // ---------- bootstrap ----------
  document.addEventListener('DOMContentLoaded', init);
  async function init() {
    await IADB.open();
    signatureImage = await loadImage('./signature.svg').catch(()=>null);
    videoEl = $('#source-video');
    defaults.filter = await IADB.metaGet('default_filter','soft');
    defaults.format = await IADB.metaGet('default_format','story');
    await seedStarter(false);
    await loadSettingsUI();
    bindEvents();
    await refreshAll();
    await sleep(820);
    $('#splash').classList.add('hidden');
    $('#app').classList.remove('hidden');
    showScreen('home', false);
    await offerDraft();
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(()=>{});
  }

  async function seedStarter(forceMerge=false) {
    const seedVersion = await IADB.metaGet('starter_seed_version',0);
    if (seedVersion >= 3 && !forceMerge) return;
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
    const favorites = new Map(currentStickers.map(x=>[normalize(x.title),!!x.favorite]));
    if(seedVersion<3){for(const s of currentStickers){if(s.sourceType==='starter')await IADB.del('stickers',s.id);}}
    const after = await IADB.getAll('stickers');
    const stickerKeys = new Set(after.map(x=>`${normalize(x.title)}|${x.style||''}`));
    const addS = (sm.stickers||[]).map(s=>({
      id:s.id || uid('stk'), title:s.title || 'Sticker', category:s.category || 'Importati', style:s.style || 'Brand', tags:s.tags||[], favorite:favorites.get(normalize(s.title))||false, active:s.active!==false,
      src:`./${s.file}`, sourceType:'starter', source:'Sticker Master V2', createdAt:nowISO(), updatedAt:nowISO()
    })).filter(s=>!stickerKeys.has(`${normalize(s.title)}|${s.style||''}`));
    if (addS.length) await IADB.bulkPut('stickers', addS);
    await IADB.metaSet('starter_seed_version',3);
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
    if(name!=='editor'&&videoEl&&!videoEl.paused)videoEl.pause();
    window.scrollTo({top:0,behavior:'instant'});
  }

  // ---------- events ----------
  function openCreateHub(){
    openModal('Crea qualcosa di tuo',`<div class="media-choice dynamic-create-sheet"><button class="creation-card primary" id="choose-photo"><span class="creation-icon">◉</span><strong>Foto</strong><small>Filtro, testo e sticker</small></button><button class="creation-card primary" id="choose-video"><span class="creation-icon">▶</span><strong>Video</strong><small>Look, testo e movimento</small></button></div><button class="secondary-button full" id="choose-template-hub">Aa &nbsp; Crea da template</button>`);
    const t=$('#choose-template-hub');if(t)t.onclick=()=>{closeModal();showScreen('templates');};
  }
  function bindEvents() {
    $$('[data-nav]').forEach(b=>b.addEventListener('click',()=>showScreen(b.dataset.nav)));
    $('#header-back').addEventListener('click',()=>{if(screen==='phrases')phrasePickerMode=false;if(screen==='stickers')stickerPickerMode=false;showScreen(previousScreen || 'home', false);});
    $('#header-settings').addEventListener('click',()=>showScreen('settings'));
    $('#home-template').addEventListener('click',()=>showScreen('templates'));
    $('#home-photo').addEventListener('click',()=>{$('#photo-file').dataset.action='new';$('#photo-file').click();});
    $('#home-video').addEventListener('click',()=>{$('#video-file').dataset.action='new';$('#video-file').click();});
    $('#home-video-hero').addEventListener('click',()=>{$('#video-file').dataset.action='new';$('#video-file').click();});
    $('#nav-create').addEventListener('click',openCreateHub);

    $$('#template-picker [data-template]').forEach(b=>b.addEventListener('click',()=>{
      selectedTemplate=b.dataset.template; $$('#template-picker [data-template]').forEach(x=>x.classList.toggle('selected',x===b));
    }));
    $('#use-template').addEventListener('click',()=>startTemplate());

    $$('#tool-tabs [data-tool]').forEach(b=>b.addEventListener('click',()=>openTool(b.dataset.tool)));
    $$('#format-options button').forEach(b=>b.addEventListener('click',()=>{
      if(b.dataset.value==='original'&&!isMediaMode())return;
      state.format=b.dataset.value;
      if(state.format==='original'){state.photoFit='contain';state.photoZoom=1;state.photoX=0;state.photoY=0;syncChoice('#photo-fit',state.photoFit);}
      syncChoice('#format-options',state.format); resizeCanvas(); syncEditorControls(); changed();commitHistorySoon();
    }));
    $$('#filter-options button').forEach(b=>b.addEventListener('click',()=>{state.filter=b.dataset.value; syncChoice('#filter-options',state.filter); changed();updateEditorStatus();commitHistorySoon();}));
    $('#filter-intensity').addEventListener('input',e=>{state.filterIntensity=+e.target.value;e.target.nextElementSibling.value=state.filterIntensity+'%';changed(false);commitHistorySoon();});
    $$('#photo-fit button').forEach(b=>b.addEventListener('click',()=>{state.photoFit=b.dataset.value;syncChoice('#photo-fit',state.photoFit);changed();}));
    $('#photo-reset').addEventListener('click',()=>{state.photoZoom=1;state.photoX=0;state.photoY=0;syncEditorControls();changed();});
    $('#photo-zoom').addEventListener('input',e=>{state.photoZoom=+e.target.value;e.target.nextElementSibling.value=Math.round(state.photoZoom*100)+'%';changed(false);});
    $('#photo-x').addEventListener('input',e=>{state.photoX=+e.target.value;e.target.nextElementSibling.value=Math.round(state.photoX*100);changed(false);});
    $('#photo-y').addEventListener('input',e=>{state.photoY=+e.target.value;e.target.nextElementSibling.value=Math.round(state.photoY*100);changed(false);});
    $('#phrase-input').addEventListener('input',e=>{state.phrase=e.target.value;state.phraseId=null;if(isMediaMode()&&state.phrase.trim()&&state.photoStyle==='clean'){state.photoStyle='short';populateStyleOptions();}changed(false);});
    $('#highlight-input').addEventListener('input',e=>{state.highlight=e.target.value;changed(false);});
    $('#text-size').addEventListener('input',e=>{state.textSize=+e.target.value;e.target.nextElementSibling.value=state.textSize;changed(false);});
    $('#text-width').addEventListener('input',e=>{state.textWidth=+e.target.value/100;e.target.nextElementSibling.value=e.target.value+'%';changed(false);});
    $('#text-line-height').addEventListener('input',e=>{state.textLineHeight=+e.target.value/100;e.target.nextElementSibling.value=e.target.value+'%';changed(false);});
    $('#text-font').addEventListener('change',e=>{state.textFont=e.target.value;changed();});
    $$('#text-weight button[data-value="normal"], #text-weight button[data-value="bold"]').forEach(b=>b.addEventListener('click',()=>{state.textWeight=b.dataset.value;$$('#text-weight button[data-value="normal"], #text-weight button[data-value="bold"]').forEach(x=>x.classList.toggle('selected',x.dataset.value===state.textWeight));changed();}));
    $('#text-italic-toggle').addEventListener('click',()=>{state.textItalic=!state.textItalic;$('#text-italic-toggle').classList.toggle('selected',state.textItalic);changed();});
    $$('#text-color-presets button').forEach(b=>b.addEventListener('click',()=>{state.textColor=b.dataset.color;$('#text-color').value=state.textColor;syncColorPresets();changed();}));
    $('#text-color').addEventListener('input',e=>{state.textColor=e.target.value;syncColorPresets();changed(false);});
    $$('#text-align button').forEach(b=>b.addEventListener('click',()=>{state.textAlign=b.dataset.value;state.textX=state.textAlign==='left'?.08:state.textAlign==='right'?.92:.5;syncChoice('#text-align',state.textAlign);$('#text-x').value=Math.round(state.textX*100);$('#text-x').nextElementSibling.value=Math.round(state.textX*100)+'%';changed();}));
    $('#text-x').addEventListener('input',e=>{state.textX=+e.target.value/100;e.target.nextElementSibling.value=e.target.value+'%';changed(false);});
    $('#text-y').addEventListener('input',e=>{state.textY=+e.target.value/100;e.target.nextElementSibling.value=e.target.value+'%';changed(false);});
    $('#signature-enabled').addEventListener('change',e=>{state.signatureEnabled=e.target.checked;changed();commitHistorySoon();});
    $$('#signature-position button').forEach(b=>b.addEventListener('click',()=>{state.signaturePosition=b.dataset.value;syncChoice('#signature-position',state.signaturePosition);changed();}));
    $('#signature-size').addEventListener('input',e=>{state.signatureSize=+e.target.value;e.target.nextElementSibling.value=state.signatureSize+'%';changed(false);});
    $('#signature-y').addEventListener('input',e=>{state.signatureY=+e.target.value/100;e.target.nextElementSibling.value=e.target.value+'%';changed(false);});
    $('#replace-media').addEventListener('click',()=>{if(state.mode==='video'){$('#video-file').dataset.action='replace';$('#video-file').click();}else{$('#photo-file').dataset.action='replace';$('#photo-file').click();}});
    $('#photo-file').addEventListener('change',handlePhotoFile);
    $('#video-file').addEventListener('change',handleVideoFile);
    $('#add-image').addEventListener('click',()=>$('#overlay-file').click());
    $('#overlay-file').addEventListener('change',handleOverlayFile);
    $('#choose-phrase').addEventListener('click',()=>{phrasePickerMode=true;previousScreen='editor';showScreen('phrases',false);});
    $('#go-sticker-library').addEventListener('click',()=>{stickerPickerMode=true;previousScreen='editor';showScreen('stickers',false);});
    $('#preview-button').addEventListener('click',openPreview);
    $('#save-project-button').addEventListener('click',saveProject);
    $('#export-button').addEventListener('click',exportDesign);
    $('#preview-export').addEventListener('click',exportDesign);
    $('#preview-close').addEventListener('click',closePreview); $('#preview-back').addEventListener('click',closePreview);
    $('#editor-discard').addEventListener('click',discardCurrentDesign);
    $('#selection-delete').addEventListener('click',deleteSelectedOverlay);
    $('#selection-edit').addEventListener('click',()=>{const o=state.overlays.find(x=>x.id===state.selectedOverlayId);if(!o)return;openTool(o.type==='sticker'?'sticker':'media');renderLayerControls();});
    $('#adjust-reset').addEventListener('click',()=>{state.adjustments={exposure:0,contrast:0,highlights:0,shadows:0,temperature:0,saturation:0,sharpness:0,vignette:0};syncAdjustmentControls();changed();commitHistorySoon();});
    ['exposure','contrast','highlights','shadows','temperature','saturation','sharpness','vignette'].forEach(k=>{$('#adj-'+k).addEventListener('input',e=>{state.adjustments[k]=+e.target.value;e.target.nextElementSibling.value=e.target.value;changed(false);commitHistorySoon();});});
    $('#signature-remove').addEventListener('click',()=>{state.signatureEnabled=false;syncEditorControls();changed();commitHistorySoon();});
    $('#compare-original').addEventListener('pointerdown',()=>{compareOriginal=true;renderCanvas();});
    ['pointerup','pointercancel','pointerleave'].forEach(ev=>$('#compare-original').addEventListener(ev,()=>{compareOriginal=false;renderCanvas();}));
    $('#editor-undo').addEventListener('click',undoState);$('#editor-redo').addEventListener('click',redoState);
    $('#video-play').addEventListener('click',toggleVideoPlayback);$('#video-scrub').addEventListener('input',e=>{if(!videoEl)return;videoEl.currentTime=+e.target.value;renderCanvas();});
    $('#video-trim-start').addEventListener('input',e=>{state.videoTrimStart=+e.target.value;e.target.nextElementSibling.value=formatTime(state.videoTrimStart);if(state.videoTrimEnd!=null&&state.videoTrimStart>=state.videoTrimEnd){state.videoTrimStart=Math.max(0,state.videoTrimEnd-.1);e.target.value=state.videoTrimStart;}changed(false);});
    $('#video-trim-end').addEventListener('input',e=>{state.videoTrimEnd=+e.target.value;e.target.nextElementSibling.value=formatTime(state.videoTrimEnd);if(state.videoTrimEnd<=state.videoTrimStart){state.videoTrimEnd=Math.min(state.videoDuration,state.videoTrimStart+.1);e.target.value=state.videoTrimEnd;}changed(false);});
    $('#video-audio').addEventListener('change',e=>{state.videoMuted=!e.target.checked;if(videoEl)videoEl.muted=state.videoMuted;changed(false);});

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
    $('#modal-body').addEventListener('click',e=>{
      if(e.target.closest('#choose-photo')){closeModal();$('#photo-file').dataset.action='new';$('#photo-file').click();}
      if(e.target.closest('#choose-video')){closeModal();$('#video-file').dataset.action='new';$('#video-file').click();}
    });
  }

  function syncChoice(root,value){$$(root+' button').forEach(b=>b.classList.toggle('selected',b.dataset.value===value));}

  // ---------- editor lifecycle ----------
  async function startTemplate() {
    state=blankState('template'); state.templateStyle=selectedTemplate; state.phrase='Le parole giuste, al momento giusto.'; state.textSize=88;
    bgImage=null; await enterEditor(); openTool('text');
  }
  async function handlePhotoFile(e) {
    const f=e.target.files?.[0];
    if(!f)return;
    const action=e.target.dataset.action||'new';
    e.target.value='';
    openModal('Preparazione foto',`<div class="export-progress"><p class="muted">Sto preparando la fotografia per l’editor…</p><progress max="100"></progress><div class="video-export-note">Mantengo le proporzioni originali e ottimizzo il file per iPhone.</div></div>`);
    try{
      await nextPaint();
      const prepared=await preparePhotoFile(f);
      cleanupVideo();
      if(action==='new'){
        state=blankState('photo');
        state.filter=defaults.filter;
        state.format=defaults.format||'original';
        state.bgDataUrl=prepared.data;
        state.photoFit=state.format==='original'?'contain':'cover';
        state.photoZoom=1;state.photoX=0;state.photoY=0;
      }else{
        state.mode='photo';state.bgDataUrl=prepared.data;state.format=state.format||'original';
      }
      bgImage=prepared.image;
      closeModal();
      await enterEditor();
      openTool('look');
    }catch(err){
      console.error('Errore caricamento foto',err);
      closeModal();
      openModal('Foto non caricata',`<p class="muted">Non sono riuscita ad aprire questa fotografia. Prova a sceglierla di nuovo oppure, se è in un formato particolare, salvala prima in Foto come JPEG/PNG.</p><div class="modal-buttons"><button class="big-button" id="photo-error-close">OK</button></div>`);
      $('#photo-error-close').onclick=closeModal;
    }
  }
  async function handleVideoFile(e){
    const f=e.target.files?.[0];
    if(!f)return;
    const action=e.target.dataset.action||'new';
    e.target.value='';
    openModal('Preparazione video',`<div class="export-progress"><p class="muted">Sto preparando il video per l’editor…</p><progress max="100"></progress><div class="video-export-note">Il file resta nel formato originale: carico solo i metadati e il primo fotogramma, senza ricodificarlo.</div></div>`);
    try{
      await nextPaint();
      const looksLikeVideo=/^video\//i.test(f.type||'')||/\.(mp4|mov|m4v|webm)$/i.test(f.name||'');
      if(!looksLikeVideo)throw new Error('Il file selezionato non risulta essere un video.');
      cleanupVideo();
      videoBlob=f;
      videoObjectUrl=URL.createObjectURL(f);
      if(action==='new'){
        state=blankState('video');
        state.filter=defaults.filter;
        state.format=defaults.format||'original';
        state.photoFit=state.format==='original'?'contain':'cover';
        state.photoZoom=1;state.photoX=0;state.photoY=0;
      }else state.mode='video';
      state.bgDataUrl=null;bgImage=null;
      await setupVideoFromUrl(videoObjectUrl,{timeoutMs:20000});
      closeModal();
      await enterEditor();
      openTool('look');
    }catch(err){
      console.error('Errore caricamento video',err);
      cleanupVideo();
      closeModal();
      const detail=escapeHtml(err?.message||'Video non leggibile');
      openModal('Video non caricato',`<p class="muted">Non sono riuscita ad aprire questo video. ${detail}</p><p class="muted">Se il file arriva dall’iPhone, prova a selezionarlo nuovamente da Foto. Se continua a non aprirsi, esportalo come MP4/H.264 e riprova.</p><div class="modal-buttons"><button class="big-button" id="video-error-close">OK</button></div>`);
      $('#video-error-close').onclick=closeModal;
    }
  }
  async function enterEditor() {
    ensureStateDefaults(); await hydrateMedia(); syncEditorControls(); showScreen('editor'); resizeCanvas(); renderCanvas(); syncLookPreviewVisuals(); initHistory(); scheduleDraft(); updateEditorStatus();
    if(state.mode==='video')startVideoFrameLoop();
  }
  function syncLookPreviewVisuals(){
    const previews=$$('.look-preview');if(!previews.length)return;
    let src=state.mode==='photo'&&state.bgDataUrl?state.bgDataUrl:null;
    if(!src&&state.mode==='video'&&videoEl&&videoEl.readyState>=2){
      try{const c=document.createElement('canvas');c.width=240;c.height=240;const x=c.getContext('2d');const iw=videoEl.videoWidth||240,ih=videoEl.videoHeight||240;const sc=Math.max(240/iw,240/ih),dw=iw*sc,dh=ih*sc;x.drawImage(videoEl,(240-dw)/2,(240-dh)/2,dw,dh);src=c.toDataURL('image/jpeg',.68);}catch(_e){}
    }
    if(!src)src='./home-portrait.webp';
    previews.forEach(el=>{el.style.backgroundImage=`url(${src})`;el.style.backgroundSize='cover';el.style.backgroundPosition='center';});
  }
  function ensureStateDefaults(){
    if(!state.textAlign)state.textAlign='center';
    if(typeof state.textX!=='number')state.textX=.5;
    if(typeof state.textY!=='number')state.textY=isMediaMode()?.22:.45;
    if(!state.photoFit)state.photoFit=state.format==='original'?'contain':'cover';
    if(state.mode==='template'&&state.format==='original')state.format='story';
    if(!state.textFont)state.textFont='editorial';
    if(!state.textColor)state.textColor=state.textTone==='light'?C.white:C.ink;
    if(!state.textWeight)state.textWeight='normal';
    if(typeof state.textItalic!=='boolean')state.textItalic=false;
    if(typeof state.textWidth!=='number')state.textWidth=.78;
    if(typeof state.textLineHeight!=='number')state.textLineHeight=1.23;
    if(typeof state.signatureSize!=='number')state.signatureSize=100;
    if(typeof state.signatureY!=='number')state.signatureY=.92;
    state.adjustments=Object.assign({exposure:0,contrast:0,highlights:0,shadows:0,temperature:0,saturation:0,sharpness:0,vignette:0},state.adjustments||{});
    if(typeof state.videoMuted!=='boolean')state.videoMuted=false;
    state.overlays=state.overlays||[];
  }
  async function discardCurrentDesign(){
    if(!confirm('Chiudere questa composizione? Le modifiche non salvate verranno eliminate.'))return;
    await IADB.del('drafts','current');cleanupVideo();state=blankState('template');bgImage=null;imageCache.clear();drag=null;
    showScreen('home',false);toast('Composizione chiusa.');
  }
  function openTool(tool){activeTool=tool;$$('#tool-tabs button').forEach(b=>b.classList.toggle('selected',b.dataset.tool===tool));$$('.tool-panel').forEach(p=>p.classList.toggle('active',p.dataset.panel===tool));}
  function populateStyleOptions(){
    $$('[data-media-only]').forEach(x=>x.classList.toggle('hidden',!isMediaMode()));
    $$('[data-media-format]').forEach(x=>x.classList.toggle('hidden',!isMediaMode()));
    $$('[data-template-format]').forEach(x=>x.classList.toggle('hidden',state.mode!=='template'));
  }
  function syncEditorControls(){
    populateStyleOptions();
    syncChoice('#format-options',state.format);syncChoice('#filter-options',state.filter);syncChoice('#photo-fit',state.photoFit);syncChoice('#text-align',state.textAlign);syncChoice('#signature-position',state.signaturePosition);
    $('#filter-intensity').value=state.filterIntensity;$('#filter-intensity').nextElementSibling.value=state.filterIntensity+'%';
    $('#photo-zoom').value=state.photoZoom;$('#photo-zoom').nextElementSibling.value=Math.round(state.photoZoom*100)+'%';
    $('#photo-x').value=state.photoX;$('#photo-x').nextElementSibling.value=Math.round(state.photoX*100);$('#photo-y').value=state.photoY;$('#photo-y').nextElementSibling.value=Math.round(state.photoY*100);
    $('#phrase-input').value=state.phrase||'';$('#highlight-input').value=state.highlight||'';$('#text-size').value=state.textSize;$('#text-size').nextElementSibling.value=state.textSize;
    $('#text-font').value=state.textFont;$('#text-color').value=state.textColor;syncColorPresets();
    $$('#text-weight button[data-value="normal"], #text-weight button[data-value="bold"]').forEach(x=>x.classList.toggle('selected',x.dataset.value===state.textWeight));$('#text-italic-toggle').classList.toggle('selected',state.textItalic);
    $('#text-width').value=Math.round(state.textWidth*100);$('#text-width').nextElementSibling.value=Math.round(state.textWidth*100)+'%';$('#text-line-height').value=Math.round(state.textLineHeight*100);$('#text-line-height').nextElementSibling.value=Math.round(state.textLineHeight*100)+'%';
    $('#text-x').value=Math.round(state.textX*100);$('#text-x').nextElementSibling.value=Math.round(state.textX*100)+'%';$('#text-y').value=Math.round(state.textY*100);$('#text-y').nextElementSibling.value=Math.round(state.textY*100)+'%';
    $('#signature-enabled').checked=state.signatureEnabled;$('#signature-size').value=state.signatureSize;$('#signature-size').nextElementSibling.value=state.signatureSize+'%';$('#signature-y').value=Math.round(state.signatureY*100);$('#signature-y').nextElementSibling.value=Math.round(state.signatureY*100)+'%';
    $('#signature-controls').classList.toggle('hidden',!state.signatureEnabled);syncAdjustmentControls();
    const isVid=state.mode==='video';$('#video-controls').classList.toggle('hidden',!isVid);$('#video-playbar').classList.toggle('hidden',!isVid);$('#media-panel-title').textContent=isVid?'Video principale':state.mode==='photo'?'Foto principale':'Template';
    if(isVid&&videoEl){const d=state.videoDuration||videoEl.duration||0;$('#video-scrub').max=d;$('#video-scrub').value=videoEl.currentTime||0;$('#video-duration').textContent=formatTime(d);$('#video-trim-start').max=d;$('#video-trim-end').max=d;$('#video-trim-start').value=state.videoTrimStart||0;$('#video-trim-end').value=state.videoTrimEnd??d;$('#video-trim-start').nextElementSibling.value=formatTime(state.videoTrimStart||0);$('#video-trim-end').nextElementSibling.value=formatTime(state.videoTrimEnd??d);$('#video-audio').checked=!state.videoMuted;}
    renderLayerControls();renderSelectionToolbar();updateEditorStatus();
  }
  function syncColorPresets(){const c=(state.textColor||'').toUpperCase();$$('#text-color-presets button').forEach(b=>b.classList.toggle('selected',(b.dataset.color||'').toUpperCase()===c));}
  function changed(doRender=true){state.updatedAt=nowISO();photoFilterCacheKey='';if(doRender)renderCanvas();else requestAnimationFrame(renderCanvas);scheduleDraft();updateEditorStatus();}
  function scheduleDraft(){clearTimeout(autosaveTimer);autosaveTimer=setTimeout(()=>IADB.put('drafts',{key:'current',state:deepClone(state),mediaBlob:state.mode==='video'?videoBlob:null,updatedAt:nowISO()}),800);}
  async function offerDraft(){
    const d=await IADB.get('drafts','current');if(!d?.state)return;
    openModal('Hai una bozza',`<p class="muted">È presente una composizione non conclusa.</p><div class="modal-buttons"><button class="secondary-button" id="discard-draft">Elimina</button><button class="big-button" id="resume-draft">Continua</button></div>`);
    $('#discard-draft').onclick=async()=>{await IADB.del('drafts','current');closeModal();};
    $('#resume-draft').onclick=async()=>{state=d.state;if(state.mode==='video'&&d.mediaBlob){videoBlob=d.mediaBlob;videoObjectUrl=URL.createObjectURL(videoBlob);await setupVideoFromUrl(videoObjectUrl);}closeModal();await enterEditor();};
  }
  // ---------- canvas ----------
  function originalPhotoSize(){
    let iw=1080,ih=1080;
    if(state.mode==='photo'&&bgImage){iw=bgImage.naturalWidth||bgImage.width||1080;ih=bgImage.naturalHeight||bgImage.height||1080;}
    if(state.mode==='video'&&videoEl){iw=videoEl.videoWidth||1080;ih=videoEl.videoHeight||1080;}
    const maxSide=1920, scale=Math.min(1,maxSide/Math.max(iw,ih));return {w:Math.max(1,Math.round(iw*scale)),h:Math.max(1,Math.round(ih*scale))};
  }
  function resizeCanvas(){
    if(state.format==='original'&&isMediaMode()){const f=originalPhotoSize();canvas.width=f.w;canvas.height=f.h;}
    else if(isMediaMode()&&(state.format==='ratio43'||state.format==='ratio169')){const portrait=mediaIsPortrait();if(state.format==='ratio43'){canvas.width=portrait?1080:1440;canvas.height=portrait?1440:1080;}else{canvas.width=portrait?1080:1920;canvas.height=portrait?1920:1080;}}
    else {const f=formats[state.format]||formats.square;canvas.width=f.w||1080;canvas.height=f.h||1080;}
    renderCanvas();
  }
  function photoFilterParams(name){
    if(name==='soft')return {exposure:.10,contrast:-.08,highlights:-.10,shadows:.16,temperature:.05,saturation:-.10,sharpness:.05,vignette:.02};
    if(name==='warm')return {exposure:.06,contrast:-.03,highlights:-.08,shadows:.12,temperature:.16,saturation:.02,sharpness:.04,vignette:.04};
    if(name==='neutral')return {exposure:.02,contrast:0,highlights:-.06,shadows:.08,temperature:0,saturation:-.12,sharpness:.03,vignette:0};
    return {exposure:0,contrast:0,highlights:0,shadows:0,temperature:0,saturation:0,sharpness:0,vignette:0};
  }
  function filteredPhoto(){
    if(!bgImage)return null;const a=state.adjustments||{},key=[state.bgDataUrl?.length||0,state.bgDataUrl?.slice(-48)||'',state.format,state.photoFit,state.photoZoom,state.photoX,state.photoY,state.filter,state.filterIntensity,...Object.values(a),canvas.width,canvas.height,compareOriginal].join('|');
    if(photoFilterCanvas&&photoFilterCacheKey===key)return photoFilterCanvas;
    const off=document.createElement('canvas');off.width=canvas.width;off.height=canvas.height;const oc=off.getContext('2d',{willReadFrequently:true});drawPhotoOn(oc,bgImage,off.width,off.height,state.photoZoom,state.photoX,state.photoY,state.photoFit);
    if(!compareOriginal)applyPixelLook(oc,off.width,off.height);
    photoFilterCanvas=off;photoFilterCacheKey=key;return off;
  }
  function renderCanvas(){
    const W=canvas.width,H=canvas.height;lastTextBounds=null;ctx.save();ctx.clearRect(0,0,W,H);ctx.fillStyle=C.cream;ctx.fillRect(0,0,W,H);
    if(state.mode==='photo'&&bgImage){const fp=filteredPhoto();if(fp)ctx.drawImage(fp,0,0,W,H);}
    else if(state.mode==='video'&&videoEl&&videoEl.readyState>=2){drawVideoLook(ctx,videoEl,W,H);}
    else drawTemplateBg(W,H);
    ctx.restore();drawOverlays(W,H);drawPhrase(W,H);if(state.signatureEnabled)drawSignature(W,H);
  }
  function drawPhotoOn(c,img,W,H,zoom=1,px=0,py=0,fit='cover'){const iw=img.naturalWidth||img.videoWidth||img.width||W,ih=img.naturalHeight||img.videoHeight||img.height||H;const base=fit==='contain'?Math.min(W/iw,H/ih):Math.max(W/iw,H/ih);const sc=base*zoom,dw=iw*sc,dh=ih*sc;const dx=Math.abs(W-dw),dy=Math.abs(H-dh);const x=(W-dw)/2+px*dx/2,y=(H-dh)/2+py*dy/2;c.drawImage(img,x,y,dw,dh);}
  function drawCoverOn(c,img,W,H,zoom=1,px=0,py=0){drawPhotoOn(c,img,W,H,zoom,px,py,'cover');}
  function drawCover(img,W,H,zoom=1,px=0,py=0){drawCoverOn(ctx,img,W,H,zoom,px,py);}
  function drawTemplateBg(W,H){ctx.fillStyle=C.cream;ctx.fillRect(0,0,W,H);const st=state.templateStyle;
    if(st==='editorial'){ctx.strokeStyle=C.beige;ctx.lineWidth=Math.max(2,W*.002);ctx.beginPath();ctx.moveTo(W*.15,H*.16);ctx.lineTo(W*.37,H*.16);ctx.moveTo(W*.63,H*.16);ctx.lineTo(W*.85,H*.16);ctx.stroke();ctx.fillStyle=C.orange;ctx.font=`${Math.round(W*.11)}px Georgia`;ctx.textAlign='center';ctx.fillText('“',W/2,H*.205);}
    if(st==='minimal'){ctx.strokeStyle='#eadfd5';ctx.lineWidth=Math.max(2,W*.0015);ctx.strokeRect(W*.065,H*.055,W*.87,H*.89);}
    if(st==='highlight'){ctx.fillStyle='#f8e7dc';ctx.fillRect(W*.09,H*.12,W*.82,H*.012);}
  }
  function fontFamily(key){return {editorial:'Georgia, serif',classic:'"Times New Roman", Times, serif',elegant:'Palatino, "Palatino Linotype", Georgia, serif',clean:'-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',modern:'Arial, Helvetica, sans-serif',handwritten:'"Snell Roundhand", "Brush Script MT", cursive'}[key]||'Georgia, serif';}
  function fontSpec(size,accent=false){const italic=(state.textItalic||accent)?'italic ':'';const weight=state.textWeight==='bold'?'700 ':'400 ';return `${italic}${weight}${size}px ${fontFamily(state.textFont)}`;}
  function drawPhrase(W,H){if(!state.phrase?.trim())return;
    const color=state.textColor|| (state.textTone==='light'?C.white:C.ink);const fontSize=Math.round(state.textSize*(W/1080));const baseMaxW=W*(state.textWidth||.78);let bg=false;
    if(isMediaMode()&&state.photoStyle==='thought')bg=true;
    const cx=W*(typeof state.textX==='number'?state.textX:.5), cy=H*(typeof state.textY==='number'?state.textY:(isMediaMode()?.22:.45));
    const align=state.textAlign||'center',margin=W*.04;let maxW=baseMaxW;if(align==='left')maxW=Math.max(W*.16,Math.min(baseMaxW,W-margin-cx));else if(align==='right')maxW=Math.max(W*.16,Math.min(baseMaxW,cx-margin));else maxW=Math.max(W*.22,Math.min(baseMaxW,2*Math.min(cx-margin,W-margin-cx)));
    if(bg){ctx.save();const boxW=Math.min(W*.9,maxW+W*.08),boxH=Math.min(H*.38,fontSize*5.4);ctx.fillStyle=(color||'').toUpperCase()==='#FFFFFF'?'rgba(33,17,13,.42)':'rgba(246,241,234,.80)';roundRect(ctx,Math.max(W*.025,cx-boxW/2),Math.max(H*.025,cy-boxH/2),boxW,boxH,30);ctx.fill();ctx.restore();}
    if((color||'').toUpperCase()==='#FFFFFF'){ctx.shadowColor='rgba(0,0,0,.34)';ctx.shadowBlur=12;ctx.shadowOffsetY=3;}
    const baseFont=fontSpec(fontSize,false), accentFont=fontSpec(fontSize,true);
    lastTextBounds=drawMixedBox(state.phrase,state.highlight,cx,cy,maxW,Math.round(fontSize*(state.textLineHeight||1.23)),baseFont,accentFont,color,C.orange,align,W);
    ctx.shadowColor='transparent';ctx.shadowBlur=0;ctx.shadowOffsetY=0;
  }
  function segmentTokens(text,highlight){
    const h=highlight?.trim();if(!h){return text.split(/(\s+)/).filter(Boolean).map(t=>({t,accent:false}));}
    const idx=text.toLowerCase().indexOf(h.toLowerCase());if(idx<0)return text.split(/(\s+)/).filter(Boolean).map(t=>({t,accent:false}));
    const parts=[{s:text.slice(0,idx),a:false},{s:text.slice(idx,idx+h.length),a:true},{s:text.slice(idx+h.length),a:false}];
    return parts.flatMap(p=>p.s.split(/(\s+)/).filter(Boolean).map(t=>({t,accent:p.a})));
  }
  function drawMixedBox(text,highlight,cx,cy,maxWidth,lineH,baseFont,accentFont,baseColor,accentColor,align='center',W=1080){
    const tokens=segmentTokens(text,highlight),lines=[];let line=[],w=0;
    for(const tok of tokens){ctx.font=tok.accent?accentFont:baseFont;const tw=ctx.measureText(tok.t).width;if(w+tw>maxWidth&&line.length&&!/^\s+$/.test(tok.t)){lines.push(line);line=[];w=0;}line.push({...tok,w:tw});w+=tw;}
    if(line.length)lines.push(line);const total=lines.length*lineH;let y=cy-total/2+lineH*.78;
    const left=align==='left'?cx:align==='right'?cx-maxWidth:cx-maxWidth/2,right=align==='right'?cx:align==='left'?cx+maxWidth:cx+maxWidth/2,boxCenter=cx;
    for(const ln of lines){const lw=ln.reduce((a,b)=>a+b.w,0);let x=align==='left'?left:align==='right'?right-lw:boxCenter-lw/2;for(const tok of ln){ctx.font=tok.accent?accentFont:baseFont;ctx.fillStyle=tok.accent?accentColor:baseColor;ctx.textAlign='left';ctx.fillText(tok.t,x,y);x+=tok.w;}y+=lineH;}
    const bx=align==='left'?left:align==='right'?right-maxWidth:boxCenter-maxWidth/2;return {x:bx,y:cy-total/2-lineH*.12,w:maxWidth,h:Math.max(lineH,total+lineH*.25)};
  }
  function drawSignature(W,H){if(!signatureImage)return;const base=state.mode==='template'?.48:.42;const w=W*base*(state.signatureSize/100),h=w*(signatureImage.height/signatureImage.width);let x=W/2-w/2;if(state.signaturePosition==='left')x=W*.055;if(state.signaturePosition==='right')x=W*.945-w;const bottom=H*(typeof state.signatureY==='number'?state.signatureY:.94),y=Math.max(H*.04,Math.min(H-h-H*.02,bottom-h));ctx.drawImage(signatureImage,x,y,w,h);}
  function drawOverlays(W,H){for(const o of state.overlays){const img=imageCache.get(o.id);if(!img)continue;const x=o.x*W,y=o.y*H,w=o.w*W,h=o.h*H;ctx.save();ctx.translate(x,y);ctx.rotate((o.rotation||0)*Math.PI/180);ctx.globalAlpha=o.opacity??1;ctx.drawImage(img,-w/2,-h/2,w,h);if(o.id===state.selectedOverlayId){ctx.globalAlpha=1;ctx.strokeStyle=C.orange;ctx.lineWidth=Math.max(3,W*.003);ctx.setLineDash([14,9]);ctx.strokeRect(-w/2,-h/2,w,h);ctx.setLineDash([]);}ctx.restore();}}
  function roundRect(c,x,y,w,h,r){c.beginPath();c.roundRect?c.roundRect(x,y,w,h,r):(c.rect(x,y,w,h));}

  // ---------- overlays ----------
  async function handleOverlayFile(e){const f=e.target.files?.[0];if(!f)return;if(state.overlays.length>=5){toast('Puoi aggiungere massimo 5 elementi.');return;}const src=await fileToDataURL(f);await addOverlay(src,f.name,'image');e.target.value='';}
  async function addOverlay(src,title,type='image'){const img=await loadImage(src);const id=uid('ov'),aspect=img.width/img.height;const w=.32,h=w/aspect;state.overlays.push({id,type,title,x:.5,y:.5,w,h,rotation:0,opacity:1,src});imageCache.set(id,img);state.selectedOverlayId=id;renderLayerControls();renderSelectionToolbar();changed();openTool(type==='sticker'?'sticker':'media');}
  function pointerDown(e){const p=canvasPoint(e);const hit=[...state.overlays].reverse().find(o=>hitOverlay(p,o));if(hit){state.selectedOverlayId=hit.id;drag={type:'overlay',id:hit.id,dx:p.x-hit.x*canvas.width,dy:p.y-hit.y*canvas.height};canvas.setPointerCapture?.(e.pointerId);renderLayerControls();renderSelectionToolbar();renderCanvas();return;}
    state.selectedOverlayId=null;renderLayerControls();renderSelectionToolbar();
    if(activeTool==='text'&&lastTextBounds&&p.x>=lastTextBounds.x&&p.x<=lastTextBounds.x+lastTextBounds.w&&p.y>=lastTextBounds.y&&p.y<=lastTextBounds.y+lastTextBounds.h){drag={type:'text',dx:p.x-state.textX*canvas.width,dy:p.y-state.textY*canvas.height};canvas.setPointerCapture?.(e.pointerId);return;}
    if(activeTool==='media'&&isMediaMode()&&((state.mode==='photo'&&bgImage)||(state.mode==='video'&&videoEl))){drag={type:'photo',lastX:p.x,lastY:p.y};canvas.setPointerCapture?.(e.pointerId);return;}
    renderCanvas();}
  function pointerMove(e){if(!drag)return;const p=canvasPoint(e);
    if(drag.type==='overlay'){const o=state.overlays.find(x=>x.id===drag.id);if(!o)return;o.x=Math.max(0,Math.min(1,(p.x-drag.dx)/canvas.width));o.y=Math.max(0,Math.min(1,(p.y-drag.dy)/canvas.height));changed(false);return;}
    if(drag.type==='text'){state.textX=Math.max(.02,Math.min(.98,(p.x-drag.dx)/canvas.width));state.textY=Math.max(.03,Math.min(.97,(p.y-drag.dy)/canvas.height));$('#text-x').value=Math.round(state.textX*100);$('#text-x').nextElementSibling.value=Math.round(state.textX*100)+'%';$('#text-y').value=Math.round(state.textY*100);$('#text-y').nextElementSibling.value=Math.round(state.textY*100)+'%';changed(false);return;}
    if(drag.type==='photo'){const dx=p.x-drag.lastX,dy=p.y-drag.lastY;state.photoX=Math.max(-1,Math.min(1,state.photoX+dx/(canvas.width*.45)));state.photoY=Math.max(-1,Math.min(1,state.photoY+dy/(canvas.height*.45)));drag.lastX=p.x;drag.lastY=p.y;$('#photo-x').value=state.photoX;$('#photo-x').nextElementSibling.value=Math.round(state.photoX*100);$('#photo-y').value=state.photoY;$('#photo-y').nextElementSibling.value=Math.round(state.photoY*100);changed(false);}
  }
  function pointerUp(){if(drag){drag=null;scheduleDraft();}}
  function canvasPoint(e){const r=canvas.getBoundingClientRect();return{x:(e.clientX-r.left)*(canvas.width/r.width),y:(e.clientY-r.top)*(canvas.height/r.height)}}
  function hitOverlay(p,o){const w=o.w*canvas.width,h=o.h*canvas.height,x=o.x*canvas.width,y=o.y*canvas.height;return p.x>x-w/2&&p.x<x+w/2&&p.y>y-h/2&&p.y<y+h/2;}
  function deleteSelectedOverlay(){
    const o=state.overlays.find(x=>x.id===state.selectedOverlayId);if(!o)return;
    state.overlays=state.overlays.filter(x=>x.id!==o.id);imageCache.delete(o.id);state.selectedOverlayId=null;renderLayerControls();renderSelectionToolbar();changed();toast('Elemento rimosso.');
  }
  function renderSelectionToolbar(){
    const bar=$('#selection-toolbar'),o=state.overlays.find(x=>x.id===state.selectedOverlayId);if(!bar)return;
    bar.classList.toggle('hidden',!o);if(!o)return;$('#selection-label').textContent=o.type==='sticker'?'Sticker selezionato':'Immagine selezionata';
  }
  function layerControlsHtml(o){return `<div class="layer-card"><b>${escapeHtml(o.title||'Elemento')}</b><button data-layer="delete">⌫ Elimina</button></div><label class="range-row">Dimensione <input data-layer="size" type="range" min="8" max="85" value="${Math.round(o.w*100)}"><output>${Math.round(o.w*100)}%</output></label><label class="range-row">Rotazione <input data-layer="rotate" type="range" min="-180" max="180" value="${o.rotation||0}"><output>${o.rotation||0}°</output></label><label class="range-row">Opacità <input data-layer="opacity" type="range" min="10" max="100" value="${Math.round((o.opacity??1)*100)}"><output>${Math.round((o.opacity??1)*100)}%</output></label><button class="secondary-button" data-layer="back">Porta dietro</button><button class="secondary-button" data-layer="front">Porta avanti</button><button class="secondary-button" data-layer="dup">Duplica</button>`;}
  function wireLayerControls(box,o){
    const size=box.querySelector('[data-layer=size]'),rot=box.querySelector('[data-layer=rotate]'),op=box.querySelector('[data-layer=opacity]');
    size.oninput=e=>{const img=imageCache.get(o.id),aspect=(img?.width||1)/(img?.height||1);o.w=+e.target.value/100;o.h=o.w/aspect;e.target.nextElementSibling.value=e.target.value+'%';changed(false);};
    rot.oninput=e=>{o.rotation=+e.target.value;e.target.nextElementSibling.value=e.target.value+'°';changed(false);};
    op.oninput=e=>{o.opacity=+e.target.value/100;e.target.nextElementSibling.value=e.target.value+'%';changed(false);};
    box.querySelector('[data-layer=delete]').onclick=deleteSelectedOverlay;
    box.querySelector('[data-layer=front]').onclick=()=>{state.overlays=state.overlays.filter(x=>x.id!==o.id).concat(o);changed();};
    box.querySelector('[data-layer=back]').onclick=()=>{state.overlays=[o,...state.overlays.filter(x=>x.id!==o.id)];changed();};
    box.querySelector('[data-layer=dup]').onclick=()=>{if(state.overlays.length>=5)return toast('Massimo 5 elementi.');const copy={...deepClone(o),id:uid('ov'),x:Math.min(.9,o.x+.05),y:Math.min(.9,o.y+.05)};state.overlays.push(copy);imageCache.set(copy.id,imageCache.get(o.id));state.selectedOverlayId=copy.id;renderLayerControls();renderSelectionToolbar();changed();};
  }
  function renderLayerControls(){
    const o=state.overlays.find(x=>x.id===state.selectedOverlayId),imageBox=$('#layer-controls'),stickerBox=$('#sticker-layer-controls');
    [imageBox,stickerBox].filter(Boolean).forEach(box=>{box.className='layer-controls empty-state';box.innerHTML=box===stickerBox?'Tocca uno sticker inserito per regolarlo o eliminarlo.':'Nessun elemento selezionato.';});
    if(!o)return;const target=o.type==='sticker'?(stickerBox||imageBox):imageBox;if(!target)return;target.className='layer-controls';target.innerHTML=layerControlsHtml(o);wireLayerControls(target,o);
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
      if(phrasePickerMode){state.phrase=ph.text;state.phraseId=ph.id;if(isMediaMode()&&state.photoStyle==='clean')state.photoStyle='short';phrasePickerMode=false;showScreen('editor',false);populateStyleOptions();syncEditorControls();renderCanvas();scheduleDraft();}
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
  async function renderStickers(){
    const all=(await IADB.getAll('stickers')).filter(x=>x.active!==false);const cats=[...new Set(all.map(x=>x.category).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'it'));const styles=[...new Set(all.map(x=>x.style).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'it'));
    const chips=$('#sticker-category-chips');if(chips){chips.innerHTML=`<button data-cat="all" class="${stickerView.category==='all'?'selected':''}">Tutti</button>`+cats.map(c=>`<button data-cat="${escapeAttr(c)}" class="${stickerView.category===c?'selected':''}">${escapeHtml(c)}</button>`).join('');chips.onclick=e=>{const b=e.target.closest('[data-cat]');if(!b)return;stickerView.category=b.dataset.cat;renderStickers();};}
    const schips=$('#sticker-style-chips');if(schips){schips.innerHTML=`<button data-style="all" class="${stickerView.style==='all'?'selected':''}">Tutti gli stili</button>`+styles.map(s=>`<button data-style="${escapeAttr(s)}" class="${stickerView.style===s?'selected':''}">${escapeHtml(s)}</button>`).join('');schips.onclick=e=>{const b=e.target.closest('[data-style]');if(!b)return;stickerView.style=b.dataset.style;renderStickers();};}
    const q=normalize(stickerView.search);let arr=all;if(stickerView.category!=='all')arr=arr.filter(x=>x.category===stickerView.category);if(stickerView.style!=='all')arr=arr.filter(x=>x.style===stickerView.style);if(stickerView.favorites)arr=arr.filter(x=>x.favorite);if(q)arr=arr.filter(x=>normalize(x.title+' '+x.category+' '+x.style+' '+(x.tags||[]).join(' ')).includes(q));
    const box=$('#sticker-grid');if(!box)return;if(!arr.length){box.innerHTML='<div class="empty-state" style="grid-column:1/-1">Nessuno sticker trovato.</div>';return;}box.innerHTML=arr.map(s=>`<div class="sticker-card" data-id="${escapeAttr(s.id)}"><div class="sticker-visual"><img loading="lazy" src="${escapeAttr(s.src)}" alt="${escapeAttr(s.title)}"></div><button class="fav" data-act="fav">${s.favorite?'♥':'♡'}</button><div class="title">${escapeHtml(s.title)}</div></div>`).join('');box.onclick=async e=>{const card=e.target.closest('.sticker-card');if(!card)return;const s=all.find(x=>x.id===card.dataset.id);if(e.target.closest('[data-act=fav]')){s.favorite=!s.favorite;s.updatedAt=nowISO();await IADB.put('stickers',s);renderStickers();renderEditorStickerGrid();return;}if(stickerPickerMode){stickerPickerMode=false;await addOverlay(s.src,s.title,'sticker');showScreen('editor',false);openTool('sticker');}else openStickerDetail(s);};
  }
  async function renderEditorStickerGrid(){const all=await IADB.getAll('stickers');const cats=[...new Set(all.map(x=>x.category))].sort();const chip=$('#editor-sticker-cats');if(!chip)return;let cat=chip.dataset.cat||'all';chip.innerHTML=`<button data-cat="all" class="${cat==='all'?'selected':''}">Tutti</button>`+cats.slice(0,8).map(c=>`<button data-cat="${escapeAttr(c)}" class="${cat===c?'selected':''}">${escapeHtml(c)}</button>`).join('');chip.onclick=e=>{const b=e.target.closest('button[data-cat]');if(!b)return;chip.dataset.cat=b.dataset.cat;renderEditorStickerGrid();};let arr=all.filter(x=>x.active!==false);if(cat!=='all')arr=arr.filter(x=>x.category===cat);arr=arr.slice(0,16);const grid=$('#editor-sticker-grid');grid.innerHTML=arr.map(s=>`<button class="sticker-card" data-id="${escapeAttr(s.id)}"><div class="sticker-visual"><img src="${escapeAttr(s.src)}" alt=""></div><div class="title">${escapeHtml(s.title)}</div></button>`).join('');grid.onclick=async e=>{const c=e.target.closest('.sticker-card');if(!c)return;const s=all.find(x=>x.id===c.dataset.id);await addOverlay(s.src,s.title,'sticker');};}
  function openStickerDetail(s){openModal(s.title,`<div style="text-align:center"><img src="${escapeAttr(s.src)}" style="max-width:260px;max-height:260px;object-fit:contain"><p class="muted">${escapeHtml(s.category)} · ${escapeHtml(s.style||'')}</p></div><div class="modal-buttons"><button class="secondary-button" id="stk-fav">${s.favorite?'Togli preferito':'Preferito'}</button><button class="secondary-button" id="stk-delete">Elimina</button></div>`);$('#stk-fav').onclick=async()=>{s.favorite=!s.favorite;await IADB.put('stickers',s);closeModal();renderStickers();renderEditorStickerGrid();};$('#stk-delete').onclick=async()=>{if(confirm('Eliminare questo sticker dalla libreria?')){await IADB.del('stickers',s.id);closeModal();renderStickers();renderEditorStickerGrid();refreshHome();}};}
  async function handleNewStickerFile(e){const f=e.target.files?.[0];if(!f)return;const src=await fileToDataURL(f);openModal('Nuovo sticker',`<div style="text-align:center"><img src="${escapeAttr(src)}" style="max-width:220px;max-height:220px;object-fit:contain"></div><div class="form-stack"><label>Nome<input class="field" id="ns-title" value="${escapeAttr(f.name.replace(/\.[^.]+$/,''))}"></label><label>Categoria<input class="field" id="ns-cat" value="Lifestyle"></label><label>Tag<input class="field" id="ns-tags"></label><label class="checkbox-row"><input id="ns-fav" type="checkbox"> Preferito</label></div><div class="modal-buttons"><button class="secondary-button" id="ns-cancel">Annulla</button><button class="big-button" id="ns-save">Salva</button></div>`);$('#ns-cancel').onclick=closeModal;$('#ns-save').onclick=async()=>{const rec={id:uid('stk'),title:$('#ns-title').value.trim()||'Sticker',category:$('#ns-cat').value.trim()||'Importati',style:'custom',tags:$('#ns-tags').value.split(',').map(x=>x.trim()).filter(Boolean),favorite:$('#ns-fav').checked,active:true,src,sourceType:'custom',source:'manuale',createdAt:nowISO(),updatedAt:nowISO()};await IADB.put('stickers',rec);closeModal();renderStickers();renderEditorStickerGrid();refreshHome();toast('Sticker aggiunto.');};e.target.value='';}
  async function importStickerZip(e){const f=e.target.files?.[0];if(!f)return;try{toast('Sto leggendo il pacchetto…');const zip=await IAZip.read(f);const keys=[...zip.keys()];const manifestKey=keys.find(k=>k.toLowerCase().endsWith('manifest.json'));let recs=[];if(manifestKey){const m=JSON.parse(IAZip.text(zip.get(manifestKey)));for(const s of m.stickers||[]){const imgKey=keys.find(k=>k.endsWith('/'+s.file)||k.endsWith(s.file));if(!imgKey)continue;recs.push({id:uid('stk'),title:s.title||fileTitle(imgKey),category:s.category||'Importati',style:s.style||'pack',tags:s.tags||[],favorite:false,active:s.active!==false,src:IAZip.dataUrl(zip.get(imgKey),IAZip.mimeFor(imgKey)),sourceType:'custom',source:f.name,createdAt:nowISO(),updatedAt:nowISO()});}}else{for(const k of keys.filter(k=>/\.(png|webp|jpe?g)$/i.test(k))){recs.push({id:uid('stk'),title:fileTitle(k),category:'Importati',style:'pack',tags:[],favorite:false,active:true,src:IAZip.dataUrl(zip.get(k),IAZip.mimeFor(k)),sourceType:'custom',source:f.name,createdAt:nowISO(),updatedAt:nowISO()});}}
      const existing=new Set((await IADB.getAll('stickers')).map(x=>`${normalize(x.title)}|${x.style||''}`));recs=recs.filter(x=>!existing.has(`${normalize(x.title)}|${x.style||''}`));if(recs.length)await IADB.bulkPut('stickers',recs);toast(`${recs.length} sticker importati.`);await renderStickers();await renderEditorStickerGrid();await refreshHome();}catch(err){toast('ZIP non importato: '+err.message);}e.target.value='';}

  // ---------- projects ----------
  async function saveProject(){
    renderCanvas();const preview=canvas.toDataURL('image/jpeg',.72);const old=state.projectId?await IADB.get('projects',state.projectId):null;const rec={id:state.projectId||uid('prj'),title:projectTitle(),state:deepClone(state),preview,mediaBlob:state.mode==='video'?videoBlob:(old?.mediaBlob||null),createdAt:old?.createdAt||nowISO(),updatedAt:nowISO()};rec.state.projectId=rec.id;state.projectId=rec.id;await IADB.put('projects',rec);await IADB.del('drafts','current');toast('Progetto salvato.');await refreshHome();await renderProjects();scheduleDraft();
  }
  async function renderProjects(){
    const all=(await IADB.getAll('projects')).sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||''));const box=$('#projects-list');if(!box)return;if(!all.length){box.innerHTML='<div class="empty-state" style="grid-column:1/-1">Nessun progetto salvato.</div>';return;}box.innerHTML=all.map(p=>`<article class="project-card" data-id="${escapeAttr(p.id)}"><img src="${escapeAttr(p.preview)}" alt=""><div class="project-card-info"><strong>${escapeHtml(p.title)}</strong><small>${formatDate(p.updatedAt)}</small></div><div class="project-actions"><button data-act="open">Apri</button><button data-act="dup">Duplica</button><button data-act="export">Esporta</button><button data-act="delete">Elimina</button></div></article>`).join('');box.onclick=async e=>{const card=e.target.closest('.project-card');if(!card)return;const act=e.target.closest('button')?.dataset.act;if(!act)return;const p=all.find(x=>x.id===card.dataset.id);if(act==='open'){await loadProjectRecord(p);}if(act==='dup'){const cp={...p,id:uid('prj'),title:p.title+' copia',state:deepClone(p.state),createdAt:nowISO(),updatedAt:nowISO()};cp.state.projectId=cp.id;await IADB.put('projects',cp);renderProjects();refreshHome();toast('Progetto duplicato.');}if(act==='delete'&&confirm('Eliminare questo progetto?')){await IADB.del('projects',p.id);renderProjects();refreshHome();}if(act==='export'){await loadProjectRecord(p);await exportDesign();}};
  }
  function projectTitle(){const label=(formats[state.format]||formats.square).label;return `${state.mode==='template'?'Template':state.mode==='video'?'Video':'Foto'} · ${label}`;}
  // ---------- preview/export ----------
  function openPreview(){renderCanvas();const img=document.createElement('img');img.src=canvas.toDataURL('image/png');img.style.maxWidth='94vw';img.style.maxHeight='70dvh';img.style.objectFit='contain';const wrap=$('#preview-canvas-wrap');wrap.innerHTML='';wrap.appendChild(img);$('#preview-export').textContent=state.mode==='video'?'Esporta video':'Salva immagine';$('#preview-overlay').classList.add('open');}
  function closePreview(){$('#preview-overlay').classList.remove('open');}
  async function exportDesign(){
    try{
      if(state.mode==='video')return await exportVideo();
      renderCanvas();await markPhraseUsed();const isTemplate=state.mode==='template';const mime=isTemplate?'image/png':'image/jpeg',ext=isTemplate?'png':'jpg';const blob=await new Promise(r=>canvas.toBlob(r,mime,isTemplate?1:.94));const file=new File([blob],`IA_${state.format}_${new Date().toISOString().slice(0,10)}_${String(Date.now()).slice(-5)}.${ext}`,{type:mime});closePreview();await IADB.del('drafts','current');await renderPhrases();await refreshHome();if(navigator.canShare?.({files:[file]})){await navigator.share({files:[file],title:'Ironicamente Acida'});}else downloadBlob(blob,file.name);showDoneModal(false);
    }catch(err){if(err?.name!=='AbortError')toast('Salvataggio non riuscito: '+err.message);}
  }
  // ---------- backup ----------
  async function backup(full){const data={app:'Ironicamente Acida',version:'2.0-editor',exportedAt:nowISO(),type:full?'full':'content',phrases:await IADB.getAll('phrases'),stickers:await IADB.getAll('stickers'),meta:{default_filter:defaults.filter,default_format:defaults.format}};if(full)data.projects=await IADB.getAll('projects');const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});downloadBlob(blob,`IA_backup_${full?'completo':'contenuti'}_${new Date().toISOString().slice(0,10)}.json`);toast('Backup creato.');}
  async function restoreBackup(e){const f=e.target.files?.[0];if(!f)return;try{const d=JSON.parse(await f.text());if(d.phrases?.length)await IADB.bulkPut('phrases',d.phrases);if(d.stickers?.length)await IADB.bulkPut('stickers',d.stickers);if(d.projects?.length)await IADB.bulkPut('projects',d.projects);if(d.meta?.default_filter){defaults.filter=d.meta.default_filter;await IADB.metaSet('default_filter',defaults.filter);}if(d.meta?.default_format){defaults.format=d.meta.default_format;await IADB.metaSet('default_format',defaults.format);}await refreshAll();await loadSettingsUI();toast('Backup ripristinato.');}catch(err){toast('Backup non valido: '+err.message);}e.target.value='';}

  // ---------- dashboards ----------
  async function refreshHome(){const phrases=await IADB.getAll('phrases'),stickers=await IADB.getAll('stickers'),projects=(await IADB.getAll('projects')).sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||''));const avail=phrases.filter(x=>!x.used&&x.active!==false).length;$('#home-phrases-count').textContent=`${avail} disponibili`;$('#home-stickers-count').textContent=`${stickers.filter(x=>x.active!==false).length} elementi`;$('#home-projects-count').textContent=`${projects.length} salvati`;const recent=$('#home-recent');if(!projects.length){recent.classList.remove('empty-state');recent.innerHTML=`<div class="project-thumb starter"><img src="./home-portrait.webp" alt=""><small>Portrait mood</small></div><div class="project-thumb starter"><img src="./travel-suitcase.webp" alt=""><small>Travel notes</small></div><div class="project-thumb starter"><img src="./card-template.webp" alt=""><small>Reading mood</small></div>`;}else{recent.classList.remove('empty-state');recent.innerHTML=projects.slice(0,3).map(p=>`<button class="project-thumb" data-id="${escapeAttr(p.id)}"><img src="${escapeAttr(p.preview)}" alt=""><small>${formatDate(p.updatedAt)}</small></button>`).join('');recent.onclick=async e=>{const b=e.target.closest('[data-id]');if(!b)return;const p=projects.find(x=>x.id===b.dataset.id);await loadProjectRecord(p);};}
    const counts={};Object.keys(categoryLabels).forEach(c=>counts[c]=0);phrases.filter(x=>!x.used&&x.active!==false).forEach(x=>counts[x.category]=(counts[x.category]||0)+1);const low=Object.entries(counts).filter(([,n])=>n<10);$('#low-phrase-alerts').innerHTML=low.map(([c,n])=>`<div class="warning-card"><strong>${escapeHtml(categoryLabels[c]||c)} sta finendo</strong>Restano ${n} frasi non utilizzate.</div>`).join('');
  }
  async function updateStats(){const [p,s,pr]=await Promise.all([IADB.getAll('phrases'),IADB.getAll('stickers'),IADB.getAll('projects')]);$('#stats-phrases').textContent=p.length;$('#stats-stickers').textContent=s.length;$('#stats-projects').textContent=pr.length;}
  async function loadSettingsUI(){if(!['original','ratio43','ratio169','square'].includes(defaults.format)){defaults.format='original';await IADB.metaSet('default_format','original');}$('#default-filter').value=defaults.filter;$('#default-format').value=defaults.format;}

  // ---------- V2 media helpers ----------
  function isMediaMode(){return state.mode==='photo'||state.mode==='video';}
  function mediaIsPortrait(){if(state.mode==='photo'&&bgImage)return (bgImage.naturalHeight||bgImage.height)>=(bgImage.naturalWidth||bgImage.width);if(state.mode==='video'&&videoEl)return (videoEl.videoHeight||1)>=(videoEl.videoWidth||1);return true;}
  function syncAdjustmentControls(){const a=state.adjustments||{};['exposure','contrast','highlights','shadows','temperature','saturation','sharpness','vignette'].forEach(k=>{const el=$('#adj-'+k);if(!el)return;el.value=a[k]||0;el.nextElementSibling.value=a[k]||0;});}
  function updateEditorStatus(){const mode=state.mode==='video'?'Video':state.mode==='photo'?'Foto':'Template';const look={soft:'Acida Soft',warm:'Acida Warm',neutral:'Neutro',original:'Originale'}[state.filter]||state.filter;const fmt=(formats[state.format]||formats.square).label;const el=$('#editor-status');if(el)el.textContent=`${mode} · ${look} · ${fmt}`;}
  function formatTime(sec=0){sec=Math.max(0,Number(sec)||0);const m=Math.floor(sec/60),s=Math.floor(sec%60);return `${m}:${String(s).padStart(2,'0')}`;}
  function presetMix(){const p=photoFilterParams(compareOriginal?'original':state.filter),t=compareOriginal?0:(state.filterIntensity||0)/100,a=state.adjustments||{};return {exposure:p.exposure*t+(a.exposure||0)/100*.75,contrast:p.contrast*t+(a.contrast||0)/100*.65,highlights:p.highlights*t+(a.highlights||0)/100*.8,shadows:p.shadows*t+(a.shadows||0)/100*.8,temperature:p.temperature*t+(a.temperature||0)/100*.35,saturation:p.saturation*t+(a.saturation||0)/100*.8,sharpness:p.sharpness*t+(a.sharpness||0)/100*.5,vignette:Math.max(0,p.vignette*t+(a.vignette||0)/100*.65)};}
  function applyPixelLook(c,W,H){const m=presetMix();if(Object.values(m).every(v=>Math.abs(v)<.001))return;const img=c.getImageData(0,0,W,H),d=img.data,ex=Math.pow(2,m.exposure),ct=1+m.contrast,sat=1+m.saturation,temp=m.temperature*42;for(let i=0;i<d.length;i+=4){let r=d[i],g=d[i+1],b=d[i+2];r*=ex;g*=ex;b*=ex;r=(r-128)*ct+128;g=(g-128)*ct+128;b=(b-128)*ct+128;const lum=.299*r+.587*g+.114*b;const hi=Math.max(0,(lum-128)/127),sh=Math.max(0,(128-lum)/128);const hiAdj=m.highlights*hi*55,shAdj=m.shadows*sh*55;r+=hiAdj+shAdj+temp;g+=hiAdj+shAdj+temp*.18;b+=hiAdj+shAdj-temp;const gray=.299*r+.587*g+.114*b;r=gray+(r-gray)*sat;g=gray+(g-gray)*sat;b=gray+(b-gray)*sat;const sharp=1+m.sharpness*.18;r=(r-128)*sharp+128;g=(g-128)*sharp+128;b=(b-128)*sharp+128;d[i]=Math.max(0,Math.min(255,r));d[i+1]=Math.max(0,Math.min(255,g));d[i+2]=Math.max(0,Math.min(255,b));}c.putImageData(img,0,0);if(m.vignette>0){const gr=c.createRadialGradient(W/2,H/2,Math.min(W,H)*.18,W/2,H/2,Math.max(W,H)*.72);gr.addColorStop(0,'rgba(0,0,0,0)');gr.addColorStop(1,`rgba(25,12,8,${Math.min(.6,m.vignette)})`);c.fillStyle=gr;c.fillRect(0,0,W,H);}}
  function drawVideoLook(c,v,W,H){const m=presetMix();c.save();const br=Math.max(.5,1+m.exposure*.75),con=Math.max(.55,1+m.contrast),sat=Math.max(0,1+m.saturation);c.filter=`brightness(${br}) contrast(${con}) saturate(${sat})`;drawPhotoOn(c,v,W,H,state.photoZoom,state.photoX,state.photoY,state.photoFit);c.filter='none';if(Math.abs(m.temperature)>.002){c.globalCompositeOperation='soft-light';c.fillStyle=m.temperature>0?`rgba(255,137,71,${Math.min(.24,Math.abs(m.temperature)*.5)})`:`rgba(68,130,255,${Math.min(.18,Math.abs(m.temperature)*.45)})`;c.fillRect(0,0,W,H);c.globalCompositeOperation='source-over';}if(m.shadows>0){c.fillStyle=`rgba(255,245,235,${Math.min(.13,m.shadows*.18)})`;c.fillRect(0,0,W,H);}if(m.vignette>0){const gr=c.createRadialGradient(W/2,H/2,Math.min(W,H)*.2,W/2,H/2,Math.max(W,H)*.72);gr.addColorStop(0,'rgba(0,0,0,0)');gr.addColorStop(1,`rgba(25,12,8,${Math.min(.55,m.vignette)})`);c.fillStyle=gr;c.fillRect(0,0,W,H);}c.restore();}
  async function setupVideoFromUrl(url,{timeoutMs=15000}={}){
    if(!videoEl)videoEl=$('#source-video');
    videoEl.pause();
    videoEl.playsInline=true;
    videoEl.setAttribute('playsinline','');
    videoEl.preload='auto';
    videoEl.muted=state.videoMuted;
    try{videoEl.removeAttribute('src');videoEl.load();}catch(_e){}
    videoEl.src=url;
    await new Promise((res,rej)=>{
      let settled=false;
      const finish=(fn,val)=>{if(settled)return;settled=true;cleanup();fn(val);};
      const ok=()=>finish(res);
      const bad=()=>finish(rej,new Error('Il browser non riesce a leggere questo formato video.'));
      const cleanup=()=>{
        clearTimeout(timer);
        videoEl.removeEventListener('loadedmetadata',ok);
        videoEl.removeEventListener('loadeddata',ok);
        videoEl.removeEventListener('canplay',ok);
        videoEl.removeEventListener('error',bad);
      };
      videoEl.addEventListener('loadedmetadata',ok);
      videoEl.addEventListener('loadeddata',ok);
      videoEl.addEventListener('canplay',ok);
      videoEl.addEventListener('error',bad);
      const timer=setTimeout(()=>{
        if(videoEl.readyState>=1&&Number.isFinite(videoEl.duration))finish(res);
        else finish(rej,new Error('Il caricamento del video ha impiegato troppo tempo.'));
      },timeoutMs);
      try{videoEl.load();}catch(err){finish(rej,err);}
      if(videoEl.readyState>=1&&Number.isFinite(videoEl.duration))finish(res);
    });
    const duration=Number.isFinite(videoEl.duration)?videoEl.duration:0;
    if(!(duration>0))throw new Error('Durata del video non disponibile.');
    state.videoDuration=duration;
    if(state.videoTrimEnd==null||state.videoTrimEnd>duration)state.videoTrimEnd=duration;
    const first=Math.min(Math.max(0,state.videoTrimStart||0),Math.max(0,duration-.05));
    try{videoEl.currentTime=first;}catch(_e){}
    const paintFirstFrame=()=>{if(state.mode==='video')renderCanvas();};
    if(videoEl.readyState>=2)requestAnimationFrame(paintFirstFrame);
    else videoEl.addEventListener('loadeddata',paintFirstFrame,{once:true});
    videoEl.ontimeupdate=()=>{if(state.mode!=='video')return;$('#video-scrub').value=videoEl.currentTime;$('#video-time').textContent=formatTime(videoEl.currentTime);if(!videoEl.paused&&state.videoTrimEnd!=null&&videoEl.currentTime>=state.videoTrimEnd){videoEl.pause();videoEl.currentTime=state.videoTrimStart||0;}renderCanvas();};
    videoEl.onplay=()=>{$('#video-play').textContent='❚❚';};
    videoEl.onpause=()=>{$('#video-play').textContent='▶';};
  }
  function cleanupVideo(){if(videoEl){videoEl.pause();videoEl.removeAttribute('src');videoEl.load();}if(videoObjectUrl){URL.revokeObjectURL(videoObjectUrl);videoObjectUrl=null;}videoBlob=null;if(videoFrameHandle){cancelAnimationFrame(videoFrameHandle);videoFrameHandle=null;}}
  function startVideoFrameLoop(){if(videoFrameHandle)cancelAnimationFrame(videoFrameHandle);const tick=()=>{if(state.mode==='video'&&videoEl){if(!videoEl.paused)renderCanvas();videoFrameHandle=requestAnimationFrame(tick);}else videoFrameHandle=null;};videoFrameHandle=requestAnimationFrame(tick);}
  async function toggleVideoPlayback(){if(!videoEl)return;if(videoEl.paused){if(videoEl.currentTime<(state.videoTrimStart||0)||videoEl.currentTime>=(state.videoTrimEnd??state.videoDuration))videoEl.currentTime=state.videoTrimStart||0;await videoEl.play();}else videoEl.pause();}
  function stateSnapshot(){const s=deepClone(state);return s;}
  function initHistory(){historyStack=[stateSnapshot()];redoStack=[];updateHistoryButtons();}
  function commitHistorySoon(){clearTimeout(historyTimer);historyTimer=setTimeout(()=>{const snap=stateSnapshot(),last=historyStack[historyStack.length-1];if(JSON.stringify(last)!==JSON.stringify(snap)){historyStack.push(snap);if(historyStack.length>40)historyStack.shift();redoStack=[];updateHistoryButtons();}},280);}
  function updateHistoryButtons(){const u=$('#editor-undo'),r=$('#editor-redo');if(u)u.disabled=historyStack.length<=1;if(r)r.disabled=!redoStack.length;}
  async function undoState(){if(historyStack.length<=1)return;redoStack.push(historyStack.pop());state=deepClone(historyStack[historyStack.length-1]);ensureStateDefaults();syncEditorControls();resizeCanvas();renderCanvas();updateHistoryButtons();}
  async function redoState(){if(!redoStack.length)return;const s=redoStack.pop();historyStack.push(deepClone(s));state=deepClone(s);ensureStateDefaults();syncEditorControls();resizeCanvas();renderCanvas();updateHistoryButtons();}
  async function loadProjectRecord(p){cleanupVideo();state=deepClone(p.state);state.projectId=p.id;if(state.mode==='video'&&p.mediaBlob){videoBlob=p.mediaBlob;videoObjectUrl=URL.createObjectURL(videoBlob);await setupVideoFromUrl(videoObjectUrl);}await enterEditor();}
  async function markPhraseUsed(){if($('#save-manual-phrase').checked&&state.phrase&&!state.phraseId){const ph={id:uid('ph'),category:'vita_reale',text:state.phrase,tags:[],used:true,usedAt:nowISO(),useCount:1,favorite:false,active:true,source:'editor',createdAt:nowISO(),updatedAt:nowISO()};await IADB.put('phrases',ph);state.phraseId=ph.id;}else if(state.phraseId){const ph=await IADB.get('phrases',state.phraseId);if(ph){ph.used=true;ph.usedAt=nowISO();ph.useCount=(ph.useCount||0)+1;ph.updatedAt=nowISO();await IADB.put('phrases',ph);}}}
  function showDoneModal(video=false){openModal('Fatto ♥',`<p class="muted">${video?'Il video':'La grafica'} è pronto${state.phraseId?'. La frase è stata contrassegnata come utilizzata.':''}</p><div class="modal-buttons"><button class="secondary-button" id="done-home">Home</button><button class="big-button" id="done-another">Creane un’altra</button></div>`);$('#done-home').onclick=()=>{closeModal();showScreen('home');};$('#done-another').onclick=()=>{closeModal();openCreateHub();};}
  async function getExportAudioTrack(){
    if(state.videoMuted||!videoEl)return null;
    try{const cap=videoEl.captureStream?.()||videoEl.webkitCaptureStream?.();const t=cap?.getAudioTracks?.()[0];if(t)return t.clone();}catch(e){}
    try{if(!videoAudioCtx){videoAudioCtx=new (window.AudioContext||window.webkitAudioContext)();videoAudioSource=videoAudioCtx.createMediaElementSource(videoEl);videoAudioDest=videoAudioCtx.createMediaStreamDestination();videoAudioSource.connect(videoAudioDest);}await videoAudioCtx.resume();const t=videoAudioDest.stream.getAudioTracks()[0];return t?.clone?.()||t||null;}catch(e){console.warn('Audio export non disponibile',e);return null;}
  }
  async function exportVideo(){if(!videoEl||!videoBlob)throw new Error('Nessun video caricato.');if(typeof canvas.captureStream!=='function'||typeof MediaRecorder==='undefined')throw new Error('Questo browser non supporta ancora l’esportazione video dalla web app.');closePreview();videoEl.pause();const start=state.videoTrimStart||0,end=state.videoTrimEnd??state.videoDuration;if(end-start<=.05)throw new Error('Intervallo video non valido.');openModal('Esportazione video',`<div class="export-progress"><p class="muted">Il video viene elaborato in tempo reale. Tieni aperta l’app.</p><progress id="export-progress" max="100" value="0"></progress><div class="video-export-note" id="export-note">Preparazione…</div></div>`);const stream=canvas.captureStream(30);const audioTrack=await getExportAudioTrack();if(audioTrack)stream.addTrack(audioTrack);
    const types=['video/mp4;codecs="avc1.42E01E,mp4a.40.2"','video/mp4','video/webm;codecs=vp9,opus','video/webm'];const mime=types.find(t=>MediaRecorder.isTypeSupported?.(t))||'';const rec=new MediaRecorder(stream,mime?{mimeType:mime,videoBitsPerSecond:8000000}:{videoBitsPerSecond:8000000});const chunks=[];rec.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data);};const done=new Promise((res,rej)=>{rec.onstop=res;rec.onerror=()=>rej(rec.error||new Error('Registrazione non riuscita'));});videoEl.currentTime=start;await new Promise(r=>{const h=()=>{videoEl.removeEventListener('seeked',h);r();};videoEl.addEventListener('seeked',h,{once:true});});rec.start(500);await videoEl.play();const prog=$('#export-progress'),note=$('#export-note');await new Promise(resolve=>{const t=setInterval(()=>{const pct=Math.min(100,Math.max(0,(videoEl.currentTime-start)/(end-start)*100));if(prog)prog.value=pct;if(note)note.textContent=`${Math.round(pct)}% · ${formatTime(videoEl.currentTime-start)} / ${formatTime(end-start)}`;if(videoEl.currentTime>=end||videoEl.ended){clearInterval(t);videoEl.pause();resolve();}},80);});renderCanvas();rec.stop();await done;stream.getTracks().forEach(t=>t.stop());const outType=rec.mimeType||mime||'video/webm',ext=outType.includes('mp4')?'mp4':'webm';const blob=new Blob(chunks,{type:outType});const file=new File([blob],`IA_video_${state.format}_${new Date().toISOString().slice(0,10)}_${String(Date.now()).slice(-5)}.${ext}`,{type:outType});await markPhraseUsed();await IADB.del('drafts','current');await renderPhrases();await refreshHome();openModal('Video pronto ♥',`<p class="muted">Il montaggio è terminato${ext==='webm'?'. Su questo browser il formato disponibile è WebM.':' in MP4.'}</p><div class="modal-buttons"><button class="secondary-button" id="video-back-editor">Torna all’editor</button><button class="big-button" id="video-share-save">Salva / Condividi</button></div>`);$('#video-back-editor').onclick=closeModal;$('#video-share-save').onclick=async()=>{try{if(navigator.canShare?.({files:[file]}))await navigator.share({files:[file],title:'Ironicamente Acida'});else downloadBlob(blob,file.name);closeModal();showDoneModal(true);}catch(err){if(err?.name!=='AbortError'){downloadBlob(blob,file.name);closeModal();showDoneModal(true);}}};}

  // ---------- utils ----------
  async function hydrateMedia(){
    imageCache.clear();photoFilterCacheKey='';photoFilterCanvas=null;
    // Se una foto è stata appena preparata, riusa l'immagine già decodificata:
    // su iPhone evitare una seconda decodifica della foto originale riduce blocchi e memoria.
    if(state.mode==='photo'&&state.bgDataUrl&&!bgImage)bgImage=await loadImage(state.bgDataUrl).catch(()=>null);
    if(state.mode!=='photo')bgImage=null;
    if(state.mode==='video'&&videoBlob&&!videoObjectUrl){videoObjectUrl=URL.createObjectURL(videoBlob);await setupVideoFromUrl(videoObjectUrl);}
    for(const o of state.overlays||[]){const img=await loadImage(o.src).catch(()=>null);if(img)imageCache.set(o.id,img);}state.overlays=state.overlays||[];
  }
  function loadImage(src){if(!src)return Promise.reject(new Error('src vuoto'));return new Promise((res,rej)=>{const im=new Image();im.onload=()=>res(im);im.onerror=()=>rej(new Error('Immagine non leggibile'));im.src=src;});}
  function nextPaint(){return new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));}
  async function preparePhotoFile(file){
    const objectUrl=URL.createObjectURL(file);
    try{
      let source;
      try{source=await loadImage(objectUrl);}catch(firstErr){
        const raw=await fileToDataURL(file);source=await loadImage(raw);
      }
      const iw=source.naturalWidth||source.width||1080,ih=source.naturalHeight||source.height||1080;
      if(!iw||!ih)throw new Error('Dimensioni foto non disponibili');
      // L'export massimo dell'app è 1920 px: 2200 px conserva margine per crop/zoom
      // senza tenere in memoria fotografie iPhone da 12–48 MP.
      const maxSide=2200,scale=Math.min(1,maxSide/Math.max(iw,ih));
      const w=Math.max(1,Math.round(iw*scale)),h=Math.max(1,Math.round(ih*scale));
      const c=document.createElement('canvas');c.width=w;c.height=h;
      const cc=c.getContext('2d',{alpha:false});
      if(!cc)throw new Error('Canvas non disponibile');
      cc.fillStyle='#fff';cc.fillRect(0,0,w,h);cc.drawImage(source,0,0,w,h);
      let data;
      try{data=c.toDataURL('image/jpeg',.94);}catch(err){throw new Error('Impossibile convertire la fotografia');}
      const image=await loadImage(data);
      c.width=1;c.height=1;
      return {data,image,originalWidth:iw,originalHeight:ih};
    }finally{URL.revokeObjectURL(objectUrl);}
  }
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
