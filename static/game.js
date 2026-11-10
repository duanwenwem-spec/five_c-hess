const SIZE = 15;
const EMPTY = 0;
const BLACK = 1;
const WHITE = 2;

const boardEl = document.querySelector("#board");
const turnText = document.querySelector("#turnText");
const turnBanner = document.querySelector("#turnBanner");
const newGameButton = document.querySelector("#newGame");
const undoButton = document.querySelector("#undoButton");
const soundButton = document.querySelector("#soundButton");
const thinkingEl = document.querySelector("#thinking");
const dialog = document.querySelector("#dialog");
const resultTitle = document.querySelector("#resultTitle");
const resultMessage = document.querySelector("#resultMessage");
const resultMark = document.querySelector("#resultMark");
const blackPlayer = document.querySelector("#blackPlayer");
const whitePlayer = document.querySelector("#whitePlayer");
const blackLabel = document.querySelector("#blackLabel");
const whiteLabel = document.querySelector("#whiteLabel");
const moveCount = document.querySelector("#moveCount");
const difficultySection = document.querySelector("#difficultySection");
const difficultyHint = document.querySelector("#difficultyHint");
const onlinePanel = document.querySelector("#onlinePanel");
const roomEntry = document.querySelector("#roomEntry");
const roomLobby = document.querySelector("#roomLobby");
const roomCodeInput = document.querySelector("#roomCodeInput");
const roomError = document.querySelector("#roomError");
const roomCodeEl = document.querySelector("#roomCode");
const roomStatus = document.querySelector("#roomStatus");
const connectionDot = document.querySelector("#connectionDot");

const DIFFICULTIES = {
  easy: { label: "入门", hint: "轻松落子" },
  normal: { label: "普通", hint: "攻守均衡" },
  hard: { label: "困难", hint: "谨慎预判" },
};

let board = [];
let currentPlayer = BLACK;
let gameOver = false;
let thinking = false;
let soundEnabled = true;
let mode = "ai";
let difficulty = "normal";
let history = [];
let requestVersion = 0;
let audioContext;
let statusMessage = "";
let onlineSession = null;
let onlineMoveCount = 0;
let onlineGeneration = 0;
let onlineResultRevision = -1;

function createBoard() {
  const fragment = document.createDocumentFragment();
  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "cell";
      cell.dataset.row = row;
      cell.dataset.col = col;
      cell.setAttribute("role", "gridcell");
      cell.setAttribute("aria-label", `第 ${row + 1} 行，第 ${col + 1} 列，空位`);
      cell.addEventListener("click", () => makeHumanMove(row, col));
      fragment.append(cell);
    }
  }
  boardEl.append(fragment);
}

function resetGame() {
  requestVersion += 1;
  board = Array.from({ length: SIZE }, () => Array(SIZE).fill(EMPTY));
  currentPlayer = BLACK;
  gameOver = false;
  thinking = false;
  history = [];
  statusMessage = "";
  dialog.hidden = true;
  thinkingEl.classList.remove("visible");
  document.querySelectorAll(".cell").forEach((cell) => {
    cell.className = "cell";
    const row = Number(cell.dataset.row) + 1;
    const col = Number(cell.dataset.col) + 1;
    cell.setAttribute("aria-label", `第 ${row} 行，第 ${col} 列，空位`);
  });
  boardEl.classList.remove("white-turn");
  boardEl.classList.add("black-turn");
  updateStatus();
}

function makeHumanMove(row, col) {
  if (mode === "online") {
    makeOnlineMove(row, col);
    return;
  }
  if (gameOver || thinking || board[row][col] !== EMPTY) return;
  if (mode === "ai" && currentPlayer !== BLACK) return;

  placeStone(row, col, currentPlayer);
  if (checkResult(row, col, currentPlayer)) return;

  currentPlayer = currentPlayer === BLACK ? WHITE : BLACK;
  updateStatus();
  if (mode === "ai") askComputerMove();
}

function placeStone(row, col, player) {
  board[row][col] = player;
  history.push({ row, col, player });
  document.querySelectorAll(".cell.last").forEach((cell) => cell.classList.remove("last"));
  const cell = cellAt(row, col);
  cell.classList.add(player === BLACK ? "black" : "white", "last");
  cell.setAttribute("aria-label", `第 ${row + 1} 行，第 ${col + 1} 列，${player === BLACK ? "黑棋" : "白棋"}`);
  undoButton.disabled = false;
  playStoneSound(player);
}

