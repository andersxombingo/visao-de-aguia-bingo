(() => {
  'use strict';

  const STORAGE_KEY = 'marca-bingo-v01'; // mantém compatibilidade com versões anteriores
  const APP_VERSION = '0.7';
  const TEMPLATE = {
    left:  { x:.008, y:.175, w:.415, h:.82 },
    right: { x:.579, y:.175, w:.415, h:.82 },
    id:    { x:.430, y:.800, w:.140, h:.180 }
  };

  const state = loadState();
  let sourceImage = null;
  let boardRect = null;
  let detectedRects = null;
  let reviewCards = [];
  let editingCardId = '';
  let deferredPrompt = null;
  let ocrWorker = null;
  let cameraStream = null;
  let cameraMonitorTimer = null;
  let bingoQueue = [];

  const $ = id => document.getElementById(id);
  const views = ['homeView','captureView','gameView'];
  const RANGES = [[1,15],[16,30],[31,45],[46,60],[61,75]];
  const MODE_LABELS = {prime:'Modo Prime',x:'Modo X',full:'Cartela cheia'};

  function defaultState(){ return {cards:[],drawn:[],winMode:'prime',primeCornerSquares:false}; }
  function normalizeCard(c){
    return Object.assign({boardId:'',side:'Cartela',groupId:c?.id || ('g_'+Date.now().toString(36)),freeCenter:true},c||{});
  }
  function loadState(){
    try{
      const parsed=Object.assign(defaultState(),JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}'));
      parsed.cards=(parsed.cards||[]).map(normalizeCard);
      if(!['prime','x','full'].includes(parsed.winMode)) parsed.winMode='prime';
      return parsed;
    }catch{return defaultState();}
  }
  function saveState(){ localStorage.setItem(STORAGE_KEY,JSON.stringify(state)); }
  function esc(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
  function toast(msg){const t=$('toast');t.textContent=msg;t.classList.remove('hidden');clearTimeout(t._timer);t._timer=setTimeout(()=>t.classList.add('hidden'),2500);}
  function showView(id){views.forEach(v=>$(v).classList.toggle('active',v===id));window.scrollTo({top:0,behavior:'smooth'});}
  function cleanId(v){return String(v||'').replace(/[^0-9A-Za-z-]/g,'').slice(0,12);}
  function boardLabel(card){return card.boardId?`Tábua ${card.boardId}`:(card.name||'Cartela');}
  function sideLabel(card){return card.side||'Cartela';}

  function activeModeLabel(){return state.winMode==='prime'&&state.primeCornerSquares?'Modo Prime + quadradinhos':(MODE_LABELS[state.winMode]||'Modo Prime');}
  function modeHelpText(){
    if(state.winMode==='x') return 'X completo: as duas diagonais precisam estar marcadas.';
    if(state.winMode==='full') return 'Cartela cheia: todos os espaços precisam estar marcados.';
    return `Prime: horizontal, vertical, 2 diagonais, 4 cantos e os 4 formatos de V${state.primeCornerSquares?' + quadradinhos dos cantos':''}.`;
  }
  function renderModeUI(){
    $('modeChip').textContent=activeModeLabel();
    $('currentModeLabel').textContent=activeModeLabel();
    $('modeHelp').textContent=modeHelpText();
    document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===state.winMode));
    $('primeSquaresSetting').checked=!!state.primeCornerSquares;
  }
  function setWinMode(mode){
    if(!['prime','x','full'].includes(mode)) return;
    state.winMode=mode;saveState();renderModeUI();renderHomeCounters();
    if($('gameView').classList.contains('active')) renderGame();
  }

  function groupCards(){
    const map=new Map();
    state.cards.forEach(c=>{
      const key=c.groupId||c.boardId||c.id;
      if(!map.has(key)) map.set(key,[]);
      map.get(key).push(c);
    });
    return [...map.entries()].map(([key,cards])=>({key,cards,boardId:cards[0]?.boardId||''}));
  }
  function renderHomeCounters(){
    $('boardCount').textContent=groupCards().length;
    $('cardCount').textContent=state.cards.length;
    $('nearCount').textContent=state.cards.filter(c=>getBestRemaining(c).remaining===1).length;
    $('startGameBtn').disabled=!state.cards.length;
  }
  function renderGridHtml(numbers,freeCenter,drawnSet=new Set(),winningLine=null){
    return `<div class="bingo-grid">${(numbers||[]).map((n,idx)=>{
      const free=freeCenter&&idx===12,marked=free||drawnSet.has(Number(n)),winning=winningLine?.includes(idx);
      return `<div class="bingo-cell ${free?'free':''} ${marked?'marked':''} ${winning?'winning':''}">${free?'★':esc(n)}</div>`;
    }).join('')}</div>`;
  }
  function renderHome(){
    renderModeUI();renderHomeCounters();
    const box=$('cardsList');const groups=groupCards();
    if(!groups.length){box.className='cards-list empty-state';box.textContent='Nenhuma tábua adicionada ainda.';return;}
    box.className='cards-list';
    box.innerHTML=groups.map(g=>{
      const id=g.boardId||'Sem ID';
      return `<article class="saved-card">
        <div class="saved-card-head">
          <div class="board-title"><span class="id-tag">ID ${esc(id)}</span><strong>${g.boardId?`Tábua ${esc(g.boardId)}`:'Cartela cadastrada'}</strong><small>${g.cards.length} cartela(s)</small></div>
          <button class="mini-btn danger" data-delete-group="${esc(g.key)}">Excluir</button>
        </div>
        <div class="board-mini-cards">${g.cards.map(c=>`<div class="board-mini-card"><div class="mini-side"><strong>${esc(sideLabel(c))}</strong><button class="mini-btn" data-edit="${c.id}">Editar</button></div>${renderGridHtml(c.numbers,c.freeCenter)}</div>`).join('')}</div>
      </article>`;
    }).join('');
    box.querySelectorAll('[data-delete-group]').forEach(btn=>btn.onclick=()=>{
      if(confirm('Excluir esta tábua e suas cartelas?')){state.cards=state.cards.filter(c=>(c.groupId||c.boardId||c.id)!==btn.dataset.deleteGroup);saveState();renderHome();}
    });
    box.querySelectorAll('[data-edit]').forEach(btn=>btn.onclick=()=>editCard(btn.dataset.edit));
  }

  function openMenu(){ $('menuBackdrop').classList.remove('hidden');$('settingsDrawer').classList.add('open');$('settingsDrawer').setAttribute('aria-hidden','false');renderModeUI(); }
  function closeMenu(){ $('settingsDrawer').classList.remove('open');$('settingsDrawer').setAttribute('aria-hidden','true');setTimeout(()=>$('menuBackdrop').classList.add('hidden'),180); }
  $('menuBtn').onclick=openMenu;$('gameMenuBtn').onclick=openMenu;$('closeMenuBtn').onclick=closeMenu;$('closeMenuAction').onclick=closeMenu;$('menuBackdrop').onclick=closeMenu;
  document.querySelectorAll('[data-mode]').forEach(btn=>btn.onclick=()=>setWinMode(btn.dataset.mode));
  $('primeSquaresSetting').onchange=e=>{state.primeCornerSquares=!!e.target.checked;saveState();renderModeUI();renderHomeCounters();if($('gameView').classList.contains('active'))renderGame();};

  function resetCaptureUI(){
    stopCamera();sourceImage=null;boardRect=null;detectedRects=null;reviewCards=[];editingCardId='';
    $('photoInput').value='';$('freeCenter').checked=true;$('boardIdInput').value='';
    ['cropTop','cropBottom','cropLeft','cropRight'].forEach(id=>$(id).value='0');
    $('captureStartPanel').classList.remove('hidden');$('liveCameraPanel').classList.add('hidden');$('previewPanel').classList.add('hidden');$('reviewPanel').classList.add('hidden');$('ocrStatus').classList.add('hidden');
  }
  function openCapture(){resetCaptureUI();showView('captureView');}
  $('addBoardBtn').onclick=openCapture;
  document.querySelectorAll('[data-back-home]').forEach(b=>b.onclick=()=>{stopCamera();renderHome();showView('homeView');});

  function editCard(id){
    const c=state.cards.find(x=>x.id===id);if(!c)return;
    resetCaptureUI();editingCardId=id;reviewCards=[{name:c.name||'',numbers:[...c.numbers],freeCenter:!!c.freeCenter,side:c.side||'Cartela',boardId:c.boardId||'',groupId:c.groupId||c.id}];
    $('boardIdInput').value=c.boardId||'';$('freeCenter').checked=!!c.freeCenter;
    $('captureStartPanel').classList.add('hidden');$('reviewPanel').classList.remove('hidden');renderReviewCards();showView('captureView');
  }

  async function openCamera(){
    $('cameraError').textContent='';
    if(!navigator.mediaDevices?.getUserMedia){$('cameraError').textContent='Câmera guiada indisponível. Use “Usar uma foto”.';return;}
    try{
      stopCamera();
      cameraStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:2560},height:{ideal:1440}},audio:false});
      $('liveVideo').srcObject=cameraStream;await $('liveVideo').play();
      $('captureStartPanel').classList.add('hidden');$('liveCameraPanel').classList.remove('hidden');$('previewPanel').classList.add('hidden');$('reviewPanel').classList.add('hidden');
      startCameraMonitor();
    }catch(err){console.error(err);$('cameraError').textContent='Não consegui abrir a câmera. Libere a permissão ou use uma foto da galeria.';}
  }
  function stopCamera(){
    if(cameraMonitorTimer){clearInterval(cameraMonitorTimer);cameraMonitorTimer=null;}
    if(cameraStream){cameraStream.getTracks().forEach(t=>t.stop());cameraStream=null;}
    if($('liveVideo'))$('liveVideo').srcObject=null;
  }
  $('openCameraBtn').onclick=openCamera;$('closeCameraBtn').onclick=()=>{stopCamera();$('liveCameraPanel').classList.add('hidden');$('captureStartPanel').classList.remove('hidden');};
  $('flashHintBtn').onclick=()=>toast('Evite sombra e reflexo sobre os números.');

  function videoGuideSourceRect(){
    const video=$('liveVideo'),guide=$('boardGuide'),vr=video.getBoundingClientRect(),gr=guide.getBoundingClientRect();
    if(!video.videoWidth||!video.videoHeight||!vr.width||!vr.height)return null;
    const scale=Math.max(vr.width/video.videoWidth,vr.height/video.videoHeight),renderedW=video.videoWidth*scale,renderedH=video.videoHeight*scale,offX=(renderedW-vr.width)/2,offY=(renderedH-vr.height)/2;
    let sx=(gr.left-vr.left+offX)/scale,sy=(gr.top-vr.top+offY)/scale,sw=gr.width/scale,sh=gr.height/scale;
    sx=Math.max(0,sx);sy=Math.max(0,sy);sw=Math.min(video.videoWidth-sx,sw);sh=Math.min(video.videoHeight-sy,sh);
    return {x:sx,y:sy,w:sw,h:sh};
  }
  function regionEdgeScore(data,w,h,rel){
    const x0=Math.max(1,Math.floor(w*rel.x)),x1=Math.min(w-2,Math.ceil(w*(rel.x+rel.w))),y0=Math.max(1,Math.floor(h*rel.y)),y1=Math.min(h-2,Math.ceil(h*(rel.y+rel.h)));
    let sum=0,count=0;
    for(let y=y0;y<y1;y+=3){for(let x=x0;x<x1;x+=3){const i=(y*w+x)*4,l=data[i]*.299+data[i+1]*.587+data[i+2]*.114,ix=(y*w+x+1)*4,iy=((y+1)*w+x)*4,gx=Math.abs(l-(data[ix]*.299+data[ix+1]*.587+data[ix+2]*.114)),gy=Math.abs(l-(data[iy]*.299+data[iy+1]*.587+data[iy+2]*.114));sum+=(gx+gy)/2;count++;}}
    return count?sum/count:0;
  }
  function startCameraMonitor(){
    const c=document.createElement('canvas');c.width=360;c.height=170;const ctx=c.getContext('2d',{willReadFrequently:true});
    cameraMonitorTimer=setInterval(()=>{
      const v=$('liveVideo'),r=videoGuideSourceRect();if(!r||!v.videoWidth)return;
      ctx.drawImage(v,r.x,r.y,r.w,r.h,0,0,c.width,c.height);const d=ctx.getImageData(0,0,c.width,c.height).data;
      const left=regionEdgeScore(d,c.width,c.height,TEMPLATE.left),right=regionEdgeScore(d,c.width,c.height,TEMPLATE.right),ok=left>10&&right>10;
      $('boardGuide').classList.toggle('locked',ok);$('cameraStatus').textContent=ok?'Tábua detectada ✓':'Procurando tábua…';$('cameraStatusSub').textContent=ok?'Pode fotografar':'Alinhe as duas cartelas nas áreas verdes';
    },500);
  }
  function imageFromCanvas(canvas){return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=reject;img.src=canvas.toDataURL('image/jpeg',.98);});}
  $('capturePhotoBtn').onclick=async()=>{
    const v=$('liveVideo'),r=videoGuideSourceRect();if(!r)return;
    const c=document.createElement('canvas');c.width=1800;c.height=Math.round(1800*r.h/r.w);c.getContext('2d').drawImage(v,r.x,r.y,r.w,r.h,0,0,c.width,c.height);
    try{sourceImage=await imageFromCanvas(c);stopCamera();boardRect={x:0,y:0,w:sourceImage.naturalWidth,h:sourceImage.naturalHeight};prepareDetectedPreview(true);}catch{$('cameraError').textContent='Não consegui capturar. Tente novamente.';}
  };
  $('photoInput').addEventListener('change',e=>{
    const file=e.target.files?.[0];if(!file)return;const img=new Image();img.onload=()=>{sourceImage=img;boardRect=initialBoardRectForPhoto(img);prepareDetectedPreview(false);};img.src=URL.createObjectURL(file);
  });

  function initialBoardRectForPhoto(img){
    // O modelo é largo. Mantemos margem pequena e deixamos ajuste manual como fallback.
    const mx=img.naturalWidth*.035,my=img.naturalHeight*.08;
    return {x:mx,y:my,w:img.naturalWidth-mx*2,h:img.naturalHeight-my*2};
  }
  function adjustedBoardRect(){
    if(!boardRect)return null;
    const l=+$('cropLeft').value/100,r=+$('cropRight').value/100,t=+$('cropTop').value/100,b=+$('cropBottom').value/100;
    return {x:boardRect.x+boardRect.w*l,y:boardRect.y+boardRect.h*t,w:boardRect.w*(1-l-r),h:boardRect.h*(1-t-b)};
  }
  function templateRect(R,T){return{x:R.x+R.w*T.x,y:R.y+R.h*T.y,w:R.w*T.w,h:R.h*T.h};}

  function makeAnalysisCanvas(){
    const maxW=1000,scale=Math.min(1,maxW/sourceImage.naturalWidth),c=document.createElement('canvas');c.width=Math.round(sourceImage.naturalWidth*scale);c.height=Math.round(sourceImage.naturalHeight*scale);const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(sourceImage,0,0,c.width,c.height);return{c,ctx,scale};
  }
  function refineRectEdges(rect){
    if(!sourceImage)return rect;
    try{
      const {c,ctx,scale}=makeAnalysisCanvas(),img=ctx.getImageData(0,0,c.width,c.height).data,W=c.width,H=c.height;
      const rr={x:rect.x*scale,y:rect.y*scale,w:rect.w*scale,h:rect.h*scale};
      const gray=(x,y)=>{const i=(Math.max(0,Math.min(H-1,y))*W+Math.max(0,Math.min(W-1,x)))*4;return img[i]*.299+img[i+1]*.587+img[i+2]*.114;};
      const vScore=(x,y0,y1)=>{let s=0,n=0;for(let y=Math.max(2,Math.floor(y0));y<Math.min(H-2,Math.ceil(y1));y+=2){s+=Math.abs(gray(x+1,y)-gray(x-1,y));n++;}return n?s/n:0;};
      const hScore=(y,x0,x1)=>{let s=0,n=0;for(let x=Math.max(2,Math.floor(x0));x<Math.min(W-2,Math.ceil(x1));x+=2){s+=Math.abs(gray(x,y+1)-gray(x,y-1));n++;}return n?s/n:0;};
      const bestNear=(center,range,fn,min,max)=>{let best=center,bs=-1;for(let p=Math.floor(center-range);p<=Math.ceil(center+range);p++){if(p<min||p>max)continue;const s=fn(p);if(s>bs){bs=s;best=p;}}return best;};
      const xr=rr.w*.045,yr=rr.h*.045;
      const left=bestNear(rr.x,xr,x=>vScore(x,rr.y,rr.y+rr.h),2,W-3),right=bestNear(rr.x+rr.w,xr,x=>vScore(x,rr.y,rr.y+rr.h),2,W-3),top=bestNear(rr.y,yr,y=>hScore(y,rr.x,rr.x+rr.w),2,H-3),bottom=bestNear(rr.y+rr.h,yr,y=>hScore(y,rr.x,rr.x+rr.w),2,H-3);
      if(right-left<rr.w*.75||bottom-top<rr.h*.72)return rect;
      return{x:left/scale,y:top/scale,w:(right-left)/scale,h:(bottom-top)/scale};
    }catch(e){console.warn('Autoajuste falhou',e);return rect;}
  }
  function computeDetectedRects(){
    const R=adjustedBoardRect();if(!R)return null;
    let left=templateRect(R,TEMPLATE.left),right=templateRect(R,TEMPLATE.right),id=templateRect(R,TEMPLATE.id);
    left=refineRectEdges(left);right=refineRectEdges(right);
    return{board:R,left,right,id};
  }
  function prepareDetectedPreview(fromGuide){
    ['cropTop','cropBottom','cropLeft','cropRight'].forEach(id=>$(id).value='0');
    detectedRects=computeDetectedRects();
    $('liveCameraPanel').classList.add('hidden');$('captureStartPanel').classList.add('hidden');$('previewPanel').classList.remove('hidden');$('reviewPanel').classList.add('hidden');$('ocrStatus').classList.add('hidden');
    $('detectBadge').textContent=fromGuide?'Autoenquadrado':'Confira';$('detectBadge').className='badge '+(fromGuide?'ok':'');drawPreview();
  }
  ['cropTop','cropBottom','cropLeft','cropRight'].forEach(id=>$(id).addEventListener('input',()=>{detectedRects=computeDetectedRects();drawPreview();}));
  function drawPreview(){
    if(!sourceImage)return;detectedRects=computeDetectedRects();
    const c=$('previewCanvas'),maxW=1000,scale=Math.min(1,maxW/sourceImage.naturalWidth);c.width=Math.round(sourceImage.naturalWidth*scale);c.height=Math.round(sourceImage.naturalHeight*scale);const ctx=c.getContext('2d');ctx.drawImage(sourceImage,0,0,c.width,c.height);
    const drawRect=(r,color,width=3,dash=[])=>{ctx.save();ctx.strokeStyle=color;ctx.lineWidth=width;ctx.setLineDash(dash);ctx.strokeRect(r.x*scale,r.y*scale,r.w*scale,r.h*scale);ctx.restore();};
    const R=detectedRects;ctx.fillStyle='rgba(0,0,0,.18)';ctx.fillRect(0,0,c.width,c.height);drawRect(R.board,'#38bdf8',3);drawRect(R.left,'#22c55e',4);drawRect(R.right,'#22c55e',4);drawRect(R.id,'#f59e0b',2,[7,5]);
    ctx.font=`bold ${Math.max(12,18*scale)}px system-ui`;ctx.fillStyle='#86efac';ctx.fillText('ESQUERDA',R.left.x*scale+6,R.left.y*scale+20);ctx.fillText('DIREITA',R.right.x*scale+6,R.right.y*scale+20);ctx.fillStyle='#fde68a';ctx.fillText('ID',R.id.x*scale+6,R.id.y*scale+18);
  }

  async function createOcrWorker(){
    if(!window.Tesseract)throw new Error('Leitor não carregou. Verifique a internet.');
    const worker=await Tesseract.createWorker('eng',1,{logger:m=>{if(['loading tesseract core','loading language traineddata','initializing api'].includes(m.status))updateOcrStatus('Preparando leitor…',Math.round((m.progress||0)*8));}});
    await worker.setParameters({tessedit_char_whitelist:'0123456789',tessedit_pageseg_mode:'8',preserve_interword_spaces:'0',user_defined_dpi:'300'});return worker;
  }
  async function getWorker(){if(!ocrWorker)ocrWorker=await createOcrWorker();return ocrWorker;}
  async function rebuildWorker(){try{await ocrWorker?.terminate();}catch{}ocrWorker=null;return getWorker();}
  function updateOcrStatus(text,pct){const el=$('ocrStatus');el.classList.remove('hidden');el.innerHTML=`<strong>${esc(text)}</strong><div class="progress"><span style="width:${Math.max(0,Math.min(100,pct))}%"></span></div>`;}

  function otsuThreshold(gray){const hist=new Array(256).fill(0);for(const v of gray)hist[v]++;const total=gray.length;let sum=0;for(let i=0;i<256;i++)sum+=i*hist[i];let sumB=0,wB=0,maxVar=-1,threshold=155;for(let t=0;t<256;t++){wB+=hist[t];if(!wB)continue;const wF=total-wB;if(!wF)break;sumB+=t*hist[t];const mB=sumB/wB,mF=(sum-sumB)/wF,between=wB*wF*(mB-mF)*(mB-mF);if(between>maxVar){maxVar=between;threshold=t;}}return Math.max(85,Math.min(220,threshold));}
  function adaptiveBinary(gray,w,h){const out=new Uint8Array(gray.length),integral=new Float64Array((w+1)*(h+1));for(let y=0;y<h;y++){let row=0;for(let x=0;x<w;x++){row+=gray[y*w+x];integral[(y+1)*(w+1)+x+1]=integral[y*(w+1)+x+1]+row;}}const radius=20,bias=11;for(let y=0;y<h;y++)for(let x=0;x<w;x++){const x0=Math.max(0,x-radius),y0=Math.max(0,y-radius),x1=Math.min(w-1,x+radius),y1=Math.min(h-1,y+radius),A=integral[y0*(w+1)+x0],B=integral[y0*(w+1)+x1+1],C=integral[(y1+1)*(w+1)+x0],D=integral[(y1+1)*(w+1)+x1+1],mean=(D-B-C+A)/((x1-x0+1)*(y1-y0+1));out[y*w+x]=gray[y*w+x]<mean-bias?0:255;}return out;}
  function makeCellCanvas(rect,row,col,variant='adaptive'){
    const cellW=rect.w/5,cellH=rect.h/5,padX=cellW*.12,padY=cellH*.13,sx=rect.x+col*cellW+padX,sy=rect.y+row*cellH+padY,sw=cellW-padX*2,sh=cellH-padY*2;
    const c=document.createElement('canvas');c.width=420;c.height=310;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(sourceImage,sx,sy,sw,sh,34,28,c.width-68,c.height-56);
    const im=ctx.getImageData(0,0,c.width,c.height),d=im.data,gray=new Uint8Array(c.width*c.height);for(let i=0,j=0;i<d.length;i+=4,j++){let g=Math.round(.299*d[i]+.587*d[i+1]+.114*d[i+2]);g=Math.max(0,Math.min(255,(g-128)*1.75+128));gray[j]=g;}
    let p;if(variant==='gray')p=gray;else if(variant==='binary'){const th=otsuThreshold(gray);p=new Uint8Array(gray.length);for(let i=0;i<gray.length;i++)p[i]=gray[i]<th?0:255;}else p=adaptiveBinary(gray,c.width,c.height);
    for(let i=0,j=0;i<d.length;i+=4,j++){const v=p[j];d[i]=d[i+1]=d[i+2]=v;d[i+3]=255;}ctx.putImageData(im,0,0);return c;
  }
  function parseNumber(text,col){const matches=String(text||'').match(/\d{1,2}/g)||[];for(const token of matches){const n=Number(token);if(n>=RANGES[col][0]&&n<=RANGES[col][1])return n;}return '';}
  async function recognizeCell(worker,rect,row,col){
    const variants=['adaptive','gray','binary'];let best={value:'',confidence:-1};
    for(let i=0;i<variants.length;i++){
      try{const ret=await worker.recognize(makeCellCanvas(rect,row,col,variants[i])),value=parseNumber(ret.data.text,col),confidence=Number(ret.data.confidence||0);if(value!==''&&confidence>best.confidence)best={value,confidence};if(value!==''&&confidence>=58)break;}catch{}
    }
    return best.value;
  }
  function makeIdCanvas(rect,variant='gray'){
    const c=document.createElement('canvas');c.width=760;c.height=260;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(sourceImage,rect.x,rect.y,rect.w,rect.h,20,20,c.width-40,c.height-40);
    const im=ctx.getImageData(0,0,c.width,c.height),d=im.data,gray=new Uint8Array(c.width*c.height);for(let i=0,j=0;i<d.length;i+=4,j++){const g=Math.round(.299*d[i]+.587*d[i+1]+.114*d[i+2]);gray[j]=g;}
    let p=gray;if(variant==='binary'){const th=otsuThreshold(gray);p=new Uint8Array(gray.length);for(let i=0;i<gray.length;i++)p[i]=gray[i]<th?0:255;}
    for(let i=0,j=0;i<d.length;i+=4,j++){d[i]=d[i+1]=d[i+2]=p[j];d[i+3]=255;}ctx.putImageData(im,0,0);return c;
  }
  async function recognizeBoardId(worker,rect){
    await worker.setParameters({tessedit_char_whitelist:'0123456789',tessedit_pageseg_mode:'7'});
    let candidates=[];
    for(const variant of ['gray','binary']){try{const ret=await worker.recognize(makeIdCanvas(rect,variant));candidates.push(...(String(ret.data.text||'').match(/\d{3,10}/g)||[]));}catch{}}
    await worker.setParameters({tessedit_char_whitelist:'0123456789',tessedit_pageseg_mode:'8'});
    candidates=candidates.sort((a,b)=>b.length-a.length);return candidates[0]||'';
  }

  $('scanBtn').onclick=scanBoard;
  async function scanBoard(){
    if(!sourceImage||!detectedRects)return;$('scanBtn').disabled=true;updateOcrStatus('Preparando leitura…',2);
    const free=$('freeCenter').checked;let worker;
    try{worker=await getWorker();}catch(e){console.error(e);updateOcrStatus('Não consegui abrir o leitor. Verifique a internet.',100);$('scanBtn').disabled=false;return;}
    let boardId='';
    try{updateOcrStatus('Lendo identificação da tábua…',7);boardId=await recognizeBoardId(worker,detectedRects.id);}catch{}
    const cards=[{side:'Esquerda',rect:detectedRects.left,numbers:Array(25).fill('')},{side:'Direita',rect:detectedRects.right,numbers:Array(25).fill('')}];
    let done=0,failures=0;const expected=free?48:50;
    for(const card of cards){
      for(let row=0;row<5;row++)for(let col=0;col<5;col++){
        const idx=row*5+col;if(free&&idx===12){card.numbers[idx]=0;continue;}
        updateOcrStatus(`Lendo ${card.side.toLowerCase()} · número ${done+1} de ${expected}…`,10+Math.round(done/expected*88));
        let val='';try{val=await recognizeCell(worker,card.rect,row,col);}catch{}
        if(val===''){failures++;if(failures===5){try{worker=await rebuildWorker();await worker.setParameters({tessedit_char_whitelist:'0123456789',tessedit_pageseg_mode:'8'});failures=0;}catch{}}}else failures=0;
        card.numbers[idx]=val;done++;
      }
    }
    const groupId='g_'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
    reviewCards=cards.map(c=>({name:'',numbers:c.numbers,freeCenter:free,side:c.side,boardId,groupId}));
    $('boardIdInput').value=boardId;renderReviewCards();$('previewPanel').classList.add('hidden');$('reviewPanel').classList.remove('hidden');
    const read=reviewCards.reduce((s,c)=>s+c.numbers.filter((n,i)=>!(free&&i===12)&&n!=='').length,0);updateOcrStatus(`Leitura concluída: ${read} de ${expected} números.`,100);$('scanBtn').disabled=false;window.scrollTo({top:0,behavior:'smooth'});
  }

  function validateCardData(card){
    const messages=[];let ok=true;
    for(let idx=0;idx<25;idx++){if(card.freeCenter&&idx===12)continue;const col=idx%5,n=Number(card.numbers[idx]);if(!Number.isInteger(n)||n<RANGES[col][0]||n>RANGES[col][1]){ok=false;messages.push(`Posição ${idx+1}: use ${RANGES[col][0]}–${RANGES[col][1]}.`);}}
    const nums=card.numbers.filter((_,i)=>!(card.freeCenter&&i===12)).map(Number).filter(Number.isInteger);if(new Set(nums).size!==nums.length){ok=false;messages.push('Há números repetidos.');}return{ok,messages};
  }
  function renderReviewCards(){
    const box=$('reviewCards');
    box.innerHTML=reviewCards.map((card,ci)=>{
      const valid=validateCardData(card),grid=card.numbers.map((n,idx)=>{
        if(card.freeCenter&&idx===12)return`<div class="bingo-cell free">★</div>`;const col=idx%5,num=Number(n),cellOk=Number.isInteger(num)&&num>=RANGES[col][0]&&num<=RANGES[col][1];
        return`<div class="bingo-cell ${n!==''&&!cellOk?'invalid':''} ${n===''?'missing':''}"><input data-card="${ci}" data-cell="${idx}" inputmode="numeric" type="number" min="${RANGES[col][0]}" max="${RANGES[col][1]}" value="${esc(n)}"></div>`;
      }).join('');
      return`<section class="review-card-block"><div class="section-head review-card-head"><div><div class="eyebrow">CARTELA ${esc(card.side.toUpperCase())}</div><h3>${esc(card.side)}</h3></div><span class="badge ${valid.ok?'ok':'bad'}">${valid.ok?'OK':'Corrigir'}</span></div><div class="bingo-head-row"><span>B</span><span>I</span><span>N</span><span>G</span><span>O</span></div><div class="bingo-grid editor">${grid}</div><div class="validation-messages">${esc(valid.messages.slice(0,3).join(' '))}</div></section>`;
    }).join('');
    box.querySelectorAll('input[data-cell]').forEach(inp=>{inp.addEventListener('input',()=>{const ci=+inp.dataset.card,idx=+inp.dataset.cell;reviewCards[ci].numbers[idx]=inp.value===''?'':Number(inp.value);updateReviewValidity();});inp.addEventListener('change',()=>renderReviewCards());});
    updateReviewValidity();
  }
  function updateReviewValidity(){
    const allOk=reviewCards.length&&reviewCards.every(c=>validateCardData(c).ok),free=$('freeCenter').checked,read=reviewCards.reduce((s,c)=>s+c.numbers.filter((n,i)=>!(free&&i===12)&&n!=='').length,0),expected=reviewCards.length*(free?24:25);
    $('reviewSummary').textContent=`${read} de ${expected} números reconhecidos. Toque somente nos números que precisarem de correção.`;$('reviewBadge').textContent=allOk?'Pronto para salvar':'Precisa corrigir';$('reviewBadge').className='badge '+(allOk?'ok':'bad');$('saveBoardBtn').disabled=!allOk;
  }
  $('freeCenter').addEventListener('change',()=>{if(reviewCards.length){reviewCards.forEach(c=>{c.freeCenter=$('freeCenter').checked;if(c.freeCenter)c.numbers[12]=0;});renderReviewCards();}});
  $('boardIdInput').addEventListener('input',e=>{e.target.value=cleanId(e.target.value);reviewCards.forEach(c=>c.boardId=e.target.value);});
  $('saveBoardBtn').onclick=()=>{
    if(!reviewCards.length||!reviewCards.every(c=>validateCardData(c).ok))return;
    const id=cleanId($('boardIdInput').value),free=$('freeCenter').checked;
    if(editingCardId){
      const src=reviewCards[0],target=state.cards.find(c=>c.id===editingCardId);if(target){target.boardId=id;target.side=src.side;target.freeCenter=free;target.numbers=src.numbers.map((n,i)=>free&&i===12?0:Number(n));target.name=id?`Tábua ${id} · ${src.side}`:`${src.side}`;}toast('Cartela atualizada');
    }else{
      if(id&&state.cards.some(c=>c.boardId===id)&&!confirm(`Já existe uma tábua com a identificação ${id}. Salvar outra mesmo assim?`))return;
      for(const src of reviewCards){state.cards.push({id:'c_'+Date.now().toString(36)+Math.random().toString(36).slice(2,7),groupId:src.groupId,boardId:id,side:src.side,name:id?`Tábua ${id} · ${src.side}`:`${src.side}`,numbers:src.numbers.map((n,i)=>free&&i===12?0:Number(n)),freeCenter:free});}
      toast('Tábua salva com as duas cartelas');
    }
    saveState();renderHome();showView('homeView');
  };

  function primePatternDefinitions(){
    const p=[],cols=['B','I','N','G','O'];for(let r=0;r<5;r++)p.push({type:'horizontal',indexes:[0,1,2,3,4].map(c=>r*5+c),label:`Horizontal ${r+1}`});for(let c=0;c<5;c++)p.push({type:'vertical',indexes:[0,1,2,3,4].map(r=>r*5+c),label:`Vertical ${cols[c]}`});
    p.push({type:'diagonal',indexes:[0,6,12,18,24],label:'Diagonal principal'},{type:'diagonal',indexes:[4,8,12,16,20],label:'Diagonal secundária'},{type:'v',indexes:[0,6,12,8,4],label:'V para baixo'},{type:'v',indexes:[20,16,12,18,24],label:'V para cima'},{type:'v',indexes:[0,6,12,16,20],label:'V para a direita'},{type:'v',indexes:[4,8,12,18,24],label:'V para a esquerda'},{type:'corners',indexes:[0,4,20,24],label:'4 cantos'});
    if(state.primeCornerSquares)p.push({type:'corner-square',indexes:[0,1,5,6],label:'Quadradinho B/I superior'},{type:'corner-square',indexes:[3,4,8,9],label:'Quadradinho G/O superior'},{type:'corner-square',indexes:[15,16,20,21],label:'Quadradinho B/I inferior'},{type:'corner-square',indexes:[18,19,23,24],label:'Quadradinho G/O inferior'});return p;
  }
  function activePatternDefinitions(){if(state.winMode==='x')return[{type:'x',indexes:[0,4,6,8,12,16,18,20,24],label:'Forma X'}];if(state.winMode==='full')return[{type:'full',indexes:Array.from({length:25},(_,i)=>i),label:'Cartela cheia'}];return primePatternDefinitions();}
  function isIndexMarked(card,idx,set){return(card.freeCenter&&idx===12)||set.has(Number(card.numbers[idx]));}
  function getBestRemaining(card){const set=new Set(state.drawn),patterns=activePatternDefinitions();let best={remaining:25,line:patterns[0]||{indexes:[],label:'—'}};for(const line of patterns){const rem=line.indexes.filter(i=>!isIndexMarked(card,i,set)).length;if(rem<best.remaining)best={remaining:rem,line};}return best;}
  function winningLines(card){const set=new Set(state.drawn);return activePatternDefinitions().filter(line=>line.indexes.every(i=>isIndexMarked(card,i,set)));}

  function renderGame(){
    renderModeUI();const set=new Set(state.drawn);$('lastNumber').textContent=state.drawn.at(-1)??'—';$('undoBtn').disabled=!state.drawn.length;$('drawCountChip').textContent=`${state.drawn.length} pedra${state.drawn.length===1?'':'s'}`;
    const sorted=[...state.cards].sort((a,b)=>getBestRemaining(a).remaining-getBestRemaining(b).remaining);
    $('gameCards').innerHTML=sorted.map(c=>{const best=getBestRemaining(c),wins=winningLines(c),badge=wins.length?'<span class="ok-pill">BINGO</span>':best.remaining===1?'<span class="near-pill">FALTA 1</span>':`<span class="near-pill">FALTAM ${best.remaining}</span>`;return`<article class="game-card ${best.remaining===1?'near':''}"><div class="game-card-head"><div class="board-title"><span class="id-tag">ID ${esc(c.boardId||'—')}</span><strong>${esc(sideLabel(c))}</strong><small>${esc(boardLabel(c))}</small></div>${badge}</div>${renderGridHtml(c.numbers,c.freeCenter,set,wins[0]?.indexes||null)}</article>`;}).join('');
    $('drawnNumbers').innerHTML=state.drawn.length?state.drawn.map(n=>`<span class="drawn-ball">${n}</span>`).join(''):'<span class="hint">Nenhuma pedra sorteada.</span>';renderHomeCounters();
  }
  function addDraw(){
    const n=Number($('drawInput').value);$('drawError').textContent='';if(!Number.isInteger(n)||n<1||n>75){$('drawError').textContent='Digite um número de 1 a 75.';return;}if(state.drawn.includes(n)){$('drawError').textContent='Esse número já foi sorteado.';return;}
    const before=new Map(state.cards.map(c=>[c.id,winningLines(c).length]));state.drawn.push(n);saveState();$('drawInput').value='';renderGame();
    const winners=[];for(const c of state.cards){const wins=winningLines(c);if(wins.length&&!before.get(c.id))winners.push({card:c,line:wins[0]});}if(winners.length){bingoQueue.push(...winners);showNextBingo();}setTimeout(()=>$('drawInput').focus(),70);
  }
  $('startGameBtn').onclick=()=>{renderGame();showView('gameView');setTimeout(()=>$('drawInput').focus(),120);};$('endGameBtn').onclick=()=>{renderHome();showView('homeView');};$('markBtn').onclick=addDraw;$('drawInput').addEventListener('keydown',e=>{if(e.key==='Enter')addDraw();});
  $('undoBtn').onclick=()=>{if(!state.drawn.length)return;state.drawn.pop();saveState();renderGame();toast('Última pedra removida');};$('resetGameBtn').onclick=()=>{if(confirm('Zerar todas as pedras sorteadas?')){state.drawn=[];saveState();renderGame();toast('Sorteio zerado');}};
  function showNextBingo(){
    if(!$('bingoModal').classList.contains('hidden'))return;const item=bingoQueue.shift();if(!item)return;const {card,line}=item;$('bingoBoardId').textContent=card.boardId||'SEM ID';$('bingoCardName').textContent=`CARTELA ${String(sideLabel(card)).toUpperCase()}`;$('bingoLineText').textContent=`${activeModeLabel()} · ${line.label}`;$('bingoWinningGrid').innerHTML=renderGridHtml(card.numbers,card.freeCenter,new Set(state.drawn),line.indexes);$('bingoModal').classList.remove('hidden');try{navigator.vibrate?.([250,100,250,100,600]);}catch{}
  }
  $('closeBingoBtn').onclick=()=>{$('bingoModal').classList.add('hidden');setTimeout(()=>{if(bingoQueue.length)showNextBingo();else $('drawInput').focus();},120);};

  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;$('installBtn').classList.remove('hidden');});$('installBtn').onclick=async()=>{if(!deferredPrompt)return;deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;$('installBtn').classList.add('hidden');};
  if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
  renderHome();
})();
