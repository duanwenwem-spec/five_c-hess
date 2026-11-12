const BLACK = 1;
const WHITE = 2;
const canvas = document.querySelector("#drawingCanvas");
const ctx = canvas.getContext("2d");
const setupView = document.querySelector("#drawSetup");
const gameView = document.querySelector("#drawGame");
const setupError = document.querySelector("#drawSetupError");
const gameError = document.querySelector("#drawGameError");
const roomInput = document.querySelector("#drawRoomInput");
const roomInfo = document.querySelector("#drawRoomInfo");
const roomCodeEl = document.querySelector("#drawRoomCode");
const connectionDot = document.querySelector("#drawConnectionDot");
const timerEl = document.querySelector("#drawTimer");
const roleLabel = document.querySelector("#drawRoleLabel");
const wordDisplay = document.querySelector("#drawWordDisplay");
const categoryEl = document.querySelector("#drawCategory");
const canvasWrap = document.querySelector("#canvasWrap");
const waitingOverlay = document.querySelector("#drawWaiting");
const drawingTools = document.querySelector("#drawingTools");
const guessForm = document.querySelector("#drawGuessForm");
const guessInput = document.querySelector("#drawGuessInput");
const guessButton = document.querySelector("#submitDrawGuess");
const guessLog = document.querySelector("#drawGuessLog");
const strokeCount = document.querySelector("#strokeCount");
const hintEl = document.querySelector("#drawHint");
const playerOne = document.querySelector("#drawPlayerOne");
const playerTwo = document.querySelector("#drawPlayerTwo");
const playerOneName = document.querySelector("#drawPlayerOneName");
const playerTwoName = document.querySelector("#drawPlayerTwoName");
const playerOneRole = document.querySelector("#drawPlayerOneRole");
const playerTwoRole = document.querySelector("#drawPlayerTwoRole");
const resultDialog = document.querySelector("#drawResult");
const resultMark = document.querySelector("#drawResultMark");
const resultTitle = document.querySelector("#drawResultTitle");
const resultText = document.querySelector("#drawResultText");
const playAgainButton = document.querySelector("#drawPlayAgain");

let mode = "solo";
let strokes = [];
let guesses = [];
let deadline = null;
let currentPuzzle = null;
let revealTimer;
let gameTimer;
let drawing = false;
let currentStroke = [];
let onlineSession = null;
let onlineGeneration = 0;
let resultRevision = -1;
let strokeQueue = Promise.resolve();
let audioContext;

const line = (...points) => points.map(([x, y]) => ({ x, y }));
const arc = (cx, cy, rx, ry, start = 0, end = Math.PI * 2, steps = 36) => Array.from({ length: steps + 1 }, (_, index) => {
  const angle = start + (end - start) * index / steps;
  return { x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry };
});
const rect = (x, y, w, h) => line([x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]);