async function askComputerMove() {
  thinking = true;
  thinkingEl.classList.add("visible");
  updateStatus();
  const version = requestVersion;

  try {
    const response = await fetch("/api/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ board, difficulty }),
    });
    if (!response.ok) throw new Error("电脑暂时无法落子");
    const data = await response.json();
    if (version !== requestVersion || gameOver) return;
    if (data.move) {
      const { row, col } = data.move;
      placeStone(row, col, WHITE);
      if (checkResult(row, col, WHITE)) return;
    }
    currentPlayer = BLACK;
  } catch (error) {
    console.error(error);
    statusMessage = "连接失败，请重新开局";
  } finally {
    if (version === requestVersion) {
      thinking = false;
      thinkingEl.classList.remove("visible");
      updateStatus();
    }
  }
}

function checkResult(row, col, player) {
  if (hasFive(row, col, player)) {
    finishGame(player);
    return true;
  }
  if (history.length === SIZE * SIZE) {
    finishGame(EMPTY);
    return true;
  }
  return false;
}

function hasFive(row, col, player) {
  const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];
  return directions.some(([dr, dc]) => {
    let count = 1;
    for (const sign of [1, -1]) {
      let step = 1;
      while (board[row + dr * step * sign]?.[col + dc * step * sign] === player) {
        count += 1;
        step += 1;
      }
    }
    return count >= 5;
  });
}

function finishGame(winner) {
  gameOver = true;
  thinking = false;
  if (winner === EMPTY) {
    resultMark.textContent = "和";
    resultTitle.textContent = "本局和棋";
    resultMessage.textContent = "棋盘已满，双方势均力敌。";
  } else {
    const name = winner === BLACK ? "黑方" : "白方";
    resultMark.textContent = "胜";
    resultTitle.textContent = `${name}获胜`;
    resultMessage.textContent = mode === "ai" && winner === BLACK ? "漂亮的五连珠，你赢了电脑！" : "落子成势，漂亮的一局。";
  }
  const version = requestVersion;
  setTimeout(() => {
    if (version === requestVersion && gameOver) dialog.hidden = false;
  }, 330);
  updateStatus();
}

function undo() {
  if (gameOver || thinking || history.length === 0) return;
  const removeCount = mode === "ai" ? Math.min(2, history.length) : 1;
  for (let i = 0; i < removeCount; i += 1) {
    const move = history.pop();
    board[move.row][move.col] = EMPTY;
    const cell = cellAt(move.row, move.col);
    cell.className = "cell";
    cell.setAttribute("aria-label", `第 ${move.row + 1} 行，第 ${move.col + 1} 列，空位`);
  }
  if (history.length > 0) {
    const last = history.at(-1);
    cellAt(last.row, last.col).classList.add("last");
  }
  currentPlayer = mode === "ai" ? BLACK : (history.length % 2 === 0 ? BLACK : WHITE);
  undoButton.disabled = history.length === 0;
  updateStatus();
}

function updateStatus() {
  const stone = turnBanner.querySelector(".stone");
  stone.classList.toggle("black", currentPlayer === BLACK);
  stone.classList.toggle("white", currentPlayer === WHITE);
  const onlinePlaying = mode !== "online" || onlineSession?.status === "playing";
  blackPlayer.classList.toggle("active", currentPlayer === BLACK && !gameOver && onlinePlaying);
  whitePlayer.classList.toggle("active", currentPlayer === WHITE && !gameOver && onlinePlaying);
  boardEl.classList.toggle("black-turn", currentPlayer === BLACK);
  boardEl.classList.toggle("white-turn", currentPlayer === WHITE);
  const onlineLocked = mode === "online" && (
    !onlineSession || onlineSession.status !== "playing" || currentPlayer !== onlineSession.player
  );
  boardEl.classList.toggle("locked", gameOver || thinking || onlineLocked || (mode === "ai" && currentPlayer === WHITE));
  moveCount.textContent = mode === "online" ? onlineMoveCount : history.length;
  undoButton.disabled = mode === "online" || history.length === 0 || thinking || gameOver;
  if (statusMessage) turnText.textContent = statusMessage;
  else if (gameOver) turnText.textContent = "本局结束";
  else if (thinking) turnText.textContent = "电脑正在思考";
  else turnText.textContent = `${currentPlayer === BLACK ? "黑" : "白"}方落子`;
}

