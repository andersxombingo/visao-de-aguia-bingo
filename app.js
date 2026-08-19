(() => {
  'use strict';

  const STORAGE_KEY = 'marca-bingo-v01'; // preserva cartelas das versões anteriores
  const state = loadState();
  let sourceImage = null;
  let reviewCards = [];
  let editingCardId = '';
  let deferredPrompt = null;
  let ocrWorker = null;

  const $ = (id) => document.getElementById(id);
  const views = ['homeView','captureView','gameView'];

  function defaultState(){ return { cards: [], drawn: [], winMode: 'prime', primeCornerSquares: false }; }
  function loadState(){
    try { return Object.assign(defaultState(), JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')); }
    catch { return defaultState(); }
  }
  function saveState(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  function showView(id){ views.forEach(v => $(v).classList.toggle('active', v === id)); window.scrollTo({top:0,behavior:'smooth'}); }
  function toast(msg){ const t=$('toast'); t.textContent=msg; t.classList.remove('hidden'); clearTimeout(t._timer); t._timer=setTimeout(()=>t.classList.add('hidden'),2400); }
  function esc(s){ return String(s ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

  const MODE_LABELS = { prime: 'Modo Prime', x: 'Modo X', full: 'Cartela cheia' };

  function activeModeLabel(){
    if(state.winMode === 'prime' && state.primeCornerSquares) return 'Modo Prime + quadrinhos 2×2';
    return MODE_LABELS[state.winMode] || 'Modo Prime';
  }

  function renderModeControls(){
    const homeSelect=$('winModeHome');
    if(homeSelect && homeSelect.value!==state.winMode) homeSelect.value=state.winMode;
    const homeToggle=$('primeSquaresHome');
    if(homeToggle) homeToggle.checked=Boolean(state.primeCornerSquares);
    const wrap=$('primeSquaresWrap');
    if(wrap) wrap.classList.toggle('hidden', state.winMode!=='prime');
    const guide=$('primeSquaresGuide');
    if(guide) guide.classList.toggle('hidden', state.winMode!=='prime');
    const help=$('modeHelp');
    if(help){
      help.textContent = state.winMode==='prime'
        ? `Vale horizontal, vertical, 2 diagonais, 4 cantos e os 4 formatos de V${state.primeCornerSquares?' + 1 dos 4 quadradinhos de canto (4 números juntos)':''}.`
        : state.winMode==='x'
          ? 'Vale o X completo: as duas diagonais precisam estar marcadas.'
          : 'Vale cartela cheia: todos os espaços da cartela precisam estar marcados.';
    }
    const gameLabel=$('currentModeLabel');
    if(gameLabel) gameLabel.textContent=activeModeLabel();
  }

  function setWinMode(mode){
    if(!['prime','x','full'].includes(mode)) mode='prime';
    state.winMode=mode;
    saveState();
    renderModeControls();
    renderHomeCountersOnly();
    if($('gameView')?.classList.contains('active')) renderGame();
  }

  function renderHome(){
    renderModeControls();
    $('cardCount').textContent = state.cards.length;
    $('drawCount').textContent = state.drawn.length;
    $('nearCount').textContent = state.cards.filter(c => getBestRemaining(c).remaining === 1).length;
    $('startGameBtn').disabled = state.cards.length === 0;
    const box = $('cardsList');
    if(!state.cards.length){ box.className='cards-list empty-state'; box.textContent='Nenhuma cartela adicionada.'; return; }
    box.className='cards-list';
    box.innerHTML = state.cards.map(c=>`
      <article class="saved-card">
        <div class="saved-card-head">
          <div><strong>${esc(c.name)}</strong><div class="hint">${c.freeCenter?'Centro livre':'Sem centro livre'}</div></div>
          <div class="mini-actions"><button class="mini-btn" data-edit="${c.id}">Editar</button><button class="mini-btn danger" data-delete="${c.id}">Excluir</button></div>
        </div>
        ${renderGridHtml(c.numbers,c.freeCenter,new Set(),null)}
      </article>`).join('');
    box.querySelectorAll('[data-delete]').forEach(btn=>btn.onclick=()=>{
      const id=btn.dataset.delete;
      if(confirm('Excluir esta cartela?')){ state.cards=state.cards.filter(c=>c.id!==id); saveState(); renderHome(); }
    });
    box.querySelectorAll('[data-edit]').forEach(btn=>btn.onclick=()=>editCard(btn.dataset.edit));
  }

  function renderGridHtml(numbers,freeCenter,drawnSet,winningLine){
    return `<div class="bingo-grid">${numbers.map((n,idx)=>{
      const isFree = freeCenter && idx===12;
      const marked = isFree || drawnSet.has(Number(n));
      const winning = winningLine && winningLine.includes(idx);
      return `<div class="bingo-cell ${isFree?'free':''} ${marked?'marked':''} ${winning?'winning':''}">${isFree?'★':esc(n)}</div>`;
    }).join('')}</div>`;
  }

  function editCard(id){
    const card=state.cards.find(c=>c.id===id); if(!card) return;
    sourceImage=null;
    editingCardId=id;
    reviewCards=[{name:card.name,numbers:[...card.numbers],freeCenter:card.freeCenter,side:'edit'}];
    $('freeCenter').checked=card.freeCenter;
    $('photoInput').value='';
    $('cropPanel').classList.add('hidden');
    $('reviewPanel').classList.remove('hidden');
    renderReviewCards();
    showView('captureView');
  }

  function resetCropDefaults(){
    $('cropTop').value='8'; $('cropBottom').value='5'; $('cropLeft').value='4'; $('cropRight').value='4';
  }

  function openCapture(){
    sourceImage=null; reviewCards=[]; editingCardId=''; $('photoInput').value=''; $('freeCenter').checked=true; resetCropDefaults();
    $('cropPanel').classList.add('hidden'); $('reviewPanel').classList.add('hidden'); $('ocrStatus').classList.add('hidden');
    $('cardLayout').value='dual'; updateLayoutCopy(); showView('captureView');
  }

  $('addCardBtn').onclick=openCapture;
  document.querySelectorAll('[data-back-home]').forEach(b=>b.onclick=()=>{renderHome();showView('homeView');});
  $('startGameBtn').onclick=()=>{renderGame();showView('gameView');setTimeout(()=>$('drawInput').focus(),100);};
  $('endGameBtn').onclick=()=>{renderHome();showView('homeView');};

  $('cardLayout').addEventListener('change',()=>{ updateLayoutCopy(); drawCropPreview(); });
  function updateLayoutCopy(){
    const dual=$('cardLayout').value==='dual';
    $('cropTitle').textContent=dual?'Ajustar o papel completo':'Ajustar a grade 5×5';
    $('cropHint').textContent=dual
      ? 'Deixe dentro do retângulo amarelo o papel inteiro com as duas cartelas. As duas grades verdes devem cair em cima dos números — o BINGO do topo e a faixa do meio ficam fora das grades verdes.'
      : 'Deixe dentro do retângulo apenas a grade 5×5 com os números.';
    $('scanBtn').textContent=dual?'Ler as 2 cartelas':'Ler números da cartela';
  }

  $('photoInput').addEventListener('change', async e => {
    const file=e.target.files?.[0]; if(!file) return;
    const img=new Image();
    img.onload=()=>{
      sourceImage=img; editingCardId=''; reviewCards=[];
      $('cropPanel').classList.remove('hidden'); $('reviewPanel').classList.add('hidden'); $('ocrStatus').classList.add('hidden');
      drawCropPreview();
    };
    img.src=URL.createObjectURL(file);
  });
  ['cropTop','cropBottom','cropLeft','cropRight'].forEach(id=>$(id).addEventListener('input',drawCropPreview));

  function cropRect(img){
    const l=+$('cropLeft').value/100, r=+$('cropRight').value/100, t=+$('cropTop').value/100, b=+$('cropBottom').value/100;
    return {x:img.naturalWidth*l,y:img.naturalHeight*t,w:img.naturalWidth*(1-l-r),h:img.naturalHeight*(1-t-b)};
  }

  function dualGridRects(R){
    // Modelo real enviado pelo usuário: duas grades 5×5 no mesmo papel,
    // separadas por uma faixa vertical central. Os números começam abaixo do cabeçalho BINGO.
    const y=R.y+R.h*0.155;
    const h=R.h*0.82;
    return [
      {x:R.x+R.w*0.020,y,w:R.w*0.405,h,label:'Esquerda'},
      {x:R.x+R.w*0.578,y,w:R.w*0.405,h,label:'Direita'}
    ];
  }

  function singleGridRects(R){ return [{x:R.x,y:R.y,w:R.w,h:R.h,label:'Cartela'}]; }
  function activeGridRects(R){ return $('cardLayout').value==='dual'?dualGridRects(R):singleGridRects(R); }

  function drawGridOverlay(ctx,rect,scale,label){
    const sx=rect.x*scale, sy=rect.y*scale, sw=rect.w*scale, sh=rect.h*scale;
    ctx.save();
    ctx.strokeStyle='#22c55e'; ctx.lineWidth=3; ctx.strokeRect(sx,sy,sw,sh);
    ctx.strokeStyle='rgba(34,197,94,.82)'; ctx.lineWidth=1.4;
    for(let i=1;i<5;i++){
      ctx.beginPath();ctx.moveTo(sx+sw*i/5,sy);ctx.lineTo(sx+sw*i/5,sy+sh);ctx.stroke();
      ctx.beginPath();ctx.moveTo(sx,sy+sh*i/5);ctx.lineTo(sx+sw,sy+sh*i/5);ctx.stroke();
    }
    ctx.fillStyle='rgba(13,7,24,.88)'; ctx.fillRect(sx+4,sy+4,Math.min(82,sw-8),22);
    ctx.fillStyle='#86efac'; ctx.font='bold 12px system-ui'; ctx.fillText(label,sx+9,sy+19);
    ctx.restore();
  }

  function drawCropPreview(){
    if(!sourceImage) return;
    const c=$('previewCanvas'), maxW=900, scale=Math.min(1,maxW/sourceImage.naturalWidth);
    c.width=Math.round(sourceImage.naturalWidth*scale); c.height=Math.round(sourceImage.naturalHeight*scale);
    const ctx=c.getContext('2d'); ctx.drawImage(sourceImage,0,0,c.width,c.height);
    const R=cropRect(sourceImage); const sx=R.x*scale,sy=R.y*scale,sw=R.w*scale,sh=R.h*scale;
    ctx.save(); ctx.fillStyle='rgba(0,0,0,.52)'; ctx.fillRect(0,0,c.width,c.height); ctx.clearRect(sx,sy,sw,sh); ctx.drawImage(sourceImage,R.x,R.y,R.w,R.h,sx,sy,sw,sh);
    ctx.strokeStyle='#fbbf24'; ctx.lineWidth=4; ctx.strokeRect(sx,sy,sw,sh); ctx.restore();
    activeGridRects(R).forEach(g=>drawGridOverlay(ctx,g,scale,g.label));
  }

  $('scanBtn').onclick = scanCard;

  async function getWorker(){
    if(ocrWorker) return ocrWorker;
    if(!window.Tesseract) throw new Error('Biblioteca de leitura não carregou. Verifique a internet.');
    ocrWorker = await Tesseract.createWorker('eng', 1, { logger: m => {
      if(m.status==='loading tesseract core' || m.status==='loading language traineddata' || m.status==='initializing api') updateOcrStatus('Preparando leitor...', Math.round((m.progress||0)*12));
    }});
    await ocrWorker.setParameters({ tessedit_char_whitelist:'0123456789', tessedit_pageseg_mode:'8', preserve_interword_spaces:'0' });
    return ocrWorker;
  }

  function updateOcrStatus(text,pct){
    const el=$('ocrStatus'); el.classList.remove('hidden'); el.innerHTML=`<strong>${esc(text)}</strong><div class="progress"><span style="width:${Math.max(0,Math.min(100,pct))}%"></span></div>`;
  }

  function otsuThreshold(gray){
    const hist=new Array(256).fill(0); for(const v of gray) hist[v]++;
    const total=gray.length; let sum=0; for(let i=0;i<256;i++) sum+=i*hist[i];
    let sumB=0,wB=0,maxVar=-1,threshold=150;
    for(let t=0;t<256;t++){
      wB+=hist[t]; if(!wB) continue; const wF=total-wB; if(!wF) break;
      sumB+=t*hist[t]; const mB=sumB/wB,mF=(sum-sumB)/wF; const between=wB*wF*(mB-mF)*(mB-mF);
      if(between>maxVar){maxVar=between;threshold=t;}
    }
    return Math.max(95,Math.min(205,threshold));
  }

  function makeCellCanvas(gridRect,row,col,variant='binary'){
    const cellW=gridRect.w/5, cellH=gridRect.h/5;
    // corta as linhas impressas da grade para o OCR enxergar só os dígitos
    const padX=cellW*0.13, padY=cellH*0.13;
    const sx=gridRect.x+col*cellW+padX, sy=gridRect.y+row*cellH+padY;
    const sw=cellW-padX*2, sh=cellH-padY*2;
    const c=document.createElement('canvas'); c.width=300; c.height=240;
    const ctx=c.getContext('2d',{willReadFrequently:true}); ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);
    ctx.imageSmoothingEnabled=true; ctx.imageSmoothingQuality='high'; ctx.drawImage(sourceImage,sx,sy,sw,sh,20,20,c.width-40,c.height-40);
    const img=ctx.getImageData(0,0,c.width,c.height), d=img.data, gray=new Uint8Array(c.width*c.height);
    for(let i=0,j=0;i<d.length;i+=4,j++){
      let g=Math.round(0.299*d[i]+0.587*d[i+1]+0.114*d[i+2]);
      // amplia contraste contra os fundos coloridos das cartelas
      g=Math.max(0,Math.min(255,(g-128)*1.45+128)); gray[j]=g;
    }
    const th=otsuThreshold(gray);
    for(let i=0,j=0;i<d.length;i+=4,j++){
      let v;
      if(variant==='gray') v=gray[j];
      else v=gray[j] < th ? 0 : 255;
      d[i]=d[i+1]=d[i+2]=v; d[i+3]=255;
    }
    ctx.putImageData(img,0,0); return c;
  }

  function parseNumber(text,col){
    const matches=String(text||'').match(/\d{1,2}/g)||[];
    const ranges=[[1,15],[16,30],[31,45],[46,60],[61,75]];
    for(const token of matches){ const n=Number(token); if(n>=ranges[col][0]&&n<=ranges[col][1]) return n; }
    return '';
  }

  async function recognizeCell(worker,gridRect,row,col){
    let ret=await worker.recognize(makeCellCanvas(gridRect,row,col,'binary'));
    let value=parseNumber(ret.data.text,col);
    if(value!=='') return value;
    // Segunda tentativa só quando a leitura binária falhar.
    ret=await worker.recognize(makeCellCanvas(gridRect,row,col,'gray'));
    return parseNumber(ret.data.text,col);
  }

  async function scanOneGrid(worker,gridRect,gridIndex,totalGrids,free){
    const result=Array(25).fill(''); let done=0; const totalCells=totalGrids*(free?24:25);
    for(let row=0;row<5;row++){
      for(let col=0;col<5;col++){
        const idx=row*5+col;
        if(free && idx===12){ result[idx]=0; continue; }
        const overallDone=gridIndex*(free?24:25)+done;
        updateOcrStatus(`Lendo ${gridRect.label.toLowerCase()} · número ${done+1} de ${free?24:25}...`,12+Math.round((overallDone/totalCells)*86));
        result[idx]=await recognizeCell(worker,gridRect,row,col); done++;
      }
    }
    return result;
  }

  async function scanCard(){
    if(!sourceImage) return;
    $('scanBtn').disabled=true; updateOcrStatus('Preparando imagem...',3);
    try{
      const worker=await getWorker(); const R=cropRect(sourceImage); const rects=activeGridRects(R); const free=$('freeCenter').checked;
      const base=rects.length===2?Math.floor(state.cards.length/2)+1:state.cards.length+1; const cards=[];
      for(let i=0;i<rects.length;i++){
        const numbers=await scanOneGrid(worker,rects[i],i,rects.length,free);
        const suffix=rects.length===2?(i===0?'A':'B'):'';
        cards.push({name:`Cartela ${base}${suffix}`,numbers,freeCenter:free,side:rects[i].label});
      }
      reviewCards=cards; updateOcrStatus('Leitura concluída. Confira os números em vermelho ou vazios.',100); renderReviewCards(); $('reviewPanel').classList.remove('hidden');
      setTimeout(()=>$('reviewPanel').scrollIntoView({behavior:'smooth'}),180);
    }catch(err){
      console.error(err); updateOcrStatus('Não foi possível ler automaticamente. Você ainda pode preencher os números manualmente.',100);
      const dual=$('cardLayout').value==='dual'; const count=dual?2:1; const base=count===2?Math.floor(state.cards.length/2)+1:state.cards.length+1;
      reviewCards=Array.from({length:count},(_,i)=>({name:`Cartela ${base}${count===2?(i===0?'A':'B'):''}`,numbers:Array(25).fill(''),freeCenter:$('freeCenter').checked,side:count===2?(i===0?'Esquerda':'Direita'):'Cartela'}));
      reviewCards.forEach(c=>{if(c.freeCenter)c.numbers[12]=0;}); renderReviewCards(); $('reviewPanel').classList.remove('hidden');
    } finally { $('scanBtn').disabled=false; }
  }

  function validateCardData(card){
    const ranges=[[1,15],[16,30],[31,45],[46,60],[61,75]], messages=[]; let ok=true;
    for(let idx=0;idx<25;idx++){
      if(card.freeCenter&&idx===12) continue;
      const col=idx%5,n=Number(card.numbers[idx]);
      if(!Number.isInteger(n)||n<ranges[col][0]||n>ranges[col][1]){ok=false;messages.push(`Posição ${idx+1}: use ${ranges[col][0]}–${ranges[col][1]}.`);}
    }
    const nums=card.numbers.filter((_,idx)=>!(card.freeCenter&&idx===12)).map(Number).filter(n=>Number.isInteger(n));
    if(new Set(nums).size!==nums.length){ok=false;messages.push('Há números repetidos.');}
    return {ok,messages};
  }

  function renderReviewCards(){
    const box=$('reviewCards');
    box.innerHTML=reviewCards.map((card,ci)=>{
      const valid=validateCardData(card);
      const ranges=[[1,15],[16,30],[31,45],[46,60],[61,75]];
      const grid=card.numbers.map((n,idx)=>{
        if(card.freeCenter&&idx===12) return `<div class="bingo-cell free">★</div>`;
        const col=idx%5,num=Number(n), cellOk=Number.isInteger(num)&&num>=ranges[col][0]&&num<=ranges[col][1];
        return `<div class="bingo-cell ${n!==''&&!cellOk?'invalid':''} ${n===''?'missing':''}"><input data-card="${ci}" data-cell="${idx}" inputmode="numeric" type="number" min="${ranges[col][0]}" max="${ranges[col][1]}" value="${esc(n)}"></div>`;
      }).join('');
      return `<section class="review-card-block">
        <div class="section-title-row review-card-head"><div><div class="eyebrow">${esc(card.side||'CARTELA')}</div><h3>${esc(card.name)}</h3></div><span class="badge ${valid.ok?'ok':'bad'}">${valid.ok?'Cartela válida':'Precisa corrigir'}</span></div>
        <div class="bingo-head-row"><span>B</span><span>I</span><span>N</span><span>G</span><span>O</span></div>
        <div class="bingo-grid editor">${grid}</div>
        <div class="validation-messages">${esc(valid.messages.slice(0,3).join(' '))}</div>
        <div class="form-row"><label>Nome da cartela<input data-name-card="${ci}" type="text" maxlength="40" value="${esc(card.name)}"></label></div>
      </section>`;
    }).join('');

    box.querySelectorAll('input[data-cell]').forEach(inp=>{
      inp.addEventListener('input',()=>{ const ci=+inp.dataset.card, idx=+inp.dataset.cell; reviewCards[ci].numbers[idx]=inp.value===''?'':Number(inp.value); });
      inp.addEventListener('change',()=>renderReviewCards());
    });
    box.querySelectorAll('input[data-name-card]').forEach(inp=>inp.addEventListener('input',()=>{reviewCards[+inp.dataset.nameCard].name=inp.value;}));

    const allOk=reviewCards.length>0&&reviewCards.every(c=>validateCardData(c).ok);
    $('saveCardBtn').disabled=!allOk;
    $('saveCardBtn').textContent=editingCardId?'Salvar alterações':reviewCards.length===2?'Salvar as 2 cartelas':'Salvar cartela';
    const readCount=reviewCards.reduce((sum,c)=>sum+c.numbers.filter((n,idx)=>!(c.freeCenter&&idx===12)&&n!=='').length,0);
    const expected=reviewCards.reduce((sum,c)=>sum+(c.freeCenter?24:25),0);
    $('reviewSummary').textContent=`${readCount} de ${expected} números reconhecidos. Os que faltarem podem ser corrigidos tocando na célula.`;
  }

  $('freeCenter').addEventListener('change',()=>{ if(reviewCards.length){ reviewCards.forEach(c=>{c.freeCenter=$('freeCenter').checked;if(c.freeCenter)c.numbers[12]=0;}); renderReviewCards(); } });

  $('saveCardBtn').onclick=()=>{
    if(!reviewCards.length||!reviewCards.every(c=>validateCardData(c).ok)) return;
    if(editingCardId){
      const target=state.cards.find(c=>c.id===editingCardId), src=reviewCards[0];
      if(target){target.name=src.name.trim()||target.name;target.numbers=src.numbers.map((n,idx)=>src.freeCenter&&idx===12?0:Number(n));target.freeCenter=src.freeCenter;}
      toast('Cartela atualizada');
    } else {
      reviewCards.forEach(src=>state.cards.push({
        id:'c_'+Date.now().toString(36)+Math.random().toString(36).slice(2,7),
        name:src.name.trim()||`Cartela ${state.cards.length+1}`,
        numbers:src.numbers.map((n,idx)=>src.freeCenter&&idx===12?0:Number(n)),
        freeCenter:src.freeCenter
      }));
      toast(reviewCards.length===2?'2 cartelas salvas':'Cartela salva');
    }
    saveState(); renderHome(); showView('homeView');
  };

  function primePatternDefinitions(){
    const patterns=[];
    const columnNames=['B','I','N','G','O'];
    for(let r=0;r<5;r++) patterns.push({type:'horizontal',indexes:[0,1,2,3,4].map(c=>r*5+c),label:`Horizontal ${r+1}`});
    for(let c=0;c<5;c++) patterns.push({type:'vertical',indexes:[0,1,2,3,4].map(r=>r*5+c),label:`Vertical ${columnNames[c]}`});
    patterns.push({type:'diagonal',indexes:[0,6,12,18,24],label:'Diagonal principal'});
    patterns.push({type:'diagonal',indexes:[4,8,12,16,20],label:'Diagonal secundária'});
    patterns.push({type:'v',indexes:[0,6,12,8,4],label:'V para baixo'});
    patterns.push({type:'v',indexes:[20,16,12,18,24],label:'V para cima'});
    patterns.push({type:'v',indexes:[0,6,12,16,20],label:'V para a direita'});
    patterns.push({type:'v',indexes:[4,8,12,18,24],label:'V para a esquerda'});
    patterns.push({type:'corners',indexes:[0,4,20,24],label:'4 cantos'});
    if(state.primeCornerSquares){
      patterns.push({type:'corner-square',indexes:[0,1,5,6],label:'Quadradinho B/I superior (B1 I1 B2 I2)'});
      patterns.push({type:'corner-square',indexes:[3,4,8,9],label:'Quadradinho G/O superior (G1 O1 G2 O2)'});
      patterns.push({type:'corner-square',indexes:[15,16,20,21],label:'Quadradinho B/I inferior (B4 I4 B5 I5)'});
      patterns.push({type:'corner-square',indexes:[18,19,23,24],label:'Quadradinho G/O inferior (G4 O4 G5 O5)'});
    }
    return patterns;
  }

  function activePatternDefinitions(){
    if(state.winMode==='x') return [{type:'x',indexes:[0,4,6,8,12,16,18,20,24],label:'Forma X'}];
    if(state.winMode==='full') return [{type:'full',indexes:Array.from({length:25},(_,i)=>i),label:'Cartela cheia'}];
    return primePatternDefinitions();
  }

  function isIndexMarked(card,idx,drawnSet){ return (card.freeCenter&&idx===12)||drawnSet.has(Number(card.numbers[idx])); }
  function getBestRemaining(card){
    const set=new Set(state.drawn); const patterns=activePatternDefinitions();
    let best={remaining:25,line:patterns[0]||{indexes:[],label:'—'}};
    for(const line of patterns){ const rem=line.indexes.filter(i=>!isIndexMarked(card,i,set)).length; if(rem<best.remaining) best={remaining:rem,line}; }
    return best;
  }
  function winningLines(card){ const set=new Set(state.drawn); return activePatternDefinitions().filter(line=>line.indexes.every(i=>isIndexMarked(card,i,set))); }

  function renderGame(){
    renderModeControls();
    $('lastNumber').textContent=state.drawn.length?state.drawn[state.drawn.length-1]:'—'; $('undoBtn').disabled=!state.drawn.length; const drawnSet=new Set(state.drawn);
    const sorted=[...state.cards].sort((a,b)=>getBestRemaining(a).remaining-getBestRemaining(b).remaining);
    $('gameCards').innerHTML=sorted.map(c=>{ const best=getBestRemaining(c); const wins=winningLines(c); const badge=wins.length?`<span class="ok-pill">BINGO</span>`:best.remaining===1?`<span class="near-pill">Falta 1</span>`:`<span class="near-pill">Faltam ${best.remaining}</span>`; return `<article class="game-card ${best.remaining===1?'near':''}"><div class="game-card-head"><strong>${esc(c.name)}</strong>${badge}</div>${renderGridHtml(c.numbers,c.freeCenter,drawnSet,wins[0]?.indexes||null)}</article>`; }).join('');
    $('drawnNumbers').innerHTML=state.drawn.length?state.drawn.map(n=>`<span class="drawn-ball">${n}</span>`).join(''):'<span class="hint">Nenhuma pedra sorteada.</span>';
    renderHomeCountersOnly();
  }
  function renderHomeCountersOnly(){ $('drawCount').textContent=state.drawn.length; $('nearCount').textContent=state.cards.filter(c=>getBestRemaining(c).remaining===1).length; }

  function addDraw(){
    const n=Number($('drawInput').value); $('drawError').textContent='';
    if(!Number.isInteger(n)||n<1||n>75){$('drawError').textContent='Digite um número de 1 a 75.';return;}
    if(state.drawn.includes(n)){$('drawError').textContent='Esse número já foi sorteado.';return;}
    const before=new Map(state.cards.map(c=>[c.id,winningLines(c).length])); state.drawn.push(n); saveState(); $('drawInput').value=''; renderGame();
    const newWinners=[]; for(const c of state.cards){ const wins=winningLines(c); if(wins.length && !before.get(c.id)) newWinners.push({card:c,line:wins[0]}); }
    if(newWinners.length) showBingo(newWinners[0]); setTimeout(()=>$('drawInput').focus(),50);
  }
  $('markBtn').onclick=addDraw; $('drawInput').addEventListener('keydown',e=>{if(e.key==='Enter')addDraw();});
  $('undoBtn').onclick=()=>{if(!state.drawn.length)return;state.drawn.pop();saveState();renderGame();toast('Última pedra removida');};
  $('resetGameBtn').onclick=()=>{if(confirm('Zerar todas as pedras sorteadas?')){state.drawn=[];saveState();renderGame();toast('Sorteio zerado');}};

  function showBingo({card,line}){
    $('bingoCardName').textContent=card.name; $('bingoLineText').textContent=`${activeModeLabel()} · ${line.label}`; $('bingoWinningGrid').innerHTML=renderGridHtml(card.numbers,card.freeCenter,new Set(state.drawn),line.indexes); $('bingoModal').classList.remove('hidden');
    try{ if(navigator.vibrate) navigator.vibrate([250,120,250,120,500]); }catch{}
  }
  $('closeBingoBtn').onclick=()=>{$('bingoModal').classList.add('hidden');$('drawInput').focus();};

  $('winModeHome').addEventListener('change',e=>setWinMode(e.target.value));
  $('primeSquaresHome').addEventListener('change',e=>{
    state.primeCornerSquares=Boolean(e.target.checked);
    saveState(); renderModeControls(); renderHomeCountersOnly();
    if($('gameView')?.classList.contains('active')) renderGame();
  });

  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;$('installBtn').classList.remove('hidden');});
  $('installBtn').onclick=async()=>{if(!deferredPrompt)return;deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;$('installBtn').classList.add('hidden');};
  if('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));

  updateLayoutCopy(); renderHome();
})();
