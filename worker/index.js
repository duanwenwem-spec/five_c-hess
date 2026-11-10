const SIZE = 15;
const EMPTY = 0;
const BLACK = 1;
const WHITE = 2;
const DIRECTIONS = [[1, 0], [0, 1], [1, 1], [1, -1]];
const ROOM_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});
const blankBoard = () => Array.from({ length: SIZE }, () => Array(SIZE).fill(EMPTY));
const inBounds = (row, col) => row >= 0 && row < SIZE && col >= 0 && col < SIZE;

function hasFive(board, row, col, player) {
  if (!inBounds(row, col) || board[row][col] !== player) return false;
  return DIRECTIONS.some(([dr, dc]) => {
    let count = 1;
    for (const sign of [1, -1]) {
      for (let step = 1; ; step += 1) {
        const nr = row + dr * step * sign;
        const nc = col + dc * step * sign;
        if (!inBounds(nr, nc) || board[nr][nc] !== player) break;
        count += 1;
      }
    }
    return count >= 5;
  });
}

function candidates(board) {
  const occupied = [];
  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) if (board[row][col] !== EMPTY) occupied.push([row, col]);
  }
  if (!occupied.length) return [[7, 7]];
  const cells = new Map();
  for (const [row, col] of occupied) {
    for (let dr = -2; dr <= 2; dr += 1) {
      for (let dc = -2; dc <= 2; dc += 1) {
        const nr = row + dr;
        const nc = col + dc;
        if (inBounds(nr, nc) && board[nr][nc] === EMPTY) cells.set(`${nr},${nc}`, [nr, nc]);
      }
    }
  }
  return [...cells.values()];
}

function lineScore(board, row, col, player) {
  let score = 0;
  for (const [dr, dc] of DIRECTIONS) {
    let total = 1;
    let openEnds = 0;
    for (const sign of [1, -1]) {
      for (let step = 1; ; step += 1) {
        const nr = row + dr * step * sign;
        const nc = col + dc * step * sign;
        if (!inBounds(nr, nc)) break;
        if (board[nr][nc] === player) { total += 1; continue; }
        if (board[nr][nc] === EMPTY) openEnds += 1;
        break;
      }
    }
    if (total >= 5) score += 1_000_000;
    else if (total === 4) score += openEnds === 2 ? 45_000 : 8_000;
    else if (total === 3) score += openEnds === 2 ? 4_000 : 650;
    else if (total === 2) score += openEnds === 2 ? 450 : 90;
    else score += 12 * openEnds;
  }
  return score;
}

function moveScore(board, row, col) {
  const attack = lineScore(board, row, col, WHITE);
  const defence = lineScore(board, row, col, BLACK);
  if (attack >= 1_000_000) return 11_000_000;
  if (defence >= 1_000_000) return 10_000_000;
  return Math.floor(attack * 1.1) + defence - (Math.abs(row - 7) + Math.abs(col - 7)) * 2;
}

function chooseAiMove(board, difficulty = "normal") {
  const cells = candidates(board);
  if (!cells.length) return null;
  if (difficulty === "easy") {
    const wins = cells.filter(([r, c]) => {
      board[r][c] = WHITE;
      const win = hasFive(board, r, c, WHITE);
      board[r][c] = EMPTY;
      return win;
    });
    const pool = wins.length ? wins : cells;
    return pool[Math.floor(Math.random() * pool.length)];
  }
  const best = Math.max(...cells.map(([r, c]) => moveScore(board, r, c)));
  const pool = cells.filter(([r, c]) => moveScore(board, r, c) === best);
  return pool[Math.floor(Math.random() * pool.length)];
}

function tokenPlayer(state, token) {
  if (token === state.blackToken) return BLACK;
  if (token === state.whiteToken) return WHITE;
  return null;
}

function snapshot(state, token) {
  const player = tokenPlayer(state, token);
  if (!player) return null;
  return {
    roomCode: state.code,
    status: state.status,
    board: state.board,
    currentPlayer: state.currentPlayer,
    player,
    winner: state.winner,
    revision: state.revision,
    moveCount: state.history.length,
    lastMove: state.history.at(-1) || null,
    opponentConnected: Boolean(state.whiteToken),
    rematchRequested: state.rematchPlayers.includes(player),
    opponentRematch: state.rematchPlayers.includes(player === BLACK ? WHITE : BLACK),
  };
}

export class GameRoom {
  constructor(ctx) { this.ctx = ctx; }

