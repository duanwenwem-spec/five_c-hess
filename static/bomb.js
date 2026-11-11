const PLAYER_ONE = 1;
const PLAYER_TWO = 2;

const setupView = document.querySelector("#setupView");
const gameView = document.querySelector("#gameView");
const setupError = document.querySelector("#setupError");
const gameError = document.querySelector("#gameError");
const minInput = document.querySelector("#minInput");
const maxInput = document.querySelector("#maxInput");
const startSoloButton = document.querySelector("#startSolo");
const onlineActions = document.querySelector("#onlineActions");
const roomInput = document.querySelector("#bombRoomInput");
const currentMinEl = document.querySelector("#currentMin");
const currentMaxEl = document.querySelector("#currentMax");
const guessInput = document.querySelector("#guessInput");
const guessButton = document.querySelector("#guessButton");
const guessForm = document.querySelector("#guessForm");
const guessHistory = document.querySelector("#guessHistory");
const guessCount = document.querySelector("#guessCount");
const turnLabel = document.querySelector("#turnLabel");
const turnPill = document.querySelector("#turnPill");
const lastClue = document.querySelector("#lastClue");
const rangeTrack = document.querySelector("#rangeTrack");
const playerOne = document.querySelector("#playerOne");
const playerTwo = document.querySelector("#playerTwo");
const playerOneName = document.querySelector("#playerOneName");
const playerTwoName = document.querySelector("#playerTwoName");
const playerTwoState = document.querySelector("#playerTwoState");
const roomInfo = document.querySelector("#roomInfo");
const roomCodeEl = document.querySelector("#bombRoomCode");
const connectionDot = document.querySelector("#bombConnectionDot");
const resultDialog = document.querySelector("#bombResult");
const resultTitle = document.querySelector("#bombResultTitle");
const resultText = document.querySelector("#bombResultText");
const playAgainButton = document.querySelector("#bombPlayAgain");

let mode = "solo";
let initialMin = 1;
let initialMax = 100;
let currentMin = 1;
let currentMax = 100;
let secretNumber = null;
let currentPlayer = PLAYER_ONE;
let history = [];
let finished = false;
let thinking = false;
let onlineSession = null;
let onlineGeneration = 0;
let onlineResultRevision = -1;
let audioContext;

function secureRandomInt(min, max) {
  const span = max - min + 1;
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return min + Math.floor((values[0] / 4294967296) * span);
}

function validateRange() {
  const min = Number(minInput.value);
  const max = Number(maxInput.value);
  if (!Number.isInteger(min) || !Number.isInteger(max)) throw new Error("请输入整数范围");
  if (min < 1 || max > 9999) throw new Error("范围需要在 1—9999 之间");
  if (max - min < 9) throw new Error("范围至少需要包含 10 个数字");
  return { min, max };
}

