const SIZE = 15;
const EMPTY = 0;
const BLACK = 1;
const WHITE = 2;
const DIRECTIONS = [[1, 0], [0, 1], [1, 1], [1, -1]];
const ROOM_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DRAW_DURATION = 90_000;
const COIN_DURATION = 45_000;
const DRAW_WORDS = [
  { word: "太阳", category: "自然" }, { word: "房子", category: "建筑" },
  { word: "小鱼", category: "动物" }, { word: "雨伞", category: "物品" },
  { word: "苹果", category: "食物" }, { word: "小猫", category: "动物" },
  { word: "帆船", category: "交通" }, { word: "大树", category: "植物" },
  { word: "眼镜", category: "物品" }, { word: "雪人", category: "自然" },
  { word: "蛋糕", category: "食物" }, { word: "汽车", category: "交通" },
];

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});
const blankBoard = () => Array.from({ length: SIZE }, () => Array(SIZE).fill(EMPTY));
const inBounds = (row, col) => row >= 0 && row < SIZE && col >= 0 && col < SIZE;
const randomInt = (min, max) => {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return min + Math.floor((value[0] / 4294967296) * (max - min + 1));
};
const newDrawWord = () => DRAW_WORDS[randomInt(0, DRAW_WORDS.length - 1)];

function expireTimedGame(state) {
  if (state.status !== "playing" || !state.deadline || Date.now() < state.deadline) return false;
  state.status = "finished";
  state.endReason = "timeout";
  if (state.gameType === "draw") state.winner = null;
  if (state.gameType === "coin") {
    state.winner = state.scores[BLACK] === state.scores[WHITE]
      ? EMPTY
      : state.scores[BLACK] > state.scores[WHITE] ? BLACK : WHITE;
  }
  state.revision += 1;
  return true;
}

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
  if (difficulty === "hard") {
    for (const player of [WHITE, BLACK]) {
      const urgent = cells.filter(([row, col]) => {
        board[row][col] = player;
        const win = hasFive(board, row, col, player);
        board[row][col] = EMPTY;
        return win;
      });
      if (urgent.length) return urgent[Math.floor(Math.random() * urgent.length)];
    }
    const ranked = [...cells].sort((a, b) => moveScore(board, ...b) - moveScore(board, ...a)).slice(0, 32);
    let bestValue = -Infinity;
    let bestMoves = [];
    for (const [row, col] of ranked) {
      const attack = lineScore(board, row, col, WHITE);
      const defence = lineScore(board, row, col, BLACK);
      board[row][col] = WHITE;
      const replies = candidates(board);
      const opponentPressure = Math.max(0, ...replies.map(([r, c]) => lineScore(board, r, c, BLACK)));
      const followUp = Math.max(0, ...replies.map(([r, c]) => lineScore(board, r, c, WHITE)));
      board[row][col] = EMPTY;
      const distance = Math.abs(row - 7) + Math.abs(col - 7);
      const value = attack * 6 + defence * 5 + followUp * 2 - opponentPressure * 2 - distance * 3;
      if (value > bestValue) { bestValue = value; bestMoves = [[row, col]]; }
      else if (value === bestValue) bestMoves.push([row, col]);
    }
    return bestMoves[Math.floor(Math.random() * bestMoves.length)];
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
  const opponent = player === BLACK ? WHITE : BLACK;
  if (state.gameType === "draw") {
    const isDrawer = player === state.drawer;
    return {
      gameType: "draw",
      roomCode: state.code,
      status: state.status,
      player,
      drawer: state.drawer,
      isDrawer,
      word: isDrawer || state.status === "finished" ? state.word : null,
      wordLength: [...state.word].length,
      category: state.category,
      strokes: state.strokes,
      guesses: state.guesses.slice(-20),
      deadline: state.deadline,
      winner: state.winner,
      endReason: state.endReason,
      revision: state.revision,
      opponentConnected: Boolean(state.whiteToken),
      rematchRequested: state.rematchPlayers.includes(player),
      opponentRematch: state.rematchPlayers.includes(opponent),
    };
  }
  if (state.gameType === "coin") {
    return {
      gameType: "coin",
      roomCode: state.code,
      status: state.status,
      player,
      seed: state.seed,
      startedAt: state.startedAt,
      deadline: state.deadline,
      score: state.scores[player],
      opponentScore: state.scores[opponent],
      scores: state.scores,
      winner: state.winner,
      revision: state.revision,
      opponentConnected: Boolean(state.whiteToken),
      rematchRequested: state.rematchPlayers.includes(player),
      opponentRematch: state.rematchPlayers.includes(opponent),
    };
  }
  if (state.gameType === "bomb") {
    return {
      gameType: "bomb",
      roomCode: state.code,
      status: state.status,
      initialMin: state.initialMin,
      initialMax: state.initialMax,
      min: state.currentMin,
      max: state.currentMax,
      currentPlayer: state.currentPlayer,
      player,
      loser: state.loser,
      bomb: state.status === "finished" ? state.bomb : null,
      revision: state.revision,
      guessCount: state.history.length,
      lastGuess: state.history.at(-1) || null,
      history: state.history,
      opponentConnected: Boolean(state.whiteToken),
      rematchRequested: state.rematchPlayers.includes(player),
      opponentRematch: state.rematchPlayers.includes(opponent),
    };
  }
  return {
    gameType: "gomoku",
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
    opponentRematch: state.rematchPlayers.includes(opponent),
  };
}