  async fetch(request) {
    const url = new URL(request.url);
    const action = url.pathname.split("/").at(-1);
    let state = await this.ctx.storage.get("state");
    let body = {};
    if (request.method === "POST") body = await request.json().catch(() => ({}));

    if (action === "create") {
      if (state) return json({ error: "房间号冲突" }, 409);
      const token = crypto.randomUUID();
      state = {
        code: body.code,
        blackToken: token,
        whiteToken: null,
        board: blankBoard(),
        currentPlayer: BLACK,
        winner: null,
        status: "waiting",
        revision: 0,
        history: [],
        rematchPlayers: [],
      };
      await this.ctx.storage.put("state", state);
      return json({ ...snapshot(state, token), token }, 201);
    }
    if (!state) return json({ error: "房间不存在或已经过期" }, 404);

    if (action === "join") {
      if (state.whiteToken) return json({ error: "房间人数已满" }, 409);
      const token = crypto.randomUUID();
      state.whiteToken = token;
      state.status = "playing";
      state.revision += 1;
      await this.ctx.storage.put("state", state);
      return json({ ...snapshot(state, token), token });
    }

    const token = request.method === "GET" ? url.searchParams.get("token") : body.token;
    const player = tokenPlayer(state, token);
    if (!player) return json({ error: "玩家身份已失效，请重新加入" }, 403);
    if (action === "state") return json(snapshot(state, token));

    if (action === "move") {
      if (state.status !== "playing") return json({ error: "对局尚未开始或已经结束" }, 409);
      if (state.currentPlayer !== player) return json({ error: "还没有轮到你落子" }, 409);
      if (body.revision !== state.revision) return json({ error: "棋局状态已更新，请重试" }, 409);
      const { row, col } = body;
      if (!Number.isInteger(row) || !Number.isInteger(col) || !inBounds(row, col)) return json({ error: "无效的落子位置" }, 400);
      if (state.board[row][col] !== EMPTY) return json({ error: "该位置已经有棋子" }, 409);
      state.board[row][col] = player;
      state.history.push({ row, col, player });
      if (hasFive(state.board, row, col, player)) { state.winner = player; state.status = "finished"; }
      else if (state.history.length === SIZE * SIZE) { state.winner = EMPTY; state.status = "finished"; }
      else state.currentPlayer = player === BLACK ? WHITE : BLACK;
    } else if (action === "resign" || action === "leave") {
      state.winner = player === BLACK ? WHITE : BLACK;
      state.status = "finished";
    } else if (action === "rematch") {
      if (state.status !== "finished") return json({ error: "对局结束后才能再来一局" }, 409);
      if (!state.rematchPlayers.includes(player)) state.rematchPlayers.push(player);
      if (state.rematchPlayers.length === 2) {
        [state.blackToken, state.whiteToken] = [state.whiteToken, state.blackToken];
        state.board = blankBoard();
        state.currentPlayer = BLACK;
        state.winner = null;
        state.status = "playing";
        state.history = [];
        state.rematchPlayers = [];
      }
    } else return json({ error: "接口不存在" }, 404);

    state.revision += 1;
    await this.ctx.storage.put("state", state);
    return json(snapshot(state, token));
  }
}

function roomCode() {
  return Array.from({ length: 6 }, () => ROOM_CHARS[Math.floor(Math.random() * ROOM_CHARS.length)]).join("");
}

async function handleApi(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/api/move" && request.method === "POST") {
    const body = await request.json();
    const board = body.board;
    if (!Array.isArray(board) || board.length !== SIZE) return json({ error: "无效的棋盘" }, 400);
    const move = chooseAiMove(board, body.difficulty);
    let winner = null;
    if (move) {
      board[move[0]][move[1]] = WHITE;
      if (hasFive(board, move[0], move[1], WHITE)) winner = WHITE;
    }
    return json({ move: move ? { row: move[0], col: move[1] } : null, winner });
  }
  if (url.pathname === "/api/rooms" && request.method === "POST") {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = roomCode();
      const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
      const response = await stub.fetch("https://room/create", { method: "POST", body: JSON.stringify({ code }) });
      if (response.status !== 409) return response;
    }
    return json({ error: "暂时无法创建房间，请重试" }, 503);
  }
  const match = url.pathname.match(/^\/api\/rooms\/([A-Z2-9]{6})\/(join|state|move|resign|rematch|leave)$/);
  if (!match) return json({ error: "接口不存在" }, 404);
  const stub = env.ROOMS.get(env.ROOMS.idFromName(match[1]));
  const target = new URL(`https://room/${match[2]}`);
  target.search = url.search;
  return stub.fetch(new Request(target, request));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return handleApi(request, env);
    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    headers.set("x-content-type-options", "nosniff");
    headers.set("referrer-policy", "same-origin");
    return new Response(response.body, { status: response.status, headers });
  },
};
