const { Pool } = require("pg");

// Render (и большинство хостингов) кладут строку подключения в DATABASE_URL.
// Без неё сервер просто работает без персистентности (как раньше, всё в памяти).
const connectionString = process.env.DATABASE_URL;
const pool = connectionString
  ? new Pool({
      connectionString,
      ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false },
    })
  : null;

async function migrate() {
  if (!pool) {
    console.log("DATABASE_URL не задан — работаем без базы данных (состояние только в памяти).");
    return;
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rooms (
      code TEXT PRIMARY KEY,
      state JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS game_history (
      id SERIAL PRIMARY KEY,
      room_code TEXT NOT NULL,
      player1_name TEXT NOT NULL,
      player2_name TEXT NOT NULL,
      winner_name TEXT,
      score1 INT NOT NULL,
      score2 INT NOT NULL,
      round INT NOT NULL,
      finished_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  console.log("Миграции БД выполнены.");
}

async function loadRecentRooms(maxAgeMs) {
  if (!pool) return [];
  const res = await pool.query(
    `SELECT code, state FROM rooms WHERE updated_at > now() - ($1 || ' milliseconds')::interval`,
    [maxAgeMs]
  );
  return res.rows.map((r) => r.state);
}

async function saveRoom(room) {
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO rooms (code, state, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (code) DO UPDATE SET state = $2, updated_at = now()`,
      [room.code, room]
    );
  } catch (e) {
    console.error("Ошибка сохранения комнаты в БД:", e.message);
  }
}

async function deleteRoom(code) {
  if (!pool) return;
  try {
    await pool.query(`DELETE FROM rooms WHERE code = $1`, [code]);
  } catch (e) {
    console.error("Ошибка удаления комнаты из БД:", e.message);
  }
}

async function logFinishedGame(room) {
  if (!pool) return;
  const p1 = room.players[1]?.name || "Игрок 1";
  const p2 = room.players[2]?.name || "Игрок 2";
  const winnerName = room.status === "finished" ? (room.winner === 1 ? p1 : p2) : null;
  try {
    await pool.query(
      `INSERT INTO game_history (room_code, player1_name, player2_name, winner_name, score1, score2, round)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [room.code, p1, p2, winnerName, room.score[1], room.score[2], room.round]
    );
  } catch (e) {
    console.error("Ошибка записи истории партии:", e.message);
  }
}

async function getLeaderboard(limit = 20) {
  if (!pool) return [];
  const res = await pool.query(
    `
    SELECT name,
           COUNT(*) FILTER (WHERE name = winner_name) AS wins,
           COUNT(*) AS games
    FROM (
      SELECT player1_name AS name, winner_name FROM game_history
      UNION ALL
      SELECT player2_name AS name, winner_name FROM game_history
    ) t
    GROUP BY name
    ORDER BY wins DESC, games DESC
    LIMIT $1
    `,
    [limit]
  );
  return res.rows.map((r) => ({ name: r.name, wins: Number(r.wins), games: Number(r.games) }));
}

async function getHistory(limit = 20) {
  if (!pool) return [];
  const res = await pool.query(
    `SELECT room_code, player1_name, player2_name, winner_name, score1, score2, round, finished_at
     FROM game_history ORDER BY finished_at DESC LIMIT $1`,
    [limit]
  );
  return res.rows;
}

module.exports = {
  hasDb: !!pool,
  migrate,
  loadRecentRooms,
  saveRoom,
  deleteRoom,
  logFinishedGame,
  getLeaderboard,
  getHistory,
};
