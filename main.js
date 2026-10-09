'use strict';

/* =========================================================
 * 潜水艦あてゲーム
 * 画面の流れ: タイトル → 配置フェーズ → 攻撃フェーズ → 判定（結果）
 *
 * 盤面は 36 要素の配列で表す（添字 k = 行 * 6 + 列）
 *   船の盤面   : 0 = 何もない / 2〜5 = その長さの船
 *   予想盤面   : 0 = 空白 / 2〜5 = 書き込んだ数字 / X(-1) = 「船なし」
 * ========================================================= */

// ===== 定数・小さな関数 =====
const SIZE = 6;
const COLS = 'ABCDEF';
const SHIP_LENS = [2, 3, 4, 5];
const X = -1;            // 予想盤面の「×（船なし）」
const CPU_DELAY = 800;   // CPU の 1 手ごとの間（ミリ秒）
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]]; // 上下左右（斜めは含めない）

const idx = (r, c) => r * SIZE + c;
const rowOf = k => Math.floor(k / SIZE);
const colOf = k => k % SIZE;
const inside = (r, c) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;
const coordName = k => COLS[colOf(k)] + (rowOf(k) + 1);   // 例: 0 → "A1"
const randItem = arr => arr[Math.floor(Math.random() * arr.length)];
const $ = id => document.getElementById(id);

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// マス k の上下左右のマス番号
function neighbors(k) {
  const r = rowOf(k), c = colOf(k), res = [];
  for (const [dr, dc] of DIRS) if (inside(r + dr, c + dc)) res.push(idx(r + dr, c + dc));
  return res;
}

// 船が占める [行, 列] の一覧（r, c は船の左上）
function shipCells(len, horiz, r, c) {
  const cells = [];
  for (let i = 0; i < len; i++) cells.push(horiz ? [r, c + i] : [r + i, c]);
  return cells;
}

// 盤面 board に船を置けるか（はみ出し・重なり・縦横の隣接をチェック）
function canPlace(board, len, horiz, r, c) {
  for (const [rr, cc] of shipCells(len, horiz, r, c)) {
    if (!inside(rr, cc)) return false;
    const k = idx(rr, cc);
    if (board[k]) return false;
    if (neighbors(k).some(n => board[n])) return false;
  }
  return true;
}

/* =========================================================
 * 配置パターンの全列挙
 * CPU の推理（残りうる配置の絞り込み）とランダム配置に使う
 * ========================================================= */

// POS[len] = その長さの船を置ける全位置
// 36 マスを lo(0〜17) / hi(18〜35) の 2 つのビット列に分けて高速に判定する
const POS = {};
const SHIFT = { 2: 0, 3: 6, 4: 12, 5: 18 }; // 1 つの配置を整数に詰めるときのビット位置

function toBits(list) {
  let lo = 0, hi = 0;
  for (const k of list) {
    if (k < 18) lo |= 1 << k;
    else hi |= 1 << (k - 18);
  }
  return [lo, hi];
}
const hasBit = (p, k) => (k < 18 ? (p.lo >> k) & 1 : (p.hi >> (k - 18)) & 1);

for (const len of SHIP_LENS) {
  POS[len] = [];
  for (const horiz of [true, false]) {
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const cells = shipCells(len, horiz, r, c);
        if (!cells.every(([rr, cc]) => inside(rr, cc))) continue;
        const ks = cells.map(([rr, cc]) => idx(rr, cc));
        // 他の船が入れない範囲 = 自分のマス + 上下左右
        const area = new Set(ks);
        ks.forEach(k => neighbors(k).forEach(n => area.add(n)));
        const [lo, hi] = toBits(ks);
        const [blo, bhi] = toBits([...area]);
        POS[len].push({ len, horiz, r, c, cells: ks, lo, hi, blo, bhi });
      }
    }
  }
}