const SOLO_PUZZLES = [
  { word: "太阳", category: "自然", aliases: ["太阳"], build: () => [arc(.5,.45,.17,.17), ...Array.from({length:8},(_,i)=>{const a=i*Math.PI/4;return line([.5+Math.cos(a)*.23,.45+Math.sin(a)*.23],[.5+Math.cos(a)*.32,.45+Math.sin(a)*.32])})] },
  { word: "房子", category: "建筑", aliases: ["房子","房屋"], build: () => [line([.22,.48],[.5,.22],[.78,.48]),rect(.29,.48,.42,.34),rect(.44,.63,.13,.19),rect(.34,.56,.09,.09),rect(.59,.56,.09,.09)] },
  { word: "小鱼", category: "动物", aliases: ["鱼","小鱼"], build: () => [arc(.47,.5,.24,.15),line([.69,.5],[.84,.35],[.84,.65],[.69,.5]),arc(.38,.47,.018,.018),line([.27,.5],[.37,.5])] },
  { word: "雨伞", category: "物品", aliases: ["伞","雨伞"], build: () => [arc(.5,.5,.31,.25,Math.PI,Math.PI*2,28),line([.19,.5],[.29,.55],[.4,.5],[.5,.55],[.61,.5],[.71,.55],[.81,.5]),line([.5,.26],[.5,.75]),arc(.56,.75,.06,.08,Math.PI,0,14)] },
  { word: "苹果", category: "食物", aliases: ["苹果"], build: () => [arc(.5,.54,.22,.24),line([.5,.3],[.53,.18]),arc(.61,.22,.1,.05,Math.PI,.0,15)] },
  { word: "小猫", category: "动物", aliases: ["猫","小猫","猫咪"], build: () => [arc(.5,.52,.22,.21),line([.31,.4],[.32,.22],[.44,.33]),line([.56,.33],[.68,.22],[.69,.4]),arc(.43,.49,.018,.018),arc(.57,.49,.018,.018),line([.48,.57],[.5,.59],[.52,.57]),line([.36,.59],[.22,.56]),line([.36,.63],[.21,.65]),line([.64,.59],[.78,.56]),line([.64,.63],[.79,.65])] },
  { word: "帆船", category: "交通", aliases: ["船","帆船"], build: () => [line([.22,.68],[.75,.68],[.66,.8],[.33,.8],[.22,.68]),line([.5,.25],[.5,.68]),line([.49,.28],[.29,.62],[.49,.62]),line([.52,.31],[.7,.59],[.52,.59]),arc(.5,.83,.35,.05,0,Math.PI,20)] },
  { word: "大树", category: "植物", aliases: ["树","大树"], build: () => [rect(.44,.57,.12,.27),arc(.37,.5,.16,.17),arc(.55,.43,.18,.2),arc(.67,.53,.15,.16),line([.5,.57],[.38,.45]),line([.5,.58],[.64,.47])] },
];