export class GameRoom {
  constructor(ctx) {
    this.ctx = ctx;
    this.waiters = new Set();
  }

  waitForChange(timeout = 20_000) {
    return new Promise((resolve) => {
      const wake = () => {
        clearTimeout(timer);
        this.waiters.delete(wake);
        resolve();
      };
      const timer = setTimeout(wake, timeout);
      this.waiters.add(wake);
    });
  }

  notifyWaiters() {
    for (const wake of [...this.waiters]) wake();
  }

  async fetch(request) {
    const url = new URL(request.url);
    const action = url.pathname.split("/").at(-1);
    let state = await this.ctx.storage.get("state");
    let body = {};
    if (request.method === "POST") body = await request.json().catch(() => ({}));

    if (action === "create") {
      if (state) return json({ error: "房间号冲突" }, 409);
      const token = crypto.randomUUID();
      if (body.gameType === "draw") {
        const selected = newDrawWord();
        state = {
          gameType: "draw",
          code: body.code,
          blackToken: token,
          whiteToken: null,
          drawer: BLACK,
          word: selected.word,
          category: selected.category,
          strokes: [],
          guesses: [],
          winner: null,
          endReason: null,
          deadline: null,
          status: "waiting",
          revision: 0,
          rematchPlayers: [],
        };
      } else if (body.gameType === "coin") {
        state = {
          gameType: "coin",
          code: body.code,
          blackToken: token,
          whiteToken: null,
          seed: randomInt(1, 2_000_000_000),
          scores: { [BLACK]: 0, [WHITE]: 0 },
          finishedPlayers: [],
          winner: null,
          startedAt: null,
          deadline: null,
          status: "waiting",
          revision: 0,
          rematchPlayers: [],
        };
      } else if (body.gameType === "bomb") {
        const min = Number(body.min);
        const max = Number(body.max);
        if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max > 9999 || max - min < 9) {
          return json({ error: "请选择至少包含 10 个数字的有效范围" }, 400);
        }
        state = {
          gameType: "bomb",
          code: body.code,
          blackToken: token,
          whiteToken: null,
          initialMin: min,
          initialMax: max,
          currentMin: min,
          currentMax: max,
          bomb: randomInt(min, max),
          currentPlayer: BLACK,
          loser: null,
          status: "waiting",
          revision: 0,
          history: [],
          rematchPlayers: [],
        };
      } else {
        state = {
          gameType: "gomoku",
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
      }
      await this.ctx.storage.put("state", state);
      return json({ ...snapshot(state, token), token }, 201);
    }
    if (!state) return json({ error: "房间不存在或已经过期" }, 404);

    if (action === "join") {
      if (state.whiteToken || state.status !== "waiting") return json({ error: "房间人数已满或已经结束" }, 409);
      const token = crypto.randomUUID();
      state.whiteToken = token;
      state.status = "playing";
      if (state.gameType === "draw") state.deadline = Date.now() + DRAW_DURATION;
      if (state.gameType === "coin") {
        state.startedAt = Date.now() + 1_500;
        state.deadline = state.startedAt + COIN_DURATION;
      }
      state.revision += 1;
      await this.ctx.storage.put("state", state);
      this.notifyWaiters();
      return json({ ...snapshot(state, token), token });
    }

    const token = request.method === "GET" ? url.searchParams.get("token") : body.token;
    const player = tokenPlayer(state, token);
    if (!player) return json({ error: "玩家身份已失效，请重新加入" }, 403);
    if (action === "state") {
      if (expireTimedGame(state)) {
        await this.ctx.storage.put("state", state);
        this.notifyWaiters();
      }
      const requestedRevision = Number(url.searchParams.get("revision"));
      if (Number.isInteger(requestedRevision) && requestedRevision === state.revision) {
        const untilDeadline = state.deadline ? Math.max(50, state.deadline - Date.now()) : 20_000;
        await this.waitForChange(Math.min(20_000, untilDeadline));
        state = await this.ctx.storage.get("state");
        if (expireTimedGame(state)) {
          await this.ctx.storage.put("state", state);
          this.notifyWaiters();
        }
      }
      return json(snapshot(state, token));
    }

    const gameType = state.gameType || "gomoku";
    if ((gameType === "draw" || gameType === "coin") && expireTimedGame(state)) {
      await this.ctx.storage.put("state", state);
      this.notifyWaiters();
      return json(snapshot(state, token));
    }
    if (action === "move") {
      if (gameType !== "gomoku") return json({ error: "当前房间不是五子棋房间" }, 409);
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
    } else if (action === "draw") {
      if (gameType !== "draw") return json({ error: "当前房间不是你画我猜房间" }, 409);
      if (state.status !== "playing" || state.drawer !== player) return json({ error: "当前不能作画" }, 409);
      if (body.revision !== state.revision) return json({ error: "画板已更新，请重试" }, 409);
      if (!Array.isArray(body.stroke) || body.stroke.length < 2 || body.stroke.length > 240) return json({ error: "无效的画笔轨迹" }, 400);
      const stroke = body.stroke.map((point) => ({
        x: Math.round(Number(point.x) * 10_000) / 10_000,
        y: Math.round(Number(point.y) * 10_000) / 10_000,
      }));
      if (stroke.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1)) {
        return json({ error: "画笔轨迹超出画板" }, 400);
      }
      const totalPoints = state.strokes.reduce((sum, item) => sum + item.length, 0);
      if (state.strokes.length >= 160 || totalPoints + stroke.length > 5_000) return json({ error: "画板内容太多，请先清空" }, 409);
      state.strokes.push(stroke);
    } else if (action === "clear") {
      if (gameType !== "draw" || state.drawer !== player || state.status !== "playing") return json({ error: "当前不能清空画板" }, 409);
      state.strokes = [];
    } else if (action === "guess") {
      if (gameType === "draw") {
        if (state.status !== "playing" || state.drawer === player) return json({ error: "当前不能猜词" }, 409);
        const guess = String(body.guess || "").trim().slice(0, 20);
        if (!guess) return json({ error: "请输入你的答案" }, 400);
        const correct = guess.replace(/\s/g, "").toLowerCase() === state.word.replace(/\s/g, "").toLowerCase();
        state.guesses.push({ player, text: guess, correct });
        if (state.guesses.length > 50) state.guesses.shift();
        if (correct) {
          state.winner = player;
          state.status = "finished";
          state.endReason = "correct";
        }
      } else if (gameType === "bomb") {
        if (state.status !== "playing") return json({ error: "对局尚未开始或已经结束" }, 409);
        if (state.currentPlayer !== player) return json({ error: "还没有轮到你猜数字" }, 409);
        if (body.revision !== state.revision) return json({ error: "游戏状态已更新，请重试" }, 409);
        const guess = Number(body.guess);
        if (!Number.isInteger(guess) || guess < state.currentMin || guess > state.currentMax) {
          return json({ error: `请输入 ${state.currentMin}—${state.currentMax} 之间的整数` }, 400);
        }
        const hit = guess === state.bomb;
        const direction = hit ? "boom" : guess < state.bomb ? "higher" : "lower";
        state.history.push({ player, guess, hit, direction });
        if (hit) {
          state.loser = player;
          state.status = "finished";
        } else {
          if (direction === "higher") state.currentMin = guess + 1;
          else state.currentMax = guess - 1;
          state.currentPlayer = player === BLACK ? WHITE : BLACK;
        }
      } else return json({ error: "当前房间不支持猜词" }, 409);
    } else if (action === "score") {
      if (gameType !== "coin" || state.status !== "playing") return json({ error: "当前不能更新分数" }, 409);
      const score = Number(body.score);
      if (!Number.isInteger(score) || score < -1_000 || score > 20_000) return json({ error: "无效的分数" }, 400);
      state.scores[player] = score;
    } else if (action === "finish") {
      if (gameType !== "coin" || state.status !== "playing") return json({ error: "本局已经结束" }, 409);
      const score = Number(body.score);
      if (Number.isInteger(score)) state.scores[player] = Math.max(-1_000, Math.min(20_000, score));
      if (!state.finishedPlayers.includes(player)) state.finishedPlayers.push(player);
      if (state.finishedPlayers.length === 2 || Date.now() >= state.deadline) {
        state.status = "finished";
        state.winner = state.scores[BLACK] === state.scores[WHITE]
          ? EMPTY
          : state.scores[BLACK] > state.scores[WHITE] ? BLACK : WHITE;
      }
    } else if (action === "resign" || action === "leave") {
      if (gameType === "bomb") state.loser = player;
      else state.winner = player === BLACK ? WHITE : BLACK;
      if (gameType === "draw" || gameType === "coin") state.endReason = "leave";
      state.status = "finished";
    } else if (action === "rematch") {
      if (state.status !== "finished") return json({ error: "对局结束后才能再来一局" }, 409);
      if (!state.rematchPlayers.includes(player)) state.rematchPlayers.push(player);
      if (state.rematchPlayers.length === 2) {
        [state.blackToken, state.whiteToken] = [state.whiteToken, state.blackToken];
        state.status = "playing";
        state.rematchPlayers = [];
        if (gameType === "bomb") {
          state.currentPlayer = BLACK;
          state.history = [];
          state.currentMin = state.initialMin;
          state.currentMax = state.initialMax;
          state.bomb = randomInt(state.initialMin, state.initialMax);
          state.loser = null;
        } else if (gameType === "draw") {
          const selected = newDrawWord();
          state.drawer = BLACK;
          state.word = selected.word;
          state.category = selected.category;
          state.strokes = [];
          state.guesses = [];
          state.winner = null;
          state.endReason = null;
          state.deadline = Date.now() + DRAW_DURATION;
        } else if (gameType === "coin") {
          state.seed = randomInt(1, 2_000_000_000);
          state.scores = { [BLACK]: 0, [WHITE]: 0 };
          state.finishedPlayers = [];
          state.winner = null;
          state.startedAt = Date.now() + 1_500;
          state.deadline = state.startedAt + COIN_DURATION;
        } else {
          state.currentPlayer = BLACK;
          state.history = [];
          state.board = blankBoard();
          state.winner = null;
        }
      }
    } else return json({ error: "接口不存在" }, 404);