// ルール上ありえる 4 隻の配置をすべて列挙（1 配置 = 4 つの位置番号を詰めた整数）
const ALL_LAYOUTS = (() => {
  const out = [];
  const P2 = POS[2], P3 = POS[3], P4 = POS[4], P5 = POS[5];
  for (let a = 0; a < P5.length; a++) {
    const p5 = P5[a];
    for (let b = 0; b < P4.length; b++) {
      const p4 = P4[b];
      if ((p4.lo & p5.blo) | (p4.hi & p5.bhi)) continue;
      const lo2 = p5.blo | p4.blo, hi2 = p5.bhi | p4.bhi;
      for (let c = 0; c < P3.length; c++) {
        const p3 = P3[c];
        if ((p3.lo & lo2) | (p3.hi & hi2)) continue;
        const lo3 = lo2 | p3.blo, hi3 = hi2 | p3.bhi;
        for (let d = 0; d < P2.length; d++) {
          const p2 = P2[d];
          if ((p2.lo & lo3) | (p2.hi & hi3)) continue;
          out.push(d | (c << 6) | (b << 12) | (a << 18));
        }
      }
    }
  }
  return Int32Array.from(out);
})();

const layoutShips = code => SHIP_LENS.map(len => POS[len][(code >> SHIFT[len]) & 63]);

function layoutToBoard(code) {
  const board = Array(36).fill(0);
  for (const p of layoutShips(code)) p.cells.forEach(k => (board[k] = p.len));
  return board;
}

// 配置 code のマス k に何の船があるか（なければ 0）
function layoutValueAt(code, k) {
  for (const len of SHIP_LENS) {
    if (hasBit(POS[len][(code >> SHIFT[len]) & 63], k)) return len;
  }
  return 0;
}

/* =========================================================
 * 盤面の表示（共通）
 * ========================================================= */

// ラベル付きの 6×6 盤面を host の中に作る
function makeBoard(host) {
  host.innerHTML = '';
  const wrap = el('div', 'board-wrap');
  const colLabels = el('div', 'col-labels');
  const rowLabels = el('div', 'row-labels');
  for (let i = 0; i < SIZE; i++) {
    colLabels.append(el('span', '', COLS[i]));
    rowLabels.append(el('span', '', i + 1));
  }
  const board = el('div', 'board');
  const cells = [];
  for (let k = 0; k < 36; k++) {
    const cell = el('div', 'cell');
    cell.dataset.k = k;
    board.append(cell);
    cells.push(cell);
  }
  wrap.append(colLabels, rowLabels, board);
  host.append(wrap);
  return { board, cells };
}

// 予想盤面の値をマスに描く
function paintValueCell(cell, v, locked) {
  cell.classList.remove('v2', 'v3', 'v4', 'v5', 'vx', 'locked');
  cell.textContent = '';
  if (v > 0) {
    cell.classList.add('v' + v);
    cell.textContent = v;
  } else if (v === X) {
    cell.classList.add('vx');
    cell.textContent = '×';
  }
  if (locked) cell.classList.add('locked');
}

// 船の盤面をマスに描く（船のマスを塗る）
function paintShipBoard(view, board) {
  view.cells.forEach((cell, k) => {
    if (board[k]) cell.classList.add('ship' + board[k]);
  });
}

/* =========================================================
 * 画面切り替え・ダイアログ
 * ========================================================= */

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
}

// buttons: [{ label, primary, onClick }]
function showModal(html, buttons) {
  $('modal-body').innerHTML = html;
  const box = $('modal-buttons');
  box.innerHTML = '';
  for (const b of buttons) {
    const btn = el('button', 'btn' + (b.primary ? ' primary' : ''), b.label);
    btn.onclick = () => {
      $('modal').classList.add('hidden');
      if (b.onClick) b.onClick();
    };
    box.append(btn);
  }
  $('modal').classList.remove('hidden');
}

/* =========================================================
 * 配置フェーズ
 * ========================================================= */

const place = {
  ships: {},   // ships[len] = { horiz, r, c }（r が null ならトレイにある）
  view: null,  // 配置用グリッド
  drag: null,  // ドラッグ中の情報
};

function startPlacement() {
  for (const len of SHIP_LENS) place.ships[len] = { horiz: true, r: null, c: null };
  place.view = makeBoard($('place-board-host'));
  buildTray();
  renderPlacement();
  showScreen('screen-place');
}

// 現在グリッドに置かれている船から盤面配列を作る
function placedBoard() {
  const b = Array(36).fill(0);
  for (const len of SHIP_LENS) {
    const s = place.ships[len];
    if (s.r === null) continue;
    shipCells(len, s.horiz, s.r, s.c).forEach(([r, c]) => (b[idx(r, c)] = len));
  }
  return b;
}