function setMode(nextMode) {
  mode = nextMode;
  document.querySelectorAll("[data-draw-mode]").forEach((button) => {
    const active = button.dataset.drawMode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  document.querySelector("#startDrawSolo").hidden = mode !== "solo";
  document.querySelector("#drawOnlineActions").hidden = mode !== "online";
  setupError.textContent = "";
}

function openGame() {
  setupView.hidden = true;
  gameView.hidden = false;
  resultDialog.hidden = true;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function clearTimers() {
  window.clearInterval(revealTimer);
  window.clearInterval(gameTimer);
}

function renderCanvas() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "#24483f";
  ctx.lineWidth = 7;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  [...strokes, ...(currentStroke.length ? [currentStroke] : [])].forEach((stroke) => {
    if (stroke.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(stroke[0].x * canvas.width, stroke[0].y * canvas.height);
    for (const point of stroke.slice(1)) ctx.lineTo(point.x * canvas.width, point.y * canvas.height);
    ctx.stroke();
  });
}

function renderGuessLog() {
  if (!guesses.length) {
    guessLog.innerHTML = '<li class="empty-log">答案正在画布上慢慢出现</li>';
    return;
  }
  guessLog.innerHTML = [...guesses].reverse().map((entry) => `<li>${entry.player === onlineSession?.player || mode === "solo" ? "你" : "好友"}猜：<b>${entry.text}</b>${entry.correct ? " · 猜对了" : " · 不对哦"}</li>`).join("");
}

function onlineIsDrawer() { return mode === "online" && onlineSession?.player === onlineSession?.drawer; }

function renderGame() {
  const waiting = mode === "online" && onlineSession?.status === "waiting";
  const finished = mode === "online" && onlineSession?.status === "finished";
  const isDrawer = onlineIsDrawer();
  waitingOverlay.hidden = !waiting;
  roomInfo.hidden = mode !== "online" || !onlineSession;
  if (onlineSession) {
    roomCodeEl.textContent = onlineSession.code;
    connectionDot.classList.toggle("connected", onlineSession.status !== "waiting" && onlineSession.opponentConnected);
  }
  const canDraw = mode === "online" && isDrawer && !waiting && !finished;
  canvasWrap.classList.toggle("readonly", !canDraw);
  drawingTools.hidden = !canDraw;
  guessInput.disabled = waiting || finished || (mode === "online" && isDrawer);
  guessButton.disabled = guessInput.disabled;
  guessForm.hidden = mode === "online" && isDrawer;

  if (mode === "solo") {
    roleLabel.textContent = "系统正在逐笔作画";
    wordDisplay.textContent = Array.from({ length: [...currentPuzzle.word].length }, () => "_").join(" ");
    categoryEl.textContent = `类别：${currentPuzzle.category}`;
    playerOneName.textContent = "系统"; playerTwoName.textContent = "你";
    playerOneRole.textContent = "作画"; playerTwoRole.textContent = "猜词";
    playerOne.classList.add("active"); playerTwo.classList.remove("active");
    hintEl.textContent = `这是一个${currentPuzzle.category}类词语，共 ${[...currentPuzzle.word].length} 个字。`;
  } else if (onlineSession) {
    roleLabel.textContent = waiting ? "等待好友加入" : isDrawer ? "轮到你作画" : "好友正在作画";
    wordDisplay.textContent = isDrawer || finished ? onlineSession.word : Array.from({ length: onlineSession.wordLength || 2 }, () => "_").join(" ");
    categoryEl.textContent = `类别：${onlineSession.category || "等待揭晓"}`;
    const oneIsMe = onlineSession.player === BLACK;
    playerOneName.textContent = oneIsMe ? "你" : "好友";
    playerTwoName.textContent = oneIsMe ? "好友" : "你";
    playerOneRole.textContent = onlineSession.drawer === BLACK ? "作画" : "猜词";
    playerTwoRole.textContent = onlineSession.drawer === WHITE ? "作画" : "猜词";
    playerOne.classList.toggle("active", onlineSession.drawer === BLACK && !finished);
    playerTwo.classList.toggle("active", onlineSession.drawer === WHITE && !finished);
    hintEl.textContent = isDrawer ? "只能画图，不能在画板上写出答案。" : `答案属于${onlineSession.category || "未知"}类，共 ${onlineSession.wordLength || 2} 个字。`;
  }
  strokeCount.textContent = `${strokes.length} 笔`;
  renderCanvas();
  renderGuessLog();
}

function tickTimer() {
  if (!deadline) { timerEl.textContent = "--"; return; }
  const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  timerEl.textContent = remaining;
  if (mode === "solo" && remaining === 0 && !resultDialog.hidden) return;
  if (mode === "solo" && remaining === 0) finishSolo(false);
}

function startSolo() {
  clearTimers();
  let next;
  do { next = SOLO_PUZZLES[Math.floor(Math.random() * SOLO_PUZZLES.length)]; } while (SOLO_PUZZLES.length > 1 && next === currentPuzzle);
  currentPuzzle = next;
  strokes = [];
  guesses = [];
  onlineSession = null;
  onlineGeneration += 1;
  deadline = Date.now() + 60_000;
  openGame();
  renderGame();
  const puzzleStrokes = currentPuzzle.build();
  let index = 0;
  revealTimer = window.setInterval(() => {
    if (index >= puzzleStrokes.length) { window.clearInterval(revealTimer); return; }
    strokes.push(puzzleStrokes[index]);
    index += 1;
    playTone(320 + index * 12);
    renderGame();
  }, 620);
  gameTimer = window.setInterval(tickTimer, 250);
  tickTimer();
  guessInput.value = "";
  guessInput.focus();
}

function playTone(frequency = 440, success = false) {
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    audioContext.resume();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = success ? "triangle" : "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(success ? .06 : .025, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, audioContext.currentTime + (success ? .28 : .08));
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(); oscillator.stop(audioContext.currentTime + (success ? .28 : .08));
  } catch (_) { /* Optional feedback. */ }
}

function finishSolo(won) {
  clearTimers();
  playTone(won ? 660 : 150, won);
  resultMark.textContent = won ? "✓" : "…";
  resultTitle.textContent = won ? "猜对了" : "时间到了";
  resultText.textContent = `答案是“${currentPuzzle.word}”`;
  playAgainButton.querySelector("span").textContent = "再来一题";
  playAgainButton.disabled = false;
  resultDialog.hidden = false;
}

async function apiJson(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "网络请求失败");
  return data;
}

function saveSession() {
  if (!onlineSession) sessionStorage.removeItem("draw-online-session");
  else sessionStorage.setItem("draw-online-session", JSON.stringify({ code: onlineSession.code, token: onlineSession.token }));
}

function enterOnlineSession(data) {
  clearTimers();
  mode = "online";
  onlineGeneration += 1;
  onlineSession = { code: data.roomCode, token: data.token };
  saveSession();
  openGame();
  applyOnlineState(data);
  gameTimer = window.setInterval(tickTimer, 250);
  watchRoom(onlineGeneration);
}

function applyOnlineState(state) {
  if (!onlineSession || (onlineSession.revision ?? -1) > state.revision) return;
  Object.assign(onlineSession, {
    player: state.player, drawer: state.drawer, isDrawer: state.isDrawer, word: state.word,
    wordLength: state.wordLength, category: state.category, status: state.status,
    revision: state.revision, opponentConnected: state.opponentConnected,
    rematchRequested: state.rematchRequested, winner: state.winner, endReason: state.endReason,
  });
  strokes = state.strokes || [];
  guesses = state.guesses || [];
  deadline = state.deadline;
  gameError.textContent = "";
  if (state.status === "playing") {
    resultDialog.hidden = true;
    resultRevision = -1;
  } else if (state.status === "finished" && resultRevision !== state.revision) {
    resultRevision = state.revision;
    showOnlineResult(state);
  }
  renderGame();
  tickTimer();
}

function showOnlineResult(state) {
  const left = state.endReason === "leave";
  const correct = state.endReason === "correct";
  const won = state.winner === state.player;
  resultMark.textContent = correct || left ? "✓" : "…";
  resultTitle.textContent = left ? "好友已离开房间" : correct ? (won ? "你猜对了" : "好友猜对了") : "时间到了";
  resultText.textContent = `答案是“${state.word}”`;
  playAgainButton.querySelector("span").textContent = state.rematchRequested ? "等待好友确认" : "邀请再来一局";
  playAgainButton.disabled = Boolean(state.rematchRequested);
  resultDialog.hidden = false;
  playTone(correct ? 660 : 150, correct);
}

async function watchRoom(generation) {
  while (mode === "online" && onlineSession && generation === onlineGeneration) {
    const { code, token, revision } = onlineSession;
    try {
      const query = new URLSearchParams({ token, revision: String(revision ?? -1) });
      const state = await apiJson(`/api/draw-rooms/${code}/state?${query}`);
      if (generation !== onlineGeneration) return;
      applyOnlineState(state);
      if (state.revision === revision) await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (_) {
      if (generation !== onlineGeneration) return;
      connectionDot.classList.remove("connected");
      await new Promise((resolve) => setTimeout(resolve, 1400));
    }
  }
}

async function createRoom() {
  setupError.textContent = "";
  const button = document.querySelector("#createDrawRoom");
  button.disabled = true;
  try { enterOnlineSession(await apiJson("/api/draw-rooms", { method: "POST", body: "{}" })); }
  catch (error) { setupError.textContent = error.message; }
  finally { button.disabled = false; }
}

async function joinRoom() {
  const code = roomInput.value.toUpperCase().replace(/[^A-Z2-9]/g, "");
  roomInput.value = code;
  if (code.length !== 6) { setupError.textContent = "请输入六位房间号"; return; }
  try { enterOnlineSession(await apiJson(`/api/draw-rooms/${code}/join`, { method: "POST", body: "{}" })); }
  catch (error) { setupError.textContent = error.message; }
}

function pointFromEvent(event) {
  const bounds = canvas.getBoundingClientRect();
  return { x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)), y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)) };
}