function updateSettings() {
  const isAi = mode === "ai";
  const isOnline = mode === "online";
  difficultySection.classList.toggle("disabled", !isAi);
  difficultySection.hidden = isOnline;
  onlinePanel.hidden = !isOnline;
  document.querySelectorAll("[data-difficulty]").forEach((button) => {
    const selected = button.dataset.difficulty === difficulty;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
    button.disabled = !isAi;
  });
  difficultyHint.textContent = isAi ? DIFFICULTIES[difficulty].hint : "仅人机模式可用";
  blackLabel.textContent = isOnline && onlineSession?.player === WHITE ? "对方" : "你";
  whiteLabel.textContent = isAi
    ? `电脑 · ${DIFFICULTIES[difficulty].label}`
    : (isOnline && onlineSession?.player === WHITE ? "你" : "玩家二");
  const mainActionText = newGameButton.querySelector("span");
  mainActionText.textContent = isOnline && onlineSession ? "离开房间" : "新对局";
  updateRoomPanel();
}

function updateRoomPanel() {
  if (!onlineSession) {
    roomEntry.hidden = false;
    roomLobby.hidden = true;
    return;
  }
  roomEntry.hidden = true;
  roomLobby.hidden = false;
  roomCodeEl.textContent = onlineSession.code;
  const waiting = onlineSession.status === "waiting";
  connectionDot.classList.toggle("connected", !waiting && onlineSession.opponentConnected);
  if (waiting) roomStatus.textContent = "等待对方加入";
  else if (onlineSession.status === "finished") roomStatus.textContent = "本局已结束";
  else if (!onlineSession.opponentConnected) roomStatus.textContent = "对方正在连接";
  else roomStatus.textContent = "双方已连接";
}

async function apiJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "网络请求失败");
  return data;
}

function saveOnlineSession() {
  if (!onlineSession) {
    sessionStorage.removeItem("gomoku-online-session");
    return;
  }
  sessionStorage.setItem("gomoku-online-session", JSON.stringify({
    code: onlineSession.code,
    token: onlineSession.token,
  }));
}

function enterOnlineSession(data) {
  onlineGeneration += 1;
  onlineSession = {
    code: data.roomCode,
    token: data.token,
    player: data.player,
    revision: data.revision,
    status: data.status,
    opponentConnected: data.opponentConnected,
  };
  saveOnlineSession();
  applyOnlineState(data);
  updateSettings();
  watchRoom(onlineGeneration);
}

function renderOnlineBoard(state) {
  board = state.board.map((row) => [...row]);
  document.querySelectorAll(".cell").forEach((cell) => {
    const row = Number(cell.dataset.row);
    const col = Number(cell.dataset.col);
    const player = board[row][col];
    cell.className = "cell";
    if (player !== EMPTY) cell.classList.add(player === BLACK ? "black" : "white");
    cell.setAttribute(
      "aria-label",
      `第 ${row + 1} 行，第 ${col + 1} 列，${player === BLACK ? "黑棋" : player === WHITE ? "白棋" : "空位"}`,
    );
  });
  if (state.lastMove) cellAt(state.lastMove.row, state.lastMove.col).classList.add("last");
}

function applyOnlineState(state) {
  if (!onlineSession || state.revision < onlineSession.revision) return;
  const previousMoveCount = onlineMoveCount;
  onlineSession.player = state.player;
  onlineSession.revision = state.revision;
  onlineSession.status = state.status;
  onlineSession.opponentConnected = state.opponentConnected;
  onlineSession.rematchRequested = state.rematchRequested;
  onlineMoveCount = state.moveCount;
  currentPlayer = state.currentPlayer;
  gameOver = state.status === "finished";
  thinking = false;
  renderOnlineBoard(state);

  if (state.lastMove && state.moveCount > previousMoveCount) playStoneSound(state.lastMove.player);
  if (state.status === "waiting") statusMessage = "房间已创建，等待对方加入";
  else if (state.status === "playing") {
    dialog.hidden = true;
    document.querySelector("#playAgain").disabled = false;
    onlineResultRevision = -1;
    statusMessage = currentPlayer === state.player ? "轮到你落子" : "等待对方落子";
  } else {
    statusMessage = "本局结束";
    showOnlineResult(state);
  }
  updateSettings();
  updateStatus();
}