// トレイ（船置き場）を作る：船 1 隻ごとに枠と回転ボタン
function buildTray() {
  const tray = $('tray');
  tray.innerHTML = '';
  for (const len of SHIP_LENS) {
    const slot = el('div', 'slot');
    const holder = el('div', 'holder');
    holder.id = 'holder-' + len;
    const rot = el('button', 'btn small', '回転');
    rot.id = 'rot-' + len;
    rot.onclick = () => {
      place.ships[len].horiz = !place.ships[len].horiz;
      renderPlacement();
    };
    slot.append(el('div', 'slot-label', len + 'マス'), holder, rot);
    tray.append(slot);
  }
}

function makeShipEl(len, horiz) {
  const e = el('div', 'ship ' + (horiz ? 'horizontal' : 'vertical'));
  e.dataset.len = len;
  for (let i = 0; i < len; i++) e.append(el('div', 'ship-cell'));
  return e;
}

// 船の状態に合わせてグリッドとトレイを描き直す
function renderPlacement() {
  const { board } = place.view;
  board.querySelectorAll('.ship').forEach(e => e.remove());
  let allPlaced = true;

  for (const len of SHIP_LENS) {
    const s = place.ships[len];
    const holder = $('holder-' + len);
    holder.innerHTML = '';
    const shipEl = makeShipEl(len, s.horiz);
    shipEl.addEventListener('pointerdown', e => startDrag(e, len, shipEl));

    if (s.r !== null) {
      // グリッド上：位置とサイズを % で指定して重ねる
      shipEl.classList.add('placed');
      shipEl.style.left = (s.c / SIZE) * 100 + '%';
      shipEl.style.top = (s.r / SIZE) * 100 + '%';
      shipEl.style.width = ((s.horiz ? len : 1) / SIZE) * 100 + '%';
      shipEl.style.height = ((s.horiz ? 1 : len) / SIZE) * 100 + '%';
      board.append(shipEl);
      $('rot-' + len).style.visibility = 'hidden'; // 置いた船は回転不可
    } else {
      holder.append(shipEl);
      $('rot-' + len).style.visibility = 'visible';
      allPlaced = false;
    }
  }
  $('btn-place-ok').disabled = !allPlaced;
}

// --- ドラッグ＆ドロップ（マウス・タッチ共通で Pointer Events を使う） ---
function startDrag(e, len, shipEl) {
  if (place.drag) return;
  e.preventDefault();
  const s = place.ships[len];
  const rect = shipEl.getBoundingClientRect();
  const unit = (s.horiz ? rect.width : rect.height) / len; // 今見えている 1 マスの大きさ

  // つかんだ位置を「船の左上から何マス分か」で覚えておく
  const gx = (e.clientX - rect.left) / unit;
  const gy = (e.clientY - rect.top) / unit;

  s.r = s.c = null; // 盤面から一旦外す
  shipEl.classList.add('drag-source');

  // 指に追従する船（グリッドの 1 マスと同じ大きさで表示）
  const gridCell = place.view.board.clientWidth / SIZE;
  const ghost = makeShipEl(len, s.horiz);
  ghost.classList.add('ghost');
  ghost.style.setProperty('--cell', gridCell + 'px');
  document.body.append(ghost);

  // 他の船があって置けないマス（船のマスとその上下左右）を赤くする
  const b = placedBoard();
  place.view.cells.forEach((cell, k) =>
    cell.classList.toggle('blocked', !!b[k] || neighbors(k).some(n => b[n])));

  place.drag = { len, ghost, gx, gy, gridCell, target: null };
  moveDrag(e);
  window.addEventListener('pointermove', moveDrag);
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
}

