const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

const ROWS = 6;
const COLS = 7;
const ROOM_TTL_MS = 1000 * 60 * 60 * 6; // комнаты старше 6 часов без активности удаляются

// В памяти сервера: code -> room state
const rooms = new Map();
// socket.id -> { code, role }
const socketMeta = new Map();

function emptyBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
}

function countMoves(board) {
  return board.reduce((n, row) => n + row.filter(Boolean).length, 0);
}

function findWin(board) {
  const dirs = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const v = board[r][c];
      if (!v) continue;
      for (const [dr, dc] of dirs) {
        const cells = [[r, c]];
        for (let k = 1; k < 4; k++) {
          const nr = r + dr * k;
          const nc = c + dc * k;
          if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS || board[nr][nc] !== v) break;
          cells.push([nr, nc]);
        }
        if (cells.length === 4) return { player: v, cells };
      }
    }
  }
  return null;
}

function genCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 5; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function broadcast(code) {
  const room = rooms.get(code);
  if (room) io.to(code).emit("state", room);
}

io.on("connection", (socket) => {
  socket.on("createRoom", ({ name } = {}) => {
    let code;
    do {
      code = genCode();
    } while (rooms.has(code));

    const room = {
      code,
      board: emptyBoard(),
      turn: 1,
      status: "waiting",
      winner: null,
      winCells: null,
      players: {
        1: { name: (name || "Игрок 1").slice(0, 14), connected: true },
        2: null,
      },
      score: { 1: 0, 2: 0 },
      round: 1,
      startPlayer: 1,
      reaction: null,
      rematch: { 1: false, 2: false },
      lastActivity: Date.now(),
    };
    rooms.set(code, room);
    socketMeta.set(socket.id, { code, role: 1 });
    socket.join(code);
    socket.emit("created", { code, role: 1, state: room });
  });

  socket.on("joinRoom", ({ name, code } = {}) => {
    code = (code || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) {
      socket.emit("errorMsg", "Комната не найдена. Проверь код.");
      return;
    }
    if (room.players[2] && room.players[2].connected) {
      socket.emit("errorMsg", "Комната уже занята.");
      return;
    }
    room.players[2] = { name: (name || "Игрок 2").slice(0, 14), connected: true };
    room.status = "playing";
    room.lastActivity = Date.now();
    socketMeta.set(socket.id, { code, role: 2 });
    socket.join(code);
    socket.emit("joined", { code, role: 2, state: room });
    broadcast(code);
  });

  socket.on("dropChip", ({ col } = {}) => {
    const meta = socketMeta.get(socket.id);
    if (!meta) return;
    const room = rooms.get(meta.code);
    if (!room || room.status !== "playing" || room.turn !== meta.role) return;
    if (col < 0 || col >= COLS) return;

    const board = room.board;
    if (board[0][col] !== null) return;
    let targetRow = -1;
    for (let r = ROWS - 1; r >= 0; r--) {
      if (!board[r][col]) {
        targetRow = r;
        break;
      }
    }
    if (targetRow === -1) return;
    board[targetRow][col] = meta.role;

    const winInfo = findWin(board);
    if (winInfo) {
      room.status = "finished";
      room.winner = meta.role;
      room.winCells = winInfo.cells;
      room.score[meta.role] = (room.score[meta.role] || 0) + 1;
    } else if (countMoves(board) === ROWS * COLS) {
      room.status = "draw";
    } else {
      room.turn = meta.role === 1 ? 2 : 1;
    }
    room.lastActivity = Date.now();
    broadcast(meta.code);
  });

  socket.on("rematch", () => {
    const meta = socketMeta.get(socket.id);
    if (!meta) return;
    const room = rooms.get(meta.code);
    if (!room) return;
    room.rematch[meta.role] = true;
    if (room.rematch[1] && room.rematch[2]) {
      room.board = emptyBoard();
      room.status = "playing";
      room.winner = null;
      room.winCells = null;
      room.round = (room.round || 1) + 1;
      room.startPlayer = room.startPlayer === 1 ? 2 : 1;
      room.turn = room.startPlayer;
      room.rematch = { 1: false, 2: false };
    }
    room.lastActivity = Date.now();
    broadcast(meta.code);
  });

  socket.on("reaction", ({ emoji } = {}) => {
    const meta = socketMeta.get(socket.id);
    if (!meta || !emoji) return;
    const room = rooms.get(meta.code);
    if (!room) return;
    room.reaction = { emoji, by: meta.role, ts: Date.now() };
    room.lastActivity = Date.now();
    broadcast(meta.code);
  });

  socket.on("disconnect", () => {
    const meta = socketMeta.get(socket.id);
    if (!meta) return;
    const room = rooms.get(meta.code);
    if (room && room.players[meta.role]) {
      room.players[meta.role].connected = false;
      room.lastActivity = Date.now();
      broadcast(meta.code);
    }
    socketMeta.delete(socket.id);
  });
});

// Периодическая уборка старых пустых комнат, чтобы не копить память
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms.entries()) {
    if (now - room.lastActivity > ROOM_TTL_MS) rooms.delete(code);
  }
}, 1000 * 60 * 30);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("Connect Four server running on port " + PORT);
});