function showOnlineResult(state) {
  if (onlineResultRevision === state.revision) return;
  onlineResultRevision = state.revision;
  if (state.winner === EMPTY) {
    resultMark.textContent = "和";
    resultTitle.textContent = "本局和棋";
    resultMessage.textContent = "棋盘已满，双方势均力敌。";
  } else {
    const won = state.winner === state.player;
    resultMark.textContent = won ? "胜" : "负";
    resultTitle.textContent = won ? "你赢了" : "对方获胜";
    resultMessage.textContent = won ? "漂亮的五连珠！" : "胜负已分，再来一局？";
  }
  document.querySelector("#playAgain").textContent = state.rematchRequested ? "等待对方确认" : "邀请再来一局";
  document.querySelector("#playAgain").disabled = Boolean(state.rematchRequested);
  dialog.hidden = false;
}

async function watchRoom(generation) {
  while (mode === "online" && onlineSession && generation === onlineGeneration) {
    const { code, token, revision } = onlineSession;
    try {
      const query = new URLSearchParams({ token, revision: String(revision) });
      const state = await apiJson(`/api/rooms/${code}/state?${query}`);
      if (generation !== onlineGeneration) return;
      applyOnlineState(state);
      if (state.revision === revision) {
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
    } catch (error) {
      if (generation !== onlineGeneration) return;
      roomStatus.textContent = "连接中断，正在重连";
      connectionDot.classList.remove("connected");
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
}

async function createOnlineRoom() {
  roomError.textContent = "";
  try {
    const data = await apiJson("/api/rooms", { method: "POST", body: "{}" });
    enterOnlineSession(data);
  } catch (error) {
    roomError.textContent = error.message;
  }
}

async function joinOnlineRoom() {
  const code = roomCodeInput.value.toUpperCase().replace(/[^A-Z2-9]/g, "");
  roomCodeInput.value = code;
  if (code.length !== 6) {
    roomError.textContent = "请输入六位房间号";
    return;
  }
  roomError.textContent = "";
  try {
    const data = await apiJson(`/api/rooms/${code}/join`, { method: "POST", body: "{}" });
    enterOnlineSession(data);
  } catch (error) {
    roomError.textContent = error.message;
  }
}

async function makeOnlineMove(row, col) {
  if (
    !onlineSession || thinking || gameOver || onlineSession.status !== "playing"
    || currentPlayer !== onlineSession.player || board[row][col] !== EMPTY
  ) return;
  const sentRevision = onlineSession.revision;
  const previousMoveCount = onlineMoveCount;
  const previousPlayer = currentPlayer;
  const player = onlineSession.player;

  // Show the move immediately. The authoritative server response below will
  // confirm it, while a rejected request rolls this preview back.
  thinking = true;
  board[row][col] = player;
  onlineMoveCount += 1;
  currentPlayer = player === BLACK ? WHITE : BLACK;
  document.querySelectorAll(".cell.last").forEach((cell) => cell.classList.remove("last"));
  const optimisticCell = cellAt(row, col);
  optimisticCell.classList.add(player === BLACK ? "black" : "white", "last");
  optimisticCell.setAttribute("aria-label", `第 ${row + 1} 行，第 ${col + 1} 列，${player === BLACK ? "黑棋" : "白棋"}`);
  statusMessage = "落子已发送，等待对方";
  playStoneSound(player);
  updateStatus();
  try {
    const state = await apiJson(`/api/rooms/${onlineSession.code}/move`, {
      method: "POST",
      body: JSON.stringify({
        token: onlineSession.token,
        row,
        col,
        revision: sentRevision,
      }),
    });
    applyOnlineState(state);
  } catch (error) {
    // Do not undo a move already confirmed by the parallel room watcher.
    if (onlineSession?.revision === sentRevision) {
      board[row][col] = EMPTY;
      onlineMoveCount = previousMoveCount;
      currentPlayer = previousPlayer;
      optimisticCell.className = "cell";
      optimisticCell.setAttribute("aria-label", `第 ${row + 1} 行，第 ${col + 1} 列，空位`);
      statusMessage = error.message;
    }
  } finally {
    thinking = false;
    updateStatus();
  }
}

async function requestRematch() {
  if (!onlineSession || onlineSession.rematchRequested) return;
  try {
    const state = await apiJson(`/api/rooms/${onlineSession.code}/rematch`, {
      method: "POST",
      body: JSON.stringify({ token: onlineSession.token }),
    });
    dialog.hidden = true;
    onlineResultRevision = -1;
    applyOnlineState(state);
  } catch (error) {
    resultMessage.textContent = error.message;
  }
}

async function leaveOnlineRoom() {
  if (onlineSession) {
    fetch(`/api/rooms/${onlineSession.code}/leave`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: onlineSession.token }),
      keepalive: true,
    }).catch(() => {});
  }
  onlineGeneration += 1;
  onlineSession = null;
  onlineMoveCount = 0;
  onlineResultRevision = -1;
  saveOnlineSession();
  resetGame();
  statusMessage = "创建房间或输入房间号";
  updateSettings();
  updateStatus();
}