function moveDrag(e) {
  const d = place.drag;
  if (!d) return;
  const left = e.clientX - d.gx * d.gridCell;
  const top = e.clientY - d.gy * d.gridCell;
  d.ghost.style.left = left + 'px';
  d.ghost.style.top = top + 'px';

  // 船の左上がどのマスに一番近いか
  const board = place.view.board;
  const br = board.getBoundingClientRect();
  const c = Math.round((left - br.left - board.clientLeft) / d.gridCell);
  const r = Math.round((top - br.top - board.clientTop) / d.gridCell);

  const s = place.ships[d.len];
  const cells = shipCells(d.len, s.horiz, r, c);
  place.view.cells.forEach(cell => cell.classList.remove('preview-ok', 'preview-ng'));
  d.target = null;

  if (cells.some(([rr, cc]) => inside(rr, cc))) {
    const ok = canPlace(placedBoard(), d.len, s.horiz, r, c);
    for (const [rr, cc] of cells) {
      if (inside(rr, cc)) place.view.cells[idx(rr, cc)].classList.add(ok ? 'preview-ok' : 'preview-ng');
    }
    if (ok) d.target = { r, c };
  }
}

function endDrag() {
  const d = place.drag;
  if (!d) return;
  window.removeEventListener('pointermove', moveDrag);
  window.removeEventListener('pointerup', endDrag);
  window.removeEventListener('pointercancel', endDrag);

  // 置ける場所なら確定、置けなければトレイに戻る（r = null のまま）
  if (d.target) {
    place.ships[d.len].r = d.target.r;
    place.ships[d.len].c = d.target.c;
  }
  d.ghost.remove();
  place.view.cells.forEach(cell => cell.classList.remove('blocked', 'preview-ok', 'preview-ng'));
  place.drag = null;
  renderPlacement();
}

function randomPlacement() {
  for (const p of layoutShips(randItem(ALL_LAYOUTS))) {
    place.ships[p.len] = { horiz: p.horiz, r: p.r, c: p.c };
  }
  renderPlacement();
}

function resetPlacement() {
  for (const len of SHIP_LENS) place.ships[len].r = place.ships[len].c = null;
  renderPlacement();
}

/* =========================================================
 * 攻撃フェーズ
 * ========================================================= */

let level = 'normal';
let game = null;
let gameCount = 0; // 古いゲームのタイマーを無効にするための番号

function startBattle() {
  game = {
    id: ++gameCount,
    myBoard: placedBoard(),                          // 自分の配置
    cpuBoard: layoutToBoard(randItem(ALL_LAYOUTS)),  // CPU の配置（全パターンから一様に選ぶ）
    guess: Array(36).fill(0),                        // 自分の予想盤面
    locked: Array(36).fill(false),                   // 質問済み（確定）マス
    cpuKnown: Array(36).fill(null),                  // CPU が質問して知った情報
    candidates: ALL_LAYOUTS,                         // CPU から見て残っている配置候補
    turn: 'player',
    over: false,
    tool: 'ask',
  };
  game.guessView = makeBoard($('guess-board-host'));
  game.miniView = makeBoard($('mini-board-host'));
  paintShipBoard(game.miniView, game.myBoard);
  setupGuessInput();
  selectTool('ask');
  $('log').innerHTML = '';
  showScreen('screen-attack');
  addLog('system', '', `対戦開始！（CPU：${{ weak: '弱い', normal: '普通', strong: '強い' }[level]}）`);
  startPlayerTurn();
}

// ターン表示
function setStatus(who, msg) {
  const label = $('turn-label');
  label.textContent = who === 'player' ? 'あなたのターン' : 'CPUのターン';
  label.className = 'turn-label ' + who;
  $('turn-msg').textContent = msg;
}

function addLog(who, name, text) {
  const li = el('li', who);
  if (name) li.append(el('span', 'who', name));
  li.append(document.createTextNode(text));
  const log = $('log');
  log.append(li);
  log.scrollTop = log.scrollHeight;
}

// 一定時間後に fn を実行（ゲームが変わっていたら実行しない）
function later(fn) {
  const id = game.id;
  setTimeout(() => {
    if (game && game.id === id && !game.over) fn();
  }, CPU_DELAY);
}

function startPlayerTurn() {
  game.turn = 'player';
  $('btn-declare').disabled = false;
  setStatus('player', '「質問」を選んでマスをタップ');
}

function startCpuTurn() {
  game.turn = 'cpu';
  $('btn-declare').disabled = true;
  setStatus('cpu', 'CPUが考えています…');
  later(cpuStep);
}

