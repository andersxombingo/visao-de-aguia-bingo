(() => {
  'use strict';

  const INITIAL_VISIBLE = 12;
  const LOAD_STEP = 12;
  let visibleCount = INITIAL_VISIBLE;
  let rankedCards = [];

  const box = document.getElementById('gameCards');
  if (!box) return;

  const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  if (!descriptor || !descriptor.get || !descriptor.set) return;

  const nativeGet = descriptor.get;
  const nativeSet = descriptor.set;

  const toolbar = document.createElement('div');
  toolbar.className = 'game-list-toolbar';
  toolbar.innerHTML = `
    <div>
      <strong id="gameCardsSummary">Cartelas em destaque</strong>
      <small>Mais números marcados sempre ficam primeiro.</small>
    </div>
    <button id="showMoreCardsBtn" class="show-more-cards hidden" type="button">Mostrar mais</button>
  `;
  box.parentNode.insertBefore(toolbar, box);

  const summary = toolbar.querySelector('#gameCardsSummary');
  const moreBtn = toolbar.querySelector('#showMoreCardsBtn');

  function countMarked(fragment) {
    const cells = fragment.match(/class="bingo-cell[^"]*\bmarked\b[^"]*"/g) || [];
    const free = cells.filter(item => /\bfree\b/.test(item)).length;
    return Math.max(0, cells.length - free);
  }

  function getRemaining(fragment) {
    if (/class="ok-pill">BINGO</.test(fragment)) return 0;
    if (/class="near-pill">FALTA 1</.test(fragment)) return 1;
    const match = fragment.match(/class="near-pill">FALTAM\s+(\d+)</);
    return match ? Number(match[1]) : 99;
  }

  function addMarkedBadge(fragment, marked) {
    if (/class="marked-count-pill"/.test(fragment)) return fragment;
    const badgePattern = /(<span class="(?:ok-pill|near-pill)">[\s\S]*?<\/span>)(<\/div><div class="bingo-grid">)/;
    return fragment.replace(
      badgePattern,
      `<div class="game-card-badges"><span class="marked-count-pill">${marked} marcado${marked === 1 ? '' : 's'}</span>$1</div>$2`
    );
  }

  function parseAndRank(html) {
    const fragments = String(html || '').match(/<article class="game-card[\s\S]*?<\/article>/g) || [];
    rankedCards = fragments.map((fragment, index) => {
      const marked = countMarked(fragment);
      const remaining = getRemaining(fragment);
      return { html: addMarkedBadge(fragment, marked), marked, remaining, index };
    }).sort((a, b) => {
      if (b.marked !== a.marked) return b.marked - a.marked;
      if (a.remaining !== b.remaining) return a.remaining - b.remaining;
      return a.index - b.index;
    });
  }

  function updateToolbar() {
    const total = rankedCards.length;
    const showing = Math.min(visibleCount, total);
    summary.textContent = total
      ? `Mostrando ${showing} de ${total} cartelas`
      : 'Nenhuma cartela para mostrar';

    if (total > visibleCount) {
      moreBtn.classList.remove('hidden');
      moreBtn.textContent = `Mostrar mais (+${Math.min(LOAD_STEP, total - visibleCount)})`;
      moreBtn.dataset.action = 'more';
    } else if (total > INITIAL_VISIBLE && visibleCount > INITIAL_VISIBLE) {
      moreBtn.classList.remove('hidden');
      moreBtn.textContent = 'Mostrar menos';
      moreBtn.dataset.action = 'less';
    } else {
      moreBtn.classList.add('hidden');
      moreBtn.dataset.action = '';
    }
  }

  function renderVisible() {
    nativeSet.call(box, rankedCards.slice(0, visibleCount).map(item => item.html).join(''));
    updateToolbar();
  }

  Object.defineProperty(box, 'innerHTML', {
    configurable: true,
    enumerable: true,
    get() { return nativeGet.call(box); },
    set(html) {
      parseAndRank(html);
      renderVisible();
    }
  });

  moreBtn.addEventListener('click', () => {
    if (moreBtn.dataset.action === 'less') {
      visibleCount = INITIAL_VISIBLE;
      renderVisible();
      box.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    visibleCount = Math.min(rankedCards.length, visibleCount + LOAD_STEP);
    renderVisible();
  });

  const startBtn = document.getElementById('startGameBtn');
  if (startBtn) startBtn.addEventListener('click', () => { visibleCount = INITIAL_VISIBLE; });

  document.documentElement.classList.add('ranking-v08-ready');
})();