async function restoreOnlineSession() {
  const saved = sessionStorage.getItem("gomoku-online-session");
  if (!saved) return;
  try {
    const session = JSON.parse(saved);
    const query = new URLSearchParams({ token: session.token, revision: "-1" });
    const state = await apiJson(`/api/rooms/${session.code}/state?${query}`);
    mode = "online";
    document.querySelectorAll(".mode").forEach((item) => item.classList.toggle("active", item.dataset.mode === mode));
    enterOnlineSession({ ...state, token: session.token });
  } catch {
    sessionStorage.removeItem("gomoku-online-session");
  }
}

function cellAt(row, col) {
  return boardEl.children[row * SIZE + col];
}

function playStoneSound(player) {
  if (!soundEnabled) return;
  try {
    audioContext ||= new AudioContext();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = player === BLACK ? 155 : 190;
    gain.gain.setValueAtTime(0.06, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.08);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.08);
  } catch (_) { /* Sound is optional. */ }
}

document.querySelectorAll(".mode").forEach((button) => {
  button.addEventListener("click", () => {
    const previousMode = mode;
    mode = button.dataset.mode;
    if (previousMode === "online" && mode !== "online") onlineGeneration += 1;
    document.querySelectorAll(".mode").forEach((item) => item.classList.toggle("active", item === button));
    if (mode === "online" && onlineSession) {
      watchRoom(++onlineGeneration);
    } else {
      resetGame();
      if (mode === "online") statusMessage = "创建房间或输入房间号";
    }
    updateSettings();
    updateStatus();
  });
});

document.querySelectorAll("[data-difficulty]").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.difficulty === difficulty) return;
    difficulty = button.dataset.difficulty;
    updateSettings();
    resetGame();
  });
});

newGameButton.addEventListener("click", () => {
  if (mode === "online") leaveOnlineRoom();
  else resetGame();
});
document.querySelector("#playAgain").addEventListener("click", () => {
  if (mode === "online") requestRematch();
  else resetGame();
});
undoButton.addEventListener("click", undo);
document.querySelector("#createRoom").addEventListener("click", createOnlineRoom);
document.querySelector("#joinRoom").addEventListener("click", joinOnlineRoom);
roomCodeInput.addEventListener("input", () => {
  roomCodeInput.value = roomCodeInput.value.toUpperCase().replace(/[^A-Z2-9]/g, "");
});
roomCodeInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") joinOnlineRoom();
});
roomCodeEl.addEventListener("click", async () => {
  await navigator.clipboard.writeText(onlineSession?.code || "").catch(() => {});
  roomStatus.textContent = "房间号已复制";
});
document.querySelector("#copyInvite").addEventListener("click", async () => {
  if (!onlineSession) return;
  const invite = `${location.origin}${location.pathname}?room=${onlineSession.code}`;
  await navigator.clipboard.writeText(invite).catch(() => {});
  roomStatus.textContent = "邀请链接已复制";
});
soundButton.addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  soundButton.classList.toggle("muted", !soundEnabled);
  soundButton.setAttribute("aria-label", soundEnabled ? "关闭落子音效" : "打开落子音效");
});
document.addEventListener("keydown", (event) => {
  if (event.key.toLowerCase() === "r" && !event.ctrlKey && !event.metaKey && mode !== "online") resetGame();
  if (event.key.toLowerCase() === "u" && !event.ctrlKey && !event.metaKey) undo();
});

createBoard();
updateSettings();
resetGame();
const invitedRoom = new URLSearchParams(location.search).get("room");
const onlineStart = new URLSearchParams(location.search).get("online") === "1";
if (invitedRoom || onlineStart) {
  mode = "online";
  if (invitedRoom) roomCodeInput.value = invitedRoom.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 6);
  document.querySelectorAll(".mode").forEach((item) => item.classList.toggle("active", item.dataset.mode === mode));
  statusMessage = invitedRoom ? "输入房间号加入对局" : "创建房间或输入房间号";
  updateSettings();
  updateStatus();
}
restoreOnlineSession();