// --- 予想盤面への書き込み ---
function selectTool(tool) {
  game.tool = tool;
  document.querySelectorAll('#toolbar .tool').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
  game.guessView.board.classList.toggle('ask-mode', tool === 'ask');
}

function setupGuessInput() {
  const board = game.guessView.board;
  let painting = false;
  let last = null; // 前回のポインタ位置

  // 画面上の座標 (x, y) にあるマスを探す
  const cellAt = (x, y) => {
    const t = document.elementFromPoint(x, y);
    const cell = t && t.closest('.cell');
    return cell && board.contains(cell) ? cell : null;
  };

  board.addEventListener('pointerdown', e => {
    const cell = cellAt(e.clientX, e.clientY);
    if (!cell) return;
    e.preventDefault();
    const k = +cell.dataset.k;
    if (game.tool === 'ask') {
      playerAsk(k);
      return;
    }
    painting = true;
    last = { x: e.clientX, y: e.clientY };
    board.setPointerCapture(e.pointerId);
    paint(k);
  });
  board.addEventListener('pointermove', e => {
    if (!painting) return;
    // 素早くなぞってもマスが飛ばないよう、前回位置との間も細かくたどって塗る
    const step = board.clientWidth / SIZE / 4;
    const dx = e.clientX - last.x, dy = e.clientY - last.y;
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / step));
    for (let i = 1; i <= n; i++) {
      const cell = cellAt(last.x + (dx * i) / n, last.y + (dy * i) / n);
      if (cell) paint(+cell.dataset.k);
    }
    last = { x: e.clientX, y: e.clientY };
  });
  const stop = () => (painting = false);
  board.addEventListener('pointerup', stop);
  board.addEventListener('pointercancel', stop);
}

// 選択中のツールでマスに書き込む（確定マスは変更不可、既存の値は上書き）
function paint(k) {
  if (game.locked[k]) return;
  const t = game.tool;
  game.guess[k] = t === 'x' ? X : t === 'erase' ? 0 : +t;
  paintValueCell(game.guessView.cells[k], game.guess[k], false);
}

// --- プレイヤーの質問 ---
function playerAsk(k) {
  if (game.over || game.turn !== 'player') return;
  if (game.locked[k]) {
    setStatus('player', `${coordName(k)} は質問済みです`);
    return;
  }
  const v = game.cpuBoard[k];
  // 回答を自動で書き込み、そのマスをロック
  game.guess[k] = v || X;
  game.locked[k] = true;
  paintValueCell(game.guessView.cells[k], game.guess[k], true);
  addLog('player', 'あなた', `${coordName(k)} → ${v ? v + 'マスの船（命中！）' : 'ハズレ'}`);

  if (v) setStatus('player', '命中！続けて質問できます');
  else startCpuTurn();
}

// --- プレイヤーの「わかった」宣言 ---
function validateGuess(guess) {
  const errors = [];
  for (const len of SHIP_LENS) {
    const cells = [];
    guess.forEach((v, k) => v === len && cells.push(k));
    if (cells.length === 0) errors.push(`${len}の船が書かれていません`);
    else if (!isStraightShip(cells, len)) errors.push(`${len}の船の長さ・形が正しくありません（${cells.length}マス）`);
  }
  // 異なる数字同士が上下左右で接していないか
  const touching = [];
  for (let k = 0; k < 36; k++) {
    const v = guess[k];
    if (v <= 0) continue;
    for (const n of neighbors(k)) {
      if (n > k && guess[n] > 0 && guess[n] !== v) touching.push(`${coordName(k)}と${coordName(n)}`);
    }
  }
  if (touching.length) errors.push(`船同士が隣接しています（${touching.join('、')}）`);
  return errors;
}

// cells が長さ len のまっすぐ連続した並びか
function isStraightShip(cells, len) {
  if (cells.length !== len) return false;
  const rows = cells.map(rowOf), cols = cells.map(colOf);
  const sameRow = rows.every(r => r === rows[0]);
  const sameCol = cols.every(c => c === cols[0]);
  const line = sameRow ? cols : sameCol ? rows : null;
  if (!line) return false;
  return Math.max(...line) - Math.min(...line) === len - 1;
}