    state.revision += 1;
    await this.ctx.storage.put("state", state);
    this.notifyWaiters();
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
  const roomTypes = {
    "/api/rooms": "gomoku",
    "/api/bomb-rooms": "bomb",
    "/api/draw-rooms": "draw",
    "/api/coin-rooms": "coin",
  };
  if (roomTypes[url.pathname] && request.method === "POST") {
    const gameType = roomTypes[url.pathname];
    const body = gameType === "bomb" ? await request.json().catch(() => ({})) : {};
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = roomCode();
      const name = gameType === "gomoku" ? code : `${gameType.toUpperCase()}:${code}`;
      const stub = env.ROOMS.get(env.ROOMS.idFromName(name));
      const response = await stub.fetch("https://room/create", {
        method: "POST",
        body: JSON.stringify({ code, gameType, min: body.min, max: body.max }),
      });
      if (response.status !== 409) return response;
    }
    return json({ error: "暂时无法创建房间，请重试" }, 503);
  }
  const match = url.pathname.match(/^\/api\/(rooms|bomb-rooms|draw-rooms|coin-rooms)\/([A-Z2-9]{6})\/(join|state|move|guess|draw|clear|score|finish|resign|rematch|leave)$/);
  if (!match) return json({ error: "接口不存在" }, 404);
  const routeTypes = { rooms: "gomoku", "bomb-rooms": "bomb", "draw-rooms": "draw", "coin-rooms": "coin" };
  const gameType = routeTypes[match[1]];
  const name = gameType === "gomoku" ? match[2] : `${gameType.toUpperCase()}:${match[2]}`;
  const stub = env.ROOMS.get(env.ROOMS.idFromName(name));
  const target = new URL(`https://room/${match[3]}`);
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
