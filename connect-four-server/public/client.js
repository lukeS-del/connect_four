(function () {
  const root = document.getElementById("app");
  const ROWS = 6, COLS = 7;
  const socket = io();

  let audioCtx = null;
  let soundOn = true;
  let myRole = null;
  let roomCode = null;
  let roomState = null;
  let view = "home"; // home | lobby | game

  function beep(freq, dur, type) {
    if (!soundOn) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type || "square";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.06, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + dur);
    } catch (e) {}
  }
  const sfxDrop = () => beep(220, 0.12, "square");
  const sfxWin = () => { beep(440, 0.12); setTimeout(() => beep(554, 0.12), 120); setTimeout(() => beep(660, 0.25), 240); };
  const sfxJoin = () => beep(660, 0.1, "triangle");

  function toast(msg) {
    const t = document.createElement("div");
    t.className = "c4-toast";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  }

  function countMoves(board) {
    let n = 0;
    for (const row of board) for (const cell of row) if (cell) n++;
    return n;
  }

  // ---------------- HOME ----------------
  function renderHome() {
    view = "home";
    root.innerHTML = `
      <div class="c4-eyebrow">2 ИГРОКА &middot; ОНЛАЙН</div>
      <div class="c4-title">Четыре <span>в ряд</span></div>
      <div class="c4-panel">
        <div class="c4-field">
          <label class="c4-label">Твоё имя</label>
          <input class="c4-input" id="nameInput" maxlength="14" placeholder="Игрок">
        </div>
        <div class="c4-field"><button class="c4-btn" id="createBtn">Создать игру</button></div>
        <div class="c4-divider">ИЛИ</div>
        <div class="c4-field">
          <label class="c4-label">Код комнаты друга</label>
          <input class="c4-input" id="codeInput" maxlength="5" placeholder="AB12C" style="text-transform:uppercase">
        </div>
        <button class="c4-btn c4-btn-ghost" id="joinBtn">Присоединиться</button>
        <div class="c4-error" id="homeError"></div>
      </div>
      <p class="c4-hint" style="max-width:420px;text-align:center;margin-top:16px;">
        Создай игру и отправь код другу — он вводит его на этой же странице у себя.
      </p>
      <button class="c4-back" id="statsBtn" style="margin-top:10px;">🏆 Таблица лидеров и история партий</button>
    `;
    document.getElementById("createBtn").onclick = () => {
      const name = document.getElementById("nameInput").value.trim() || "Игрок 1";
      socket.emit("createRoom", { name });
    };
    document.getElementById("joinBtn").onclick = () => {
      const name = document.getElementById("nameInput").value.trim() || "Игрок 2";
      const code = document.getElementById("codeInput").value.trim().toUpperCase();
      document.getElementById("homeError").textContent = "";
      if (!code) { document.getElementById("homeError").textContent = "Введи код комнаты."; return; }
      socket.emit("joinRoom", { name, code });
    };
    document.getElementById("codeInput").addEventListener("input", (e) => { e.target.value = e.target.value.toUpperCase(); });
    document.getElementById("statsBtn").onclick = renderStats;
  }

  // ---------------- STATS (лидерборд + история) ----------------
  async function renderStats() {
    view = "stats";
    root.innerHTML = `
      <div class="c4-eyebrow">СТАТИСТИКА</div>
      <div class="c4-title" style="font-size:24px;">Топ <span>игроков</span></div>
      <div class="c4-panel" style="max-width:480px;">
        <div id="statsBody" style="text-align:center;color:var(--text-dim);font-size:13px;">Загрузка...</div>
      </div>
      <button class="c4-back" id="statsBack">← Назад</button>
    `;
    document.getElementById("statsBack").onclick = renderHome;

    try {
      const [lbRes, histRes] = await Promise.all([
        fetch("/api/leaderboard").then((r) => r.json()),
        fetch("/api/history").then((r) => r.json()),
      ]);
      const body = document.getElementById("statsBody");
      if (!lbRes.enabled) {
        body.innerHTML = `<div class="c4-error" style="margin-top:0;">База данных не подключена на сервере — статистика недоступна.</div>`;
        return;
      }
      let html = "";
      if (lbRes.rows.length === 0) {
        html += `<div style="color:var(--text-dim);font-size:13px;margin-bottom:18px;">Пока никто не сыграл ни одной партии.</div>`;
      } else {
        html += `<div style="text-align:left;margin-bottom:22px;">`;
        lbRes.rows.forEach((row, i) => {
          html += `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #2c2822;font-size:13px;">
              <span style="color:var(--text-dim);font-family:'Courier New',monospace;width:24px;">${i + 1}.</span>
              <span style="flex:1;">${escapeHtml(row.name)}</span>
              <span style="font-family:'Courier New',monospace;color:var(--p1);">${row.wins} побед</span>
              <span style="color:var(--text-dim);font-size:11px;margin-left:8px;">${row.games} игр</span>
            </div>`;
        });
        html += `</div>`;
      }

      html += `<div class="c4-label" style="text-align:left;">Последние партии</div>`;
      if (histRes.rows.length === 0) {
        html += `<div style="color:var(--text-dim);font-size:13px;">Пока пусто.</div>`;
      } else {
        histRes.rows.forEach((g) => {
          const result = g.winner_name
            ? `${escapeHtml(g.winner_name)} 🏆`
            : "ничья";
          html += `
            <div style="text-align:left;font-size:12.5px;color:var(--text-dim);padding:6px 0;border-bottom:1px solid #221f1b;">
              ${escapeHtml(g.player1_name)} <span style="color:var(--text);">${g.score1}:${g.score2}</span> ${escapeHtml(g.player2_name)}
              &nbsp;—&nbsp;<span style="color:var(--p2);">${result}</span>
            </div>`;
        });
      }
      body.innerHTML = html;
    } catch (e) {
      document.getElementById("statsBody").textContent = "Не удалось загрузить статистику.";
    }
  }

  function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str == null ? "" : String(str);
    return d.innerHTML;
  }

  // ---------------- LOBBY ----------------
  function renderLobby() {
    view = "lobby";
    root.innerHTML = `
      <div class="c4-eyebrow">КОМНАТА СОЗДАНА</div>
      <div class="c4-title">Жду <span>соперника</span></div>
      <div class="c4-panel" style="text-align:center;">
        <div class="c4-code-box">
          <div class="c4-code">${roomCode}</div>
          <div class="c4-hint">Пришли этот код другу — он вводит его на этом же сайте</div>
        </div>
        <button class="c4-btn" id="copyBtn">Скопировать код</button>
        <div style="margin-top:18px;color:var(--text-dim);font-size:13px;">
          <span class="c4-pulse-dot"></span>Ожидание подключения...
        </div>
      </div>
      <button class="c4-back" id="cancelBtn">Отменить и выйти</button>
    `;
    document.getElementById("copyBtn").onclick = async () => {
      try { await navigator.clipboard.writeText(roomCode); toast("Код скопирован ✔"); }
      catch (e) { toast("Код: " + roomCode); }
    };
    document.getElementById("cancelBtn").onclick = () => {
      location.reload();
    };
  }

  // ---------------- GAME ----------------
  function renderGame(newCell) {
    view = "game";
    const s = roomState;
    const p1 = s.players[1], p2 = s.players[2];
    const board = s.board;
    const iAmTurn = s.status === "playing" && s.turn === myRole;

    let bannerClass = "c4-turn-banner";
    let bannerText = "";
    const opponentRole = myRole === 1 ? 2 : 1;
    const opponentOffline = s.players[opponentRole] && s.players[opponentRole].connected === false;

    if (s.status === "waiting") {
      bannerText = "Ожидание второго игрока...";
    } else if (s.status === "finished") {
      bannerClass += " win";
      bannerText = s.winner === myRole ? "🎉 Ты выиграл!" : `Победил ${s.players[s.winner]?.name || "соперник"}`;
    } else if (s.status === "draw") {
      bannerClass += " draw";
      bannerText = "Ничья! Поле заполнено.";
    } else if (opponentOffline) {
      bannerClass += " offline";
      bannerText = "Соперник отключился — ждём переподключения...";
    } else {
      bannerClass += iAmTurn ? " mine" : "";
      bannerText = iAmTurn ? "Твой ход" : `Ход соперника (${s.players[s.turn]?.name || "..."})`;
    }

    let colsHtml = "";
    for (let c = 0; c < COLS; c++) {
      const colFull = board[0][c] !== null;
      let cellsHtml = "";
      for (let r = 0; r < ROWS; r++) {
        const val = board[r][c];
        const isWin = s.winCells && s.winCells.some(([wr, wc]) => wr === r && wc === c);
        const isNew = newCell && newCell[0] === r && newCell[1] === c;
        cellsHtml += `<div class="c4-cell" data-r="${r}" data-c="${c}">
          ${val ? `<div class="c4-chip p${val} ${isWin ? "win" : ""} ${isNew ? "" : "dropped"}"></div>` : ""}
        </div>`;
      }
      const canClick = s.status === "playing" && iAmTurn && !colFull && !opponentOffline;
      colsHtml += `<div class="c4-col ${canClick ? "hoverable" : ""} ${colFull ? "full" : ""}" data-col="${c}" ${canClick ? `onclick="window.__c4drop(${c})"` : ""}>${cellsHtml}</div>`;
    }

    root.innerHTML = `
      <div class="c4-eyebrow">КОМНАТА ${roomCode}</div>
      <div class="c4-title" style="font-size:22px;margin-bottom:16px;">Четыре <span>в ряд</span></div>
      <div class="c4-game-wrap">
        <div class="c4-scoreboard">
          <div class="c4-player-chip"><span class="c4-dot p1"></span>${p1 ? p1.name : "—"}<span class="c4-score-num">${s.score[1]}</span></div>
          <div style="font-family:'Courier New',monospace;color:var(--text-dim);font-size:11px;">РАУНД ${s.round}</div>
          <div class="c4-player-chip"><span class="c4-score-num">${s.score[2]}</span>${p2 ? p2.name : "ждём..."}<span class="c4-dot p2"></span></div>
        </div>
        <div class="${bannerClass}">${bannerText}</div>
        <div class="c4-board-frame" id="boardFrame">
          <div class="c4-board">${colsHtml}</div>
        </div>
        ${(s.status === "finished" || s.status === "draw") ? `
          <div class="c4-endcard">
            <h3>${s.status === "draw" ? "Ничья" : (s.winner === myRole ? "Победа!" : "Поражение")}</h3>
            <p>Счёт серии: ${s.score[1]} : ${s.score[2]}</p>
            <button class="c4-btn" id="rematchBtn">${s.rematch[myRole] ? "Ждём соперника..." : "Играть ещё раз"}</button>
          </div>
        ` : `
          <div class="c4-controls">
            <div class="c4-reactions">
              <button class="c4-react-btn" data-emo="🔥">🔥</button>
              <button class="c4-react-btn" data-emo="😅">😅</button>
              <button class="c4-react-btn" data-emo="👏">👏</button>
              <button class="c4-react-btn" data-emo="🤔">🤔</button>
            </div>
            <button class="c4-icon-btn" id="soundBtn">${soundOn ? "🔊 ЗВУК" : "🔇 ЗВУК"}</button>
          </div>
        `}
      </div>
      <button class="c4-back" id="leaveBtn">Выйти из игры</button>
    `;

    if (newCell) {
      const cell = document.querySelector(`.c4-cell[data-r="${newCell[0]}"][data-c="${newCell[1]}"]`);
      const chip = cell && cell.querySelector(".c4-chip");
      if (chip) {
        void chip.offsetWidth;
        requestAnimationFrame(() => chip.classList.add("dropped"));
      }
    }

    const soundBtn = document.getElementById("soundBtn");
    if (soundBtn) soundBtn.onclick = () => { soundOn = !soundOn; renderGame(); };

    document.querySelectorAll(".c4-react-btn").forEach((btn) => {
      btn.onclick = () => {
        const emo = btn.getAttribute("data-emo");
        showFloatingEmoji(emo);
        socket.emit("reaction", { emoji: emo });
      };
    });

    const rematchBtn = document.getElementById("rematchBtn");
    if (rematchBtn) rematchBtn.onclick = () => socket.emit("rematch");

    const leaveBtn = document.getElementById("leaveBtn");
    if (leaveBtn) leaveBtn.onclick = () => location.reload();
  }

  function showFloatingEmoji(emo) {
    const frame = document.getElementById("boardFrame");
    if (!frame) return;
    const el = document.createElement("div");
    el.className = "c4-float-emoji";
    el.textContent = emo;
    el.style.left = (40 + Math.random() * 60) + "%";
    el.style.bottom = "10px";
    frame.style.position = "relative";
    frame.appendChild(el);
    setTimeout(() => el.remove(), 1700);
  }

  window.__c4drop = function (col) {
    if (!roomState || roomState.status !== "playing" || roomState.turn !== myRole) return;
    sfxDrop();
    socket.emit("dropChip", { col });
  };

  // ---------------- SOCKET EVENTS ----------------
  socket.on("created", ({ code, role, state }) => {
    roomCode = code;
    myRole = role;
    roomState = state;
    renderLobby();
  });

  socket.on("joined", ({ code, role, state }) => {
    roomCode = code;
    myRole = role;
    roomState = state;
    sfxJoin();
    renderGame();
  });

  socket.on("errorMsg", (msg) => {
    const el = document.getElementById("homeError");
    if (el) el.textContent = msg;
    else toast(msg);
  });

  socket.on("state", (fresh) => {
    const wasWaiting = roomState && roomState.status === "waiting";
    const prevBoard = roomState ? roomState.board : Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    const prevMoveCount = countMoves(prevBoard);
    const prevReactionTs = roomState && roomState.reaction ? roomState.reaction.ts : 0;
    const newMoveCount = countMoves(fresh.board);

    let newCell = null;
    if (newMoveCount > prevMoveCount) {
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        if (fresh.board[r][c] && !prevBoard[r][c]) newCell = [r, c];
      }
    }

    if (wasWaiting && fresh.status === "playing" && view === "lobby") {
      sfxJoin();
      toast((fresh.players[2]?.name || "Соперник") + " присоединился!");
      roomState = fresh;
      renderGame();
      return;
    }

    const isReset = prevMoveCount > 0 && newMoveCount === 0;
    roomState = fresh;

    if (view === "game") {
      renderGame(isReset ? null : newCell);
      if (newCell && newCell[2] !== myRole) sfxDrop();
      if (fresh.status === "finished" && newCell) sfxWin();
      if (fresh.reaction && fresh.reaction.ts > prevReactionTs && fresh.reaction.by !== myRole) {
        showFloatingEmoji(fresh.reaction.emoji);
      }
    }
  });

  renderHome();
})();