function playerDeclare() {
  if (game.over || game.turn !== 'player') return;
  const errors = validateGuess(game.guess);
  const html = errors.length
    ? `<ul>${errors.map(e => `<li>${e}</li>`).join('')}</ul><p>ですが「わかった」宣言をしますか？</p>`
    : '<p>「わかった」宣言をしますか？</p>';
  showModal(html, [
    { label: 'いいえ' },
    {
      label: 'はい', primary: true, onClick: () => {
        game.over = true;
        addLog('player', 'あなた', '「わかった」宣言！');
        showResult('player');
      },
    },
  ]);
}

/* =========================================================
 * CPU
 * ========================================================= */

function cpuStep() {
  // 宣言できる状態なら宣言する
  const answer = cpuDeclareCheck();
  if (answer !== null) {
    cpuDeclare(answer);
    return;
  }

  const k = chooseCpuCell();
  const v = game.myBoard[k];
  game.cpuKnown[k] = v;
  // 回答と矛盾する配置候補を消す
  game.candidates = game.candidates.filter(code => layoutValueAt(code, k) === v);

  // 自分の盤面に印をつける
  const cell = game.miniView.cells[k];
  cell.classList.add(v ? 'hit' : 'miss');
  cell.textContent = v ? '✕' : '•';
  addLog('cpu', 'CPU', `${coordName(k)} → ${v ? v + 'マスの船（命中！）' : 'ハズレ'}`);

  if (v) {
    setStatus('cpu', 'CPUが命中！続けて質問します');
    later(cpuStep);
  } else {
    startPlayerTurn();
  }
}

// 宣言するなら答えの配置 code を、しないなら null を返す
function cpuDeclareCheck() {
  const cand = game.candidates;
  const unknownLeft = game.cpuKnown.some(v => v === null);
  if (cand.length === 1 || !unknownLeft) return cand[0];
  // 弱い CPU は候補がまだ少し残っていても当てずっぽうで宣言する
  if (level === 'weak' && cand.length <= 4) return randItem(cand);
  return null;
}

function cpuDeclare(code) {
  game.over = true;
  addLog('cpu', 'CPU', '「わかった」宣言！');
  setStatus('cpu', 'CPUが「わかった」宣言！');
  showModal('<p>CPUが「わかった」宣言をしました！</p>', [
    { label: '答え合わせへ', primary: true, onClick: () => showResult('cpu', layoutToBoard(code)) },
  ]);
}

function chooseCpuCell() {
  const unknown = [];
  game.cpuKnown.forEach((v, k) => v === null && unknown.push(k));
  if (level === 'weak') return randItem(unknown);
  if (level === 'normal') return chooseNormal(unknown);
  return chooseStrong(unknown);
}

// 普通：命中したマスの周りを優先し、ルール上ありえないマスは避ける
function chooseNormal(unknown) {
  const K = game.cpuKnown;
  const hits = { 2: [], 3: [], 4: [], 5: [] };
  K.forEach((v, k) => v > 0 && hits[v].push(k));

  // ありえないマス：見つけ終わった船の隣・2 種類の船の隣・船の列からずれた隣
  const impossible = k => {
    const lens = new Set();
    for (const n of neighbors(k)) {
      const L = K[n];
      if (!(L > 0)) continue;
      lens.add(L);
      if (hits[L].length >= L) return true;
      if (hits[L].length >= 2 && !inLine(k, hits[L])) return true;
    }
    return lens.size >= 2;
  };

  const ok = unknown.filter(k => !impossible(k));
  // 追撃：見つけかけの船の隣
  const targets = [];
  for (const len of SHIP_LENS) {
    if (hits[len].length === 0 || hits[len].length >= len) continue;
    for (const h of hits[len]) for (const n of neighbors(h)) if (ok.includes(n)) targets.push(n);
  }
  if (targets.length) return randItem(targets);
  return randItem(ok.length ? ok : unknown);
}

// k が hits と同じ行（または列）の並びに乗っているか
function inLine(k, hits) {
  const sameRow = hits.every(h => rowOf(h) === rowOf(hits[0]));
  return sameRow ? rowOf(k) === rowOf(hits[0]) : colOf(k) === colOf(hits[0]);
}