canvas.addEventListener("pointerdown", (event) => {
  if (!onlineIsDrawer() || onlineSession.status !== "playing") return;
  drawing = true;
  currentStroke = [pointFromEvent(event)];
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener("pointermove", (event) => {
  if (!drawing) return;
  const point = pointFromEvent(event);
  const last = currentStroke.at(-1);
  if (Math.hypot(point.x - last.x, point.y - last.y) > .003) currentStroke.push(point);
  renderCanvas();
});
canvas.addEventListener("pointerup", () => {
  if (!drawing) return;
  drawing = false;
  const completed = currentStroke;
  currentStroke = [];
  if (completed.length < 2) { renderCanvas(); return; }
  strokes.push(completed);
  renderGame();
  strokeQueue = strokeQueue.then(async () => {
    if (!onlineSession) return;
    try {
      const state = await apiJson(`/api/draw-rooms/${onlineSession.code}/draw`, { method: "POST", body: JSON.stringify({ token: onlineSession.token, stroke: completed, revision: onlineSession.revision }) });
      applyOnlineState(state);
    } catch (error) { gameError.textContent = error.message; }
  });
});

guessForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const answer = guessInput.value.trim();
  if (!answer) return;
  guessInput.value = "";
  if (mode === "solo") {
    const correct = currentPuzzle.aliases.some((alias) => alias === answer.replace(/\s/g, ""));
    guesses.push({ player: WHITE, text: answer, correct });
    renderGame();
    playTone(correct ? 660 : 190, correct);
    if (correct) finishSolo(true);
    else gameError.textContent = "还不对，再观察一下画面";
    return;
  }
  if (!onlineSession || onlineIsDrawer()) return;
  try {
    applyOnlineState(await apiJson(`/api/draw-rooms/${onlineSession.code}/guess`, { method: "POST", body: JSON.stringify({ token: onlineSession.token, guess: answer }) }));
  } catch (error) { gameError.textContent = error.message; }
});

