(() => {
  'use strict';

  const STATE_KEY = 'marca-bingo-v01';
  const PHOTO_KEY = 'marca-bingo-photo-v01';
  const VIEW_KEY = 'marca-bingo-view-v01';
  const INITIAL_VISIBLE = 12;
  const LOAD_STEP = 12;

  const gameCards = document.getElementById('gameCards');
  if (!gameCards) return;

  let visibleCount = INITIAL_VISIBLE;
  let rankedItems = [];
  let currentMode = localStorage.getItem(VIEW_KEY) || 'grid';

  const esc = (s) => String(s ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const clean = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const normalizeSide = (s) => /esquerda/i.test(String(s || '')) ? 'esquerda' : /direita/i.test(String(s || '')) ? 'direita' : clean(s);

  function injectStyles(){
    const style = document.createElement('style');
    style.textContent = `
      .photo-mode-toolbar{display:grid;gap:10px;margin:0 0 12px}
      .photo-mode-toolbar .top{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap}
      .view-toggle{display:inline-flex;gap:8px;background:rgba(15,23,42,.72);border:1px solid #334155;padding:6px;border-radius:16px}
      .view-toggle button{border:0;background:transparent;color:#cbd5e1;padding:10px 14px;border-radius:12px;font-weight:900}
      .view-toggle button.active{background:linear-gradient(135deg,#6d28d9,#a855f7);color:#fff;box-shadow:0 10px 24px rgba(124,58,237,.25)}
      .cards-meta{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
      .cards-summary{font-size:12px;color:#cbd5e1}
      .cards-summary small{display:block;color:#94a3b8;font-size:11px;margin-top:2px}
      .show-more-cards{border:1px solid #334155;background:#111827;color:#fff;border-radius:14px;padding:11px 14px;font-weight:900}
      .game-card-badges{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
      .marked-count-pill{padding:6px 8px;border-radius:999px;background:#0f2a44;color:#93c5fd;font-size:10px;font-weight:900;border:1px solid #1d4ed8}
      .photo-card-stage{position:relative;overflow:hidden;border-radius:16px;border:1px solid #334155;background:#020617;aspect-ratio:1/1;box-shadow:inset 0 0 0 1px rgba(255,255,255,.03)}
      .photo-card-stage img{display:block;width:100%;height:100%;object-fit:cover}
      .photo-marker{position:absolute;transform:translate(-50%,-50%);width:12.5%;aspect-ratio:1/1;border-radius:999px;background:rgba(29,78,216,.32);border:2px solid rgba(147,197,253,.95);box-shadow:0 0 0 3px rgba(29,78,216,.15)}
      .photo-marker::after{content:'';position:absolute;inset:20%;border-radius:999px;background:rgba(255,255,255,.18)}
      .photo-marker.winning{background:rgba(245,158,11,.40);border-color:#fcd34d;box-shadow:0 0 0 4px rgba(245,158,11,.18),0 0 18px rgba(245,158,11,.28)}
      .photo-fallback-note,.photo-legend{font-size:11px;color:#94a3b8;margin-top:10px;line-height:1.4}
      .photo-grid-fallback{margin-top:12px}
      @media (max-width:560px){.view-toggle{width:100%}.view-toggle button{flex:1}.photo-marker{width:13.2%}}
    `;
    document.head.appendChild(style);
  }

  function readJson(key, fallback){
    try { return Object.assign({}, fallback, JSON.parse(localStorage.getItem(key) || '{}')); }
    catch { return fallback; }
  }
  function readState(){
    try { return JSON.parse(localStorage.getItem(STATE_KEY) || '{}') || {}; }
    catch { return {}; }
  }
  function readPhotos(){
    try { return JSON.parse(localStorage.getItem(PHOTO_KEY) || '{}') || {}; }
    catch { return {}; }
  }
  function savePhotos(obj){ localStorage.setItem(PHOTO_KEY, JSON.stringify(obj)); }
  function saveView(mode){ localStorage.setItem(VIEW_KEY, mode); }

  function signature(boardId, side, numbers){
    const nums = (numbers || []).map(n => String(n ?? '').trim()).join('-');
    return `${clean(boardId)}|${normalizeSide(side)}|${nums}`;
  }
  function fallbackKey(boardId, side){ return `${clean(boardId)}|${normalizeSide(side)}`; }

  function reviewCardsFromDom(){
    return [...document.querySelectorAll('#reviewCards .review-card-block')].map(block => {
      const side = block.querySelector('h3')?.textContent?.trim() || 'Cartela';
      const numbers = [...block.querySelectorAll('.bingo-grid.editor .bingo-cell')].map(cell => {
        const input = cell.querySelector('input');
        if (input) {
          const v = input.value.trim();
          return v === '' ? '' : Number(v);
        }
        return cell.classList.contains('free') ? 0 : '';
      });
      return { side, numbers };
    });
  }

  function detectPhotoRects(canvas){
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const { width, height } = canvas;
    const img = ctx.getImageData(0, 0, width, height).data;
    const left = { minX: Infinity, minY: Infinity, maxX: -1, maxY: -1 };
    const right = { minX: Infinity, minY: Infinity, maxX: -1, maxY: -1 };

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const r = img[i], g = img[i + 1], b = img[i + 2];
        if (g > 150 && r < 130 && b < 130 && (g - r) > 45 && (g - b) > 45) {
          const box = x < width / 2 ? left : right;
          if (x < box.minX) box.minX = x;
          if (x > box.maxX) box.maxX = x;
          if (y < box.minY) box.minY = y;
          if (y > box.maxY) box.maxY = y;
        }
      }
    }

    const normalize = (rect) => {
      if (rect.maxX < 0 || rect.maxY < 0) return null;
      const inset = 4;
      const minX = Math.max(0, rect.minX + inset);
      const minY = Math.max(0, rect.minY + 12); // ignora o rótulo ESQUERDA/DIREITA se entrar no box
      const maxX = Math.min(width, rect.maxX - inset);
      const maxY = Math.min(height, rect.maxY - inset);
      const w = maxX - minX;
      const h = maxY - minY;
      if (w < width * 0.15 || h < height * 0.15) return null;
      return { x: minX, y: minY, w, h };
    };

    return { left: normalize(left), right: normalize(right) };
  }

  function cropCanvas(canvas, rect){
    if (!rect) return '';
    const crop = document.createElement('canvas');
    crop.width = 700;
    crop.height = Math.round(crop.width * (rect.h / rect.w));
    crop.getContext('2d').drawImage(canvas, rect.x, rect.y, rect.w, rect.h, 0, 0, crop.width, crop.height);
    return crop.toDataURL('image/jpeg', 0.85);
  }

  function captureReviewPhotos(){
    const saveBtn = document.getElementById('saveBoardBtn');
    const reviewPanel = document.getElementById('reviewPanel');
    const previewCanvas = document.getElementById('previewCanvas');
    const boardId = document.getElementById('boardIdInput')?.value?.trim() || '';
    if (!saveBtn || saveBtn.disabled || !reviewPanel || reviewPanel.classList.contains('hidden') || !previewCanvas || !previewCanvas.width) return;

    const reviewCards = reviewCardsFromDom();
    if (!reviewCards.length) return;

    const rects = detectPhotoRects(previewCanvas);
    if (!rects.left && !rects.right) return;

    const leftImage = cropCanvas(previewCanvas, rects.left);
    const rightImage = cropCanvas(previewCanvas, rects.right);
    const store = readPhotos();

    reviewCards.forEach(card => {
      const side = normalizeSide(card.side);
      const image = side === 'esquerda' ? leftImage : rightImage;
      if (!image) return;
      const item = { boardId, side: card.side, numbers: card.numbers, image, savedAt: Date.now() };
      store[signature(boardId, card.side, card.numbers)] = item;
      store[fallbackKey(boardId, card.side)] = item;
    });

    savePhotos(store);
  }

  function stripTags(s){ return String(s || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim(); }

  function parseGameItems(html){
    const fragments = String(html || '').match(/<article class="game-card[\s\S]*?<\/article>/g) || [];
    const photos = readPhotos();

    rankedItems = fragments.map((fragment, idx) => {
      const boardId = (fragment.match(/<span class="id-tag">ID\s+([^<]*)<\/span>/i) || [,'—'])[1].trim();
      const strongs = [...fragment.matchAll(/<strong>(.*?)<\/strong>/g)].map(m => stripTags(m[1]));
      const side = strongs[0] || 'Cartela';
      const label = stripTags((fragment.match(/<small>(.*?)<\/small>/i) || [,''])[1]);
      const cells = [...fragment.matchAll(/<div class="bingo-cell ([^"]*)">([\s\S]*?)<\/div>/g)];
      const numbers = [];
      const markedIndexes = [];
      const winningIndexes = [];

      cells.forEach((m, cellIdx) => {
        const classes = m[1] || '';
        const content = stripTags(m[2]);
        const isFree = classes.includes('free');
        numbers.push(isFree ? 0 : (content === '' ? '' : Number(content)));
        if (classes.includes('marked') && !isFree) markedIndexes.push(cellIdx);
        if (classes.includes('winning') && !isFree) winningIndexes.push(cellIdx);
      });

      const markedCount = markedIndexes.length;
      let remaining = 99;
      let statusHtml = (fragment.match(/<(span) class="(ok-pill|near-pill)">([\s\S]*?)<\/span>/i) || [,'','',''])[0];
      if (/class="ok-pill">BINGO/i.test(fragment)) remaining = 0;
      else if (/FALTA\s+1/i.test(fragment)) remaining = 1;
      else {
        const rem = fragment.match(/FALTAM\s+(\d+)/i);
        remaining = rem ? Number(rem[1]) : 99;
      }
      if (!statusHtml) statusHtml = `<span class="near-pill">FALTAM ${remaining}</span>`;

      const photo = photos[signature(boardId, side, numbers)] || photos[fallbackKey(boardId, side)] || null;
      return { fragment, boardId, side, label, numbers, markedIndexes, winningIndexes, markedCount, remaining, statusHtml, photo, idx };
    }).sort((a, b) => {
      if (b.markedCount !== a.markedCount) return b.markedCount - a.markedCount;
      if (a.remaining !== b.remaining) return a.remaining - b.remaining;
      return a.idx - b.idx;
    });
  }

  function renderMarkers(item){
    return item.markedIndexes.map(idx => {
      const row = Math.floor(idx / 5);
      const col = idx % 5;
      const left = (col + 0.5) * 20;
      const top = (row + 0.5) * 20;
      const winning = item.winningIndexes.includes(idx) ? ' winning' : '';
      return `<span class="photo-marker${winning}" style="left:${left}%;top:${top}%"></span>`;
    }).join('');
  }

  function renderPhotoItem(item){
    const nearClass = item.remaining === 1 ? ' near' : '';
    const imageStage = item.photo
      ? `<div class="photo-card-stage"><img src="${item.photo.image}" alt="Foto da cartela ${esc(item.side)}"><div class="photo-overlay">${renderMarkers(item)}</div></div><div class="photo-legend">Foto salva da cartela. As marcações seguem as mesmas pedras digitadas no outro modo.</div>`
      : `<div class="photo-fallback-note">Foto desta cartela ainda não foi salva. Ela pode ter sido cadastrada antes deste modo novo. Você ainda pode usar o modo de grade normalmente.</div><div class="photo-grid-fallback">${item.fragment.replace(/<article class="game-card[^"]*">|<\/article>/g, '')}</div>`;

    return `<article class="game-card photo-card${nearClass}">
      <div class="game-card-head">
        <div class="board-title"><span class="id-tag">ID ${esc(item.boardId || '—')}</span><strong>${esc(item.side)}</strong><small>${esc(item.label)}</small></div>
        <div class="game-card-badges"><span class="marked-count-pill">${item.markedCount} marcado${item.markedCount === 1 ? '' : 's'}</span>${item.statusHtml}</div>
      </div>
      ${imageStage}
    </article>`;
  }

  function renderGridItem(item){
    const badgeBlock = `<div class="game-card-badges"><span class="marked-count-pill">${item.markedCount} marcado${item.markedCount === 1 ? '' : 's'}</span>${item.statusHtml}</div>`;
    return item.fragment.replace(/(<div class="game-card-head">[\s\S]*?<\/div>)(\s*<div class="bingo-grid">)/, `$1${badgeBlock}$2`);
  }

  const nativeDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  const nativeSet = nativeDescriptor.set;
  const nativeGet = nativeDescriptor.get;

  function updateToolbar(){
    summary.innerHTML = rankedItems.length
      ? `Mostrando <strong>${Math.min(visibleCount, rankedItems.length)}</strong> de <strong>${rankedItems.length}</strong> cartelas<small>Mais marcadas primeiro. Você pode alternar entre grade e foto a qualquer momento.</small>`
      : 'Nenhuma cartela para mostrar';

    btnGrid.classList.toggle('active', currentMode === 'grid');
    btnPhoto.classList.toggle('active', currentMode === 'photo');

    if (rankedItems.length > visibleCount) {
      moreBtn.classList.remove('hidden');
      moreBtn.textContent = `Mostrar mais (+${Math.min(LOAD_STEP, rankedItems.length - visibleCount)})`;
      moreBtn.dataset.mode = 'more';
    } else if (rankedItems.length > INITIAL_VISIBLE && visibleCount > INITIAL_VISIBLE) {
      moreBtn.classList.remove('hidden');
      moreBtn.textContent = 'Mostrar menos';
      moreBtn.dataset.mode = 'less';
    } else {
      moreBtn.classList.add('hidden');
      moreBtn.dataset.mode = '';
    }
  }

  function rerender(){
    const visible = rankedItems.slice(0, visibleCount);
    const html = currentMode === 'photo'
      ? visible.map(renderPhotoItem).join('')
      : visible.map(renderGridItem).join('');
    nativeSet.call(gameCards, html);
    updateToolbar();
  }

  Object.defineProperty(gameCards, 'innerHTML', {
    configurable: true,
    enumerable: true,
    get(){ return nativeGet.call(gameCards); },
    set(value){ parseGameItems(value); rerender(); }
  });

  injectStyles();

  const toolbar = document.createElement('div');
  toolbar.className = 'photo-mode-toolbar';
  toolbar.innerHTML = `
    <div class="top">
      <div class="view-toggle">
        <button type="button" id="cardsGridModeBtn">Grade</button>
        <button type="button" id="cardsPhotoModeBtn">Foto</button>
      </div>
      <button type="button" id="showMoreCardsBtn" class="show-more-cards hidden">Mostrar mais</button>
    </div>
    <div class="cards-meta">
      <div id="cardsSummary" class="cards-summary">Cartelas prontas</div>
    </div>
  `;
  gameCards.parentNode.insertBefore(toolbar, gameCards);

  const btnGrid = document.getElementById('cardsGridModeBtn');
  const btnPhoto = document.getElementById('cardsPhotoModeBtn');
  const moreBtn = document.getElementById('showMoreCardsBtn');
  const summary = document.getElementById('cardsSummary');

  btnGrid.addEventListener('click', () => { currentMode = 'grid'; saveView(currentMode); rerender(); });
  btnPhoto.addEventListener('click', () => { currentMode = 'photo'; saveView(currentMode); rerender(); });
  moreBtn.addEventListener('click', () => {
    if (moreBtn.dataset.mode === 'less') {
      visibleCount = INITIAL_VISIBLE;
      rerender();
      gameCards.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    visibleCount = Math.min(rankedItems.length, visibleCount + LOAD_STEP);
    rerender();
  });

  const startBtn = document.getElementById('startGameBtn');
  if (startBtn) startBtn.addEventListener('click', () => { visibleCount = INITIAL_VISIBLE; });

  document.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'saveBoardBtn') captureReviewPhotos();
  }, true);
})();