// 強い：残りの全配置候補を数え、船がある確率が一番高いマスを選ぶ
function chooseStrong(unknown) {
  const count = Array(36).fill(0);
  for (const code of game.candidates) {
    for (const p of layoutShips(code)) for (const k of p.cells) count[k]++;
  }
  let best = -1, bestCells = [];
  for (const k of unknown) {
    if (count[k] > best) { best = count[k]; bestCells = [k]; }
    else if (count[k] === best) bestCells.push(k);
  }
  return randItem(bestCells);
}

/* =========================================================
 * 判定フェーズ
 * ========================================================= */

// declarer: 'player' か 'cpu'。cpuGuess は CPU が答えた盤面
function showResult(declarer, cpuGuess) {
  let leftVals, leftLocked, actual;
  if (declarer === 'player') {
    leftVals = game.guess;
    leftLocked = game.locked;
    actual = game.cpuBoard;
    $('result-left-title').textContent = 'あなたの回答';
    $('result-right-title').textContent = 'CPUの配置';
  } else {
    // CPU の回答：質問でハズレだったマスは × として表示
    leftVals = cpuGuess.map((v, k) => v || (game.cpuKnown[k] === 0 ? X : 0));
    leftLocked = game.cpuKnown.map(v => v !== null);
    actual = game.myBoard;
    $('result-left-title').textContent = 'CPUの回答';
    $('result-right-title').textContent = 'あなたの配置';
  }

  // 数字のマスだけを船として比べる（空白と × はどちらも「船なし」）
  const wrong = actual.map((a, k) => Math.max(leftVals[k], 0) !== a);
  const wrongCount = wrong.filter(Boolean).length;
  const correct = wrongCount === 0;
  const playerWin = (declarer === 'player') === correct;

  const title = $('result-title');
  title.textContent = playerWin ? 'あなたの勝ち！' : 'あなたの負け…';
  title.className = playerWin ? 'win' : 'lose';
  $('result-sub').textContent = declarer === 'player'
    ? (correct ? 'CPUの配置をすべて当てました！' : `${wrongCount}マス違っていました`)
    : (correct ? 'CPUにすべての配置を当てられました' : `CPUの予想は${wrongCount}マス違っていました`);

  const left = makeBoard($('result-left'));
  left.cells.forEach((cell, k) => paintValueCell(cell, leftVals[k], leftLocked[k]));
  const right = makeBoard($('result-right'));
  paintShipBoard(right, actual);
  right.cells.forEach((cell, k) => actual[k] && (cell.textContent = actual[k]));

  // 間違えたマスを両方の盤面で赤く強調
  wrong.forEach((w, k) => {
    if (!w) return;
    left.cells[k].classList.add('wrong');
    right.cells[k].classList.add('wrong');
  });

  showScreen('screen-result');
}

/* =========================================================
 * ボタンの設定
 * ========================================================= */

const RULES_HTML = `
  <p><b>1. 配置</b>：2・3・4・5マスの船を1隻ずつ置きます。船同士は上下左右に接してはいけません（斜めはOK）。</p>
  <p><b>2. 攻撃</b>：相手の盤面のマスを1つ質問すると、そこにある船の長さ（なければハズレ）がわかります。当たったら続けて質問でき、外れたら相手の番です。</p>
  <p><b>3. 判定</b>：自分の番に「わかった！」と宣言すると答え合わせ。相手の配置をすべて正確に当てていれば勝ち、間違っていれば負けです。</p>
  <p>予想盤面には 2〜5・× を自由に書き込んでメモできます。</p>`;

$('btn-start').onclick = () => {
  level = document.querySelector('input[name="level"]:checked').value;
  startPlacement();
};
$('btn-rules').onclick = () => showModal(RULES_HTML, [{ label: '閉じる', primary: true }]);
$('btn-place-back').onclick = () => showScreen('screen-title');
$('btn-reset').onclick = resetPlacement;
$('btn-random').onclick = randomPlacement;
$('btn-place-ok').onclick = startBattle;
$('btn-declare').onclick = playerDeclare;
$('btn-retry').onclick = startPlacement;
$('btn-to-title').onclick = () => showScreen('screen-title');
document.querySelectorAll('#toolbar .tool').forEach(b => (b.onclick = () => selectTool(b.dataset.tool)));
