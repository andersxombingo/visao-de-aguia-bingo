(() => {
  'use strict';

  const STORAGE_KEY = 'marca-bingo-v01'; // mantido para preservar cartelas salvas das versões anteriores
  const state = loadState();
  let sourceImage = null;
  let currentGrid = null;
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
  function toast(msg){ const t=$('toast'); t.textContent=msg; t.classList.remove('hidden'); clearTimeout(t._timer); t._timer=setTimeout(()=>t.classList.add('hidden'),2200); }
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
    box.innerHTML = state.cards.map((c,i)=>`
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
    currentGrid = [...card.numbers];
    $('freeCenter').checked = card.freeCenter;
    $('cardName').value = card.name;
    $('saveCardBtn').dataset.editId=id;
    renderReviewGrid();
    $('cropPanel').classList.add('hidden');
    $('reviewPanel').classList.remove('hidden');
    showView('captureView');
  }

  function openCapture(){
    sourceImage=null; currentGrid=null; $('photoInput').value=''; $('cropPanel').classList.add('hidden'); $('reviewPanel').classList.add('hidden'); $('saveCardBtn').dataset.editId=''; $('cardName').value=`Cartela ${state.cards.length+1}`; showView('captureView');
  }

  $('addCardBtn').onclick=openCapture;
  document.querySelectorAll('[data-back-home]').forEach(b=>b.onclick=()=>{renderHome();showView('homeView');});
  $('startGameBtn').onclick=()=>{renderGame();showView('gameView');setTimeout(()=>$('drawInput').focus(),100);};
  $('endGameBtn').onclick=()=>{renderHome();showView('homeView');};

  $('photoInput').addEventListener('change', async e => {
    const file=e.target.files?.[0]; if(!file) return;
    const img=new Image();
    img.onload=()=>{ sourceImage=img; $('cropPanel').classList.remove('hidden'); $('reviewPanel').classList.add('hidden'); drawCropPreview(); };
    img.src=URL.createObjectURL(file);
  });
  ['cropTop','cropBottom','cropLeft','cropRight'].forEach(id=>$(id).addEventListener('input',drawCropPreview));

  function cropRect(img){
    const l=+$('cropLeft').value/100, r=+$('cropRight').value/100, t=+$('cropTop').value/100, b=+$('cropBottom').value/100;
    return {x:img.naturalWidth*l,y:img.naturalHeight*t,w:img.naturalWidth*(1-l-r),h:img.naturalHeight*(1-t-b)};
  }
  function drawCropPreview(){
    if(!sourceImage) return;
    const c=$('previewCanvas'), maxW=900, scale=Math.min(1,maxW/sourceImage.naturalWidth);
    c.width=Math.round(sourceImage.naturalWidth*scale); c.height=Math.round(sourceImage.naturalHeight*scale);
    const ctx=c.getContext('2d'); ctx.drawImage(sourceImage,0,0,c.width,c.height);
    const R=cropRect(sourceImage); const sx=R.x*scale,sy=R.y*scale,sw=R.w*scale,sh=R.h*scale;
    ctx.save(); ctx.fillStyle='rgba(0,0,0,.52)'; ctx.fillRect(0,0,c.width,c.height); ctx.clearRect(sx,sy,sw,sh); ctx.drawImage(sourceImage,R.x,R.y,R.w,R.h,sx,sy,sw,sh); ctx.strokeStyle='#fbbf24'; ctx.lineWidth=4; ctx.strokeRect(sx,sy,sw,sh);
    ctx.strokeStyle='rgba(251,191,36,.75)'; ctx.lineWidth=1.5;
    for(let i=1;i<5;i++){ctx.beginPath();ctx.moveTo(sx+sw*i/5,sy);ctx.lineTo(sx+sw*i/5,sy+sh);ctx.stroke();ctx.beginPath();ctx.moveTo(sx,sy+sh*i/5);ctx.lineTo(sx+sw,sy+sh*i/5);ctx.stroke();}
    ctx.restore();
  }

  $('scanBtn').onclick = scanCard;

  async function getWorker(){
    if(ocrWorker) return ocrWorker;
    if(!window.Tesseract) throw new Error('Biblioteca de leitura não carregou. Verifique a internet.');
    ocrWorker = await Tesseract.createWorker('eng', 1, { logger: m => {
      if(m.status==='loading tesseract core' || m.status==='loading language traineddata' || m.status==='initializing api') updateOcrStatus('Preparando leitor...', Math.round((m.progress||0)*15));
    }});
    await ocrWorker.setParameters({ tessedit_char_whitelist:'0123456789', tessedit_pageseg_mode:'8', preserve_interword_spaces:'0' });
    return ocrWorker;
  }

  function updateOcrStatus(text,pct){
    const el=$('ocrStatus'); el.classList.remove('hidden'); el.innerHTML=`<strong>${esc(text)}</strong><div class="progress"><span style="width:${Math.max(0,Math.min(100,pct))}%"></span></div>`;
  }

  function makeProcessedCanvas(){
    const R=cropRect(sourceImage); const cellTarget=180; const size=cellTarget*5;
    const c=document.createElement('canvas'); c.width=size; c.height=size;
    const ctx=c.getContext('2d',{willReadFrequently:true}); ctx.drawImage(sourceImage,R.x,R.y,R.w,R.h,0,0,size,size);
    const img=ctx.getImageData(0,0,size,size), d=img.data;
    for(let i=0;i<d.length;i+=4){ const g=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2]; const v=g>165?255:0; d[i]=d[i+1]=d[i+2]=v; }
    ctx.putImageData(img,0,0);
    return c;
  }

  function parseNumber(text,col){
    const m=String(text||'').match(/\d{1,2}/); if(!m) return '';
    const n=Number(m[0]); const ranges=[[1,15],[16,30],[31,45],[46,60],[61,75]];
    if(n>=ranges[col][0] && n<=ranges[col][1]) return n;
    return n>=1&&n<=75?n:'';
  }

  async function scanCard(){
    if(!sourceImage) return;
    $('scanBtn').disabled=true; updateOcrStatus('Preparando imagem...',3);
    try{
      const worker=await getWorker(); const canvas=makeProcessedCanvas(); const cell=canvas.width/5; const result=Array(25).fill(''); const free=$('freeCenter').checked;
      let done=0;
      for(let row=0;row<5;row++){
        for(let col=0;col<5;col++){
          const idx=row*5+col;
          if(free && idx===12){ result[idx]='FREE'; done++; continue; }
          updateOcrStatus(`Lendo número ${done+1} de ${free?24:25}...`, 15+Math.round((done/(free?24:25))*82));
          const pad=14;
          const ret=await worker.recognize(canvas,{rectangle:{left:Math.round(col*cell+pad),top:Math.round(row*cell+pad),width:Math.round(cell-pad*2),height:Math.round(cell-pad*2)}});
          result[idx]=parseNumber(ret.data.text,col); done++;
        }
      }
      currentGrid=result; updateOcrStatus('Leitura concluída. Confira os números.',100); renderReviewGrid(); $('reviewPanel').classList.remove('hidden'); $('cardName').value=`Cartela ${state.cards.length+1}`; setTimeout(()=>$('reviewPanel').scrollIntoView({behavior:'smooth'}),180);
    }catch(err){ console.error(err); updateOcrStatus('Não foi possível ler automaticamente. Você ainda pode preencher os números manualmente.',100); currentGrid=Array(25).fill(''); if($('freeCenter').checked) currentGrid[12]='FREE'; renderReviewGrid(); $('reviewPanel').classList.remove('hidden'); }
    finally{$('scanBtn').disabled=false;}
  }

  function renderReviewGrid(){
    const free=$('freeCenter').checked;
    if(!currentGrid) currentGrid=Array(25).fill('');
    if(free) currentGrid[12]='FREE'; else if(currentGrid[12]==='FREE') currentGrid[12]='';
    const ranges=[[1,15],[16,30],[31,45],[46,60],[61,75]];
    $('reviewGrid').innerHTML=currentGrid.map((n,idx)=>{
      if(free&&idx===12) return `<div class="bingo-cell free">★</div>`;
      const col=idx%5; const num=Number(n); const valid=Number.isInteger(num)&&num>=ranges[col][0]&&num<=ranges[col][1];
      return `<div class="bingo-cell ${n!==''&&!valid?'invalid':''}"><input data-cell="${idx}" inputmode="numeric" type="number" min="${ranges[col][0]}" max="${ranges[col][1]}" value="${esc(n)}"></div>`;
    }).join('');
    $('reviewGrid').querySelectorAll('input').forEach(inp=>inp.addEventListener('input',()=>{currentGrid[+inp.dataset.cell]=inp.value===''?'':Number(inp.value);validateGrid();}));
    validateGrid();
  }
  $('freeCenter').addEventListener('change',()=>{ if(currentGrid) renderReviewGrid(); });

  function validateGrid(){
    if(!currentGrid) return false;
    const free=$('freeCenter').checked, ranges=[[1,15],[16,30],[31,45],[46,60],[61,75]], messages=[]; let ok=true;
    for(let idx=0;idx<25;idx++){
      if(free&&idx===12) continue;
      const col=idx%5,n=Number(currentGrid[idx]);
      if(!Number.isInteger(n)||n<ranges[col][0]||n>ranges[col][1]){ok=false;messages.push(`Posição ${idx+1}: use ${ranges[col][0]}–${ranges[col][1]}.`);}
    }
    const nums=currentGrid.filter((n,idx)=>!(free&&idx===12)).map(Number).filter(Number.isFinite); if(new Set(nums).size!==nums.length){ok=false;messages.push('Há números repetidos na cartela.');}
    const badge=$('validationBadge'); badge.textContent=ok?'Cartela válida':'Precisa corrigir'; badge.className='badge '+(ok?'ok':'bad'); $('validationMessages').textContent=messages.slice(0,4).join(' '); $('saveCardBtn').disabled=!ok; return ok;
  }

  $('saveCardBtn').onclick=()=>{
    if(!validateGrid()) return;
    const free=$('freeCenter').checked, nums=currentGrid.map((n,idx)=>free&&idx===12?0:Number(n)); const name=$('cardName').value.trim()||`Cartela ${state.cards.length+1}`; const editId=$('saveCardBtn').dataset.editId;
    if(editId){ const c=state.cards.find(c=>c.id===editId); if(c){c.name=name;c.numbers=nums;c.freeCenter=free;} }
    else state.cards.push({id:'c_'+Date.now().toString(36)+Math.random().toString(36).slice(2,6),name,numbers:nums,freeCenter:free});
    saveState(); toast(editId?'Cartela atualizada':'Cartela salva'); renderHome(); showView('homeView');
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

  renderHome();
})();