function setMode(nextMode) {
  mode = nextMode;
  document.querySelectorAll("[data-bomb-mode]").forEach((button) => {
    const active = button.dataset.bombMode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  startSoloButton.hidden = mode !== "solo";
  onlineActions.hidden = mode !== "online";
  setupError.textContent = "";
}

function openGame() {
  setupView.hidden = true;
  gameView.hidden = false;
  resultDialog.hidden = true;
  gameError.textContent = "";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function startSolo() {
  try {
    const range = validateRange();
    initialMin = range.min;
    initialMax = range.max;
  } catch (error) {
    setupError.textContent = error.message;
    return;
  }
  currentMin = initialMin;
  currentMax = initialMax;
  secretNumber = secureRandomInt(initialMin, initialMax);
  currentPlayer = PLAYER_ONE;
  history = [];
  finished = false;
  thinking = false;
  onlineSession = null;
  onlineGeneration += 1;
  playerOneName.textContent = "你";
  playerTwoName.textContent = "电脑";
  playerTwoState.textContent = "等待";
  roomInfo.hidden = true;
  openGame();
  renderGame();
  guessInput.focus();
}

function clueText(entry) {
  if (!entry) return "输入一个数字，试探它的位置";
  if (entry.hit) return `${entry.guess} 就是炸弹数字`;
  return entry.direction === "higher"
    ? `${entry.guess} 太小了，炸弹数字更大`
    : `${entry.guess} 太大了，炸弹数字更小`;
}

function renderHistory() {
  if (!history.length) {
    guessHistory.innerHTML = '<li class="empty-history">还没有人猜数字</li>';
    return;
  }
  guessHistory.innerHTML = [...history].reverse().map((entry) => {
    const isMine = mode === "solo" ? entry.player === PLAYER_ONE : entry.player === onlineSession?.player;
    const name = isMine ? "你" : (mode === "solo" ? "电脑" : "对方");
    const hint = entry.hit ? "踩中炸弹" : entry.direction === "higher" ? "数字更大" : "数字更小";
    return `<li class="${isMine ? "" : "opponent"}"><span>${name.slice(0, 1)}</span><strong>${entry.guess}</strong><span class="history-hint">${hint}</span></li>`;
  }).join("");
}

function renderGame() {
  currentMinEl.textContent = currentMin;
  currentMaxEl.textContent = currentMax;
  guessCount.textContent = history.length;
  guessInput.min = currentMin;
  guessInput.max = currentMax;
  guessInput.placeholder = `${currentMin}—${currentMax}`;
  const remaining = Math.max(1, currentMax - currentMin + 1);
  const original = Math.max(1, initialMax - initialMin + 1);
  rangeTrack.style.transform = `scaleX(${Math.max(.025, remaining / original)})`;
  lastClue.textContent = clueText(history.at(-1));
  renderHistory();

  const myOnlineTurn = mode === "online" && onlineSession?.status === "playing" && currentPlayer === onlineSession.player;
  const myTurn = mode === "solo" ? currentPlayer === PLAYER_ONE : myOnlineTurn;
  const waiting = mode === "online" && onlineSession?.status === "waiting";
  const canGuess = !finished && !thinking && !waiting && myTurn;
  guessInput.disabled = !canGuess;
  guessButton.disabled = !canGuess;
  turnPill.classList.toggle("waiting", !canGuess);

  if (waiting) turnLabel.textContent = "等待好友加入房间";
  else if (finished) turnLabel.textContent = "本局已经结束";
  else if (myTurn) turnLabel.textContent = "轮到你猜";
  else turnLabel.textContent = mode === "solo" ? "电脑正在猜" : "等待对方猜数字";

  const firstIsMe = mode === "solo" || onlineSession?.player === PLAYER_ONE;
  playerOneName.textContent = firstIsMe ? "你" : "对方";
  playerTwoName.textContent = firstIsMe ? (mode === "solo" ? "电脑" : "对方") : "你";
  playerOne.classList.toggle("active", !finished && currentPlayer === PLAYER_ONE);
  playerTwo.classList.toggle("active", !finished && currentPlayer === PLAYER_TWO);
  playerTwoState.textContent = mode === "solo" && thinking ? "思考中…" : "后手";

  if (mode === "online" && onlineSession) {
    roomInfo.hidden = false;
    roomCodeEl.textContent = onlineSession.code;
    connectionDot.classList.toggle("connected", onlineSession.status !== "waiting" && onlineSession.opponentConnected);
  }
}

function playEffect(explosion = false) {
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    audioContext.resume();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = explosion ? "sawtooth" : "sine";
    oscillator.frequency.setValueAtTime(explosion ? 120 : 260, audioContext.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(explosion ? 45 : 190, audioContext.currentTime + (explosion ? .35 : .1));
    gain.gain.setValueAtTime(explosion ? .1 : .035, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, audioContext.currentTime + (explosion ? .4 : .11));
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + (explosion ? .4 : .11));
  } catch (_) { /* Audio feedback is optional. */ }
}

function showResult(loser, bomb) {
  playEffect(true);
  const lost = mode === "solo" ? loser === PLAYER_ONE : loser === onlineSession?.player;
  resultTitle.textContent = lost ? "你踩中炸弹了" : (mode === "solo" ? "电脑踩中炸弹" : "对方踩中炸弹");
  resultText.textContent = `炸弹数字是 ${bomb}，${lost ? "这局有点可惜。" : "你赢得了这一局！"}`;
  playAgainButton.querySelector("span").textContent = mode === "online" ? "邀请再来一局" : "再来一局";
  playAgainButton.disabled = false;
  resultDialog.hidden = false;
}

function applySoloGuess(player, guess) {
  const hit = guess === secretNumber;
  const direction = hit ? "boom" : guess < secretNumber ? "higher" : "lower";
  history.push({ player, guess, hit, direction });
  if (!hit) playEffect(false);
  if (hit) {
    finished = true;
    renderGame();
    window.setTimeout(() => showResult(player, secretNumber), 280);
    return;
  }
  if (direction === "higher") currentMin = guess + 1;
  else currentMax = guess - 1;
  currentPlayer = player === PLAYER_ONE ? PLAYER_TWO : PLAYER_ONE;
  renderGame();
  if (currentPlayer === PLAYER_TWO) runComputerTurn();
  else guessInput.focus();
}

function runComputerTurn() {
  thinking = true;
  renderGame();
  window.setTimeout(() => {
    if (finished || mode !== "solo") return;
    thinking = false;
    applySoloGuess(PLAYER_TWO, secureRandomInt(currentMin, currentMax));
  }, 700);
}

function parseGuess() {
  const guess = Number(guessInput.value);
  if (!Number.isInteger(guess)) throw new Error("请输入一个整数");
  if (guess < currentMin || guess > currentMax) throw new Error(`请输入 ${currentMin}—${currentMax} 之间的数字`);
  return guess;
}

async function apiJson(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "网络请求失败");
  return data;
}

function saveSession() {
  if (!onlineSession) sessionStorage.removeItem("number-bomb-online-session");
  else sessionStorage.setItem("number-bomb-online-session", JSON.stringify({ code: onlineSession.code, token: onlineSession.token }));
}

function enterOnlineSession(data) {
  mode = "online";
  onlineGeneration += 1;
  onlineSession = { code: data.roomCode, token: data.token, player: data.player, revision: data.revision, status: data.status, opponentConnected: data.opponentConnected };
  saveSession();
  openGame();
  applyOnlineState(data);
  watchRoom(onlineGeneration);
}

function applyOnlineState(state) {
  if (!onlineSession || state.revision < onlineSession.revision) return;
  onlineSession.player = state.player;
  onlineSession.revision = state.revision;
  onlineSession.status = state.status;
  onlineSession.opponentConnected = state.opponentConnected;
  onlineSession.rematchRequested = state.rematchRequested;
  initialMin = state.initialMin;
  initialMax = state.initialMax;
  currentMin = state.min;
  currentMax = state.max;
  currentPlayer = state.currentPlayer;
  history = state.history || [];
  finished = state.status === "finished";
  thinking = false;
  gameError.textContent = "";
  if (state.status === "playing") {
    resultDialog.hidden = true;
    onlineResultRevision = -1;
  } else if (state.status === "finished" && onlineResultRevision !== state.revision) {
    onlineResultRevision = state.revision;
    showResult(state.loser, state.bomb);
  }
  renderGame();
}

async function watchRoom(generation) {
  while (mode === "online" && onlineSession && generation === onlineGeneration) {
    const { code, token, revision } = onlineSession;
    try {
      const query = new URLSearchParams({ token, revision: String(revision) });
      const state = await apiJson(`/api/bomb-rooms/${code}/state?${query}`);
      if (generation !== onlineGeneration) return;
      applyOnlineState(state);
      if (state.revision === revision) await new Promise((resolve) => setTimeout(resolve, 120));
    } catch (_) {
      if (generation !== onlineGeneration) return;
      connectionDot.classList.remove("connected");
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
}

async function createOnlineRoom() {
  setupError.textContent = "";
  let range;
  try { range = validateRange(); } catch (error) { setupError.textContent = error.message; return; }
  const button = document.querySelector("#createBombRoom");
  button.disabled = true;
  try {
    const data = await apiJson("/api/bomb-rooms", { method: "POST", body: JSON.stringify(range) });
    enterOnlineSession(data);
  } catch (error) {
    setupError.textContent = error.message;
  } finally { button.disabled = false; }
}

async function joinOnlineRoom() {
  const code = roomInput.value.toUpperCase().replace(/[^A-Z2-9]/g, "");
  roomInput.value = code;
  if (code.length !== 6) { setupError.textContent = "请输入六位房间号"; return; }
  setupError.textContent = "";
  try {
    const data = await apiJson(`/api/bomb-rooms/${code}/join`, { method: "POST", body: "{}" });
    enterOnlineSession(data);
  } catch (error) { setupError.textContent = error.message; }
}

async function makeOnlineGuess(guess) {
  if (!onlineSession || thinking || finished || onlineSession.status !== "playing" || currentPlayer !== onlineSession.player) return;
  thinking = true;
  renderGame();
  try {
    const state = await apiJson(`/api/bomb-rooms/${onlineSession.code}/guess`, {
      method: "POST",
      body: JSON.stringify({ token: onlineSession.token, guess, revision: onlineSession.revision }),
    });
    applyOnlineState(state);
  } catch (error) {
    gameError.textContent = error.message;
  } finally {
    thinking = false;
    renderGame();
  }
}

async function requestRematch() {
  if (mode === "solo") { startSolo(); return; }
  if (!onlineSession || onlineSession.status !== "finished") {
    gameError.textContent = "本局结束后才能重新开始";
    return;
  }
  try {
    const state = await apiJson(`/api/bomb-rooms/${onlineSession.code}/rematch`, { method: "POST", body: JSON.stringify({ token: onlineSession.token }) });
    applyOnlineState(state);
    playAgainButton.querySelector("span").textContent = "等待对方确认";
    playAgainButton.disabled = true;
  } catch (error) { gameError.textContent = error.message; }
}

async function exitToSetup() {
  const session = onlineSession;
  onlineGeneration += 1;
  onlineSession = null;
  saveSession();
  if (session && session.status !== "finished") {
    apiJson(`/api/bomb-rooms/${session.code}/leave`, { method: "POST", body: JSON.stringify({ token: session.token }) }).catch(() => {});
  }
  resultDialog.hidden = true;
  gameView.hidden = true;
  setupView.hidden = false;
  history = [];
  finished = false;
}

async function restoreSession() {
  const saved = sessionStorage.getItem("number-bomb-online-session");
  if (!saved) return;
  try {
    const session = JSON.parse(saved);
    const query = new URLSearchParams({ token: session.token, revision: "-1" });
    const state = await apiJson(`/api/bomb-rooms/${session.code}/state?${query}`);
    setMode("online");
    enterOnlineSession({ ...state, token: session.token });
  } catch (_) { sessionStorage.removeItem("number-bomb-online-session"); }
}

document.querySelectorAll("[data-bomb-mode]").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.bombMode)));
document.querySelectorAll("[data-range]").forEach((button) => button.addEventListener("click", () => {
  const [min, max] = button.dataset.range.split(",");
  minInput.value = min;
  maxInput.value = max;
  document.querySelectorAll("[data-range]").forEach((item) => item.classList.toggle("active", item === button));
}));
[minInput, maxInput].forEach((input) => input.addEventListener("input", () => document.querySelectorAll("[data-range]").forEach((item) => item.classList.remove("active"))));
startSoloButton.addEventListener("click", startSolo);
document.querySelector("#createBombRoom").addEventListener("click", createOnlineRoom);
document.querySelector("#joinBombRoom").addEventListener("click", joinOnlineRoom);
roomInput.addEventListener("input", () => { roomInput.value = roomInput.value.toUpperCase().replace(/[^A-Z2-9]/g, ""); });
roomInput.addEventListener("keydown", (event) => { if (event.key === "Enter") joinOnlineRoom(); });
guessForm.addEventListener("submit", (event) => {
  event.preventDefault();
  gameError.textContent = "";
  try {
    const guess = parseGuess();
    guessInput.value = "";
    if (mode === "solo") applySoloGuess(PLAYER_ONE, guess);
    else makeOnlineGuess(guess);
  } catch (error) { gameError.textContent = error.message; }
});
document.querySelector("#exitGame").addEventListener("click", exitToSetup);
document.querySelector("#resultExit").addEventListener("click", exitToSetup);
document.querySelector("#newBombGame").addEventListener("click", requestRematch);
playAgainButton.addEventListener("click", requestRematch);
roomCodeEl.addEventListener("click", async () => navigator.clipboard.writeText(onlineSession?.code || "").catch(() => {}));
document.querySelector("#copyBombInvite").addEventListener("click", async () => {
  if (!onlineSession) return;
  const link = `${location.origin}/bomb.html?room=${onlineSession.code}`;
  await navigator.clipboard.writeText(link).catch(() => {});
  document.querySelector("#copyBombInvite").textContent = "已复制";
  window.setTimeout(() => { document.querySelector("#copyBombInvite").textContent = "复制邀请链接"; }, 1200);
});

const invitedRoom = new URLSearchParams(location.search).get("room");
if (invitedRoom) {
  setMode("online");
  roomInput.value = invitedRoom.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 6);
} else restoreSession();