document.querySelector("#clearCanvas").addEventListener("click", () => {
  strokeQueue = strokeQueue.then(async () => {
    if (!onlineSession) return;
    try { applyOnlineState(await apiJson(`/api/draw-rooms/${onlineSession.code}/clear`, { method: "POST", body: JSON.stringify({ token: onlineSession.token }) })); }
    catch (error) { gameError.textContent = error.message; }
  });
});

async function rematch() {
  if (mode === "solo") { startSolo(); return; }
  if (!onlineSession || onlineSession.status !== "finished") return;
  try {
    applyOnlineState(await apiJson(`/api/draw-rooms/${onlineSession.code}/rematch`, { method: "POST", body: JSON.stringify({ token: onlineSession.token }) }));
    playAgainButton.querySelector("span").textContent = "等待好友确认";
    playAgainButton.disabled = true;
  } catch (error) { gameError.textContent = error.message; }
}

async function exitGame() {
  const session = onlineSession;
  clearTimers();
  onlineGeneration += 1;
  onlineSession = null;
  saveSession();
  if (session && session.status !== "finished") apiJson(`/api/draw-rooms/${session.code}/leave`, { method: "POST", body: JSON.stringify({ token: session.token }) }).catch(() => {});
  resultDialog.hidden = true;
  gameView.hidden = true;
  setupView.hidden = false;
}

async function restoreSession() {
  const saved = sessionStorage.getItem("draw-online-session");
  if (!saved) return;
  try {
    const session = JSON.parse(saved);
    const query = new URLSearchParams({ token: session.token, revision: "-1" });
    const state = await apiJson(`/api/draw-rooms/${session.code}/state?${query}`);
    setMode("online"); enterOnlineSession({ ...state, token: session.token });
  } catch (_) { sessionStorage.removeItem("draw-online-session"); }
}

document.querySelectorAll("[data-draw-mode]").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.drawMode)));
document.querySelector("#startDrawSolo").addEventListener("click", startSolo);
document.querySelector("#createDrawRoom").addEventListener("click", createRoom);
document.querySelector("#joinDrawRoom").addEventListener("click", joinRoom);
roomInput.addEventListener("input", () => { roomInput.value = roomInput.value.toUpperCase().replace(/[^A-Z2-9]/g, ""); });
roomInput.addEventListener("keydown", (event) => { if (event.key === "Enter") joinRoom(); });
document.querySelector("#exitDrawGame").addEventListener("click", exitGame);
document.querySelector("#drawResultExit").addEventListener("click", exitGame);
playAgainButton.addEventListener("click", rematch);
roomCodeEl.addEventListener("click", () => navigator.clipboard.writeText(onlineSession?.code || "").catch(() => {}));
document.querySelector("#copyDrawInvite").addEventListener("click", async (event) => {
  if (!onlineSession) return;
  await navigator.clipboard.writeText(`${location.origin}/draw.html?room=${onlineSession.code}`).catch(() => {});
  event.currentTarget.textContent = "已复制";
  window.setTimeout(() => { event.currentTarget.textContent = "复制邀请链接"; }, 1200);
});

const invitedRoom = new URLSearchParams(location.search).get("room");
if (invitedRoom) { setMode("online"); roomInput.value = invitedRoom.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 6); }
else restoreSession();
