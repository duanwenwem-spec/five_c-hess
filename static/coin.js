const BLACK = 1;
const WHITE = 2;
const ROUND_MS = 45_000;
const canvas = document.querySelector("#coinCanvas");
const ctx = canvas.getContext("2d");
const setupView = document.querySelector("#coinSetup");
const gameView = document.querySelector("#coinGame");
const setupError = document.querySelector("#coinSetupError");
const roomInput = document.querySelector("#coinRoomInput");
const roomInfo = document.querySelector("#coinRoomInfo");
const roomCodeEl = document.querySelector("#coinRoomCode");
const connectionDot = document.querySelector("#coinConnectionDot");
const arenaWrap = document.querySelector("#arenaWrap");
const waitingOverlay = document.querySelector("#coinWaiting");
const countdownEl = document.querySelector("#coinCountdown");
const scoreEl = document.querySelector("#coinScore");
const timerEl = document.querySelector("#coinTimer");
const opponentLabel = document.querySelector("#coinOpponentLabel");
const opponentScoreEl = document.querySelector("#coinOpponentScore");
const meRaceScore = document.querySelector("#meRaceScore");
const otherRaceScore = document.querySelector("#otherRaceScore");
const otherRacerName = document.querySelector("#otherRacerName");
const otherRaceState = document.querySelector("#otherRaceState");
const comboEl = document.querySelector("#comboCount");
const eventsEl = document.querySelector("#coinEvents");
const resultDialog = document.querySelector("#coinResult");
const resultTitle = document.querySelector("#coinResultTitle");
const resultText = document.querySelector("#coinResultText");
const resultScores = document.querySelector("#coinResultScores");
const playAgainButton = document.querySelector("#coinPlayAgain");

let mode = "solo";
let score = 0;
let opponentScore = 0;
let combo = 0;
let basketX = 450;
let seed = 1;
let startedAt = null;
let deadline = null;
let items = [];
let handled = new Set();
let events = [];
let animationFrame;
let roundKey = null;
let localFinished = false;
let keys = { left: false, right: false };
let lastFrame = 0;
let lastSentScore = null;
let scoreSyncTimer;
let onlineSession = null;
let onlineGeneration = 0;
let resultRevision = -1;
let audioContext;

function mulberry32(value) {
  let state = value >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let result = state;
    result = Math.imul(result ^ result >>> 15, result | 1);
    result ^= result + Math.imul(result ^ result >>> 7, result | 61);
    return ((result ^ result >>> 14) >>> 0) / 4294967296;
  };
}

function buildSchedule(roundSeed) {
  const random = mulberry32(roundSeed);
  const schedule = [];
  for (let index = 0; index < 82; index += 1) {
    const chance = random();
    schedule.push({
      id: index,
      at: 500 + index * 545 + random() * 170,
      x: 55 + random() * 790,
      type: chance < .16 ? "bomb" : chance < .31 ? "star" : "coin",
      duration: 3_200 + random() * 1_250,
      drift: (random() - .5) * 65,
    });
  }
  return schedule;
}

function setMode(nextMode) {
  mode = nextMode;
  document.querySelectorAll("[data-coin-mode]").forEach((button) => {
    const active = button.dataset.coinMode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  document.querySelector("#startCoinSolo").hidden = mode !== "solo";
  document.querySelector("#coinOnlineActions").hidden = mode !== "online";
  setupError.textContent = "";
}

function openGame() {
  setupView.hidden = true;
  gameView.hidden = false;
  resultDialog.hidden = true;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function startRound(roundSeed, roundStart, roundDeadline, initialScore = 0) {
  cancelAnimationFrame(animationFrame);
  window.clearTimeout(scoreSyncTimer);
  seed = roundSeed;
  startedAt = roundStart;
  deadline = roundDeadline;
  roundKey = `${seed}:${startedAt}`;
  items = buildSchedule(seed);
  handled = new Set();
  score = initialScore;
  combo = 0;
  basketX = 450;
  events = ["准备好你的篮子"];
  localFinished = false;
  lastSentScore = null;
  lastFrame = performance.now();
  renderHud();
  animationFrame = requestAnimationFrame(gameLoop);
}

function startSolo() {
  mode = "solo";
  onlineGeneration += 1;
  onlineSession = null;
  const roundSeed = crypto.getRandomValues(new Uint32Array(1))[0] || 1;
  const start = Date.now() + 1_200;
  openGame();
  roomInfo.hidden = true;
  waitingOverlay.hidden = true;
  opponentLabel.textContent = "最高纪录";
  otherRacerName.textContent = "本机纪录";
  otherRaceState.textContent = "努力刷新吧";
  opponentScore = Number(localStorage.getItem("coin-high-score") || 0);
  startRound(roundSeed, start, start + ROUND_MS);
}

function renderHud() {
  const record = mode === "solo" ? Number(localStorage.getItem("coin-high-score") || 0) : opponentScore;
  scoreEl.textContent = score;
  meRaceScore.textContent = score;
  opponentScoreEl.textContent = record;
  otherRaceScore.textContent = record;
  comboEl.textContent = `× ${combo}`;
  eventsEl.innerHTML = events.slice(-6).reverse().map((text) => `<li>${text}</li>`).join("");
  roomInfo.hidden = mode !== "online" || !onlineSession;
  if (onlineSession) {
    roomCodeEl.textContent = onlineSession.code;
    connectionDot.classList.toggle("connected", onlineSession.status !== "waiting" && onlineSession.opponentConnected);
  }
}

function drawCoin(item, x, y) {
  ctx.save(); ctx.translate(x, y);
  const radius = item.type === "star" ? 22 : 20;
  const gradient = ctx.createRadialGradient(-7,-8,2,0,0,radius);
  gradient.addColorStop(0,"#fff2a9"); gradient.addColorStop(1,item.type === "star" ? "#e9ad28" : "#cf9729");
  ctx.fillStyle = gradient; ctx.strokeStyle = "#aa7418"; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(0,0,radius,0,Math.PI*2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#94620e"; ctx.font = `bold ${item.type === "star" ? 19 : 18}px Georgia`; ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText(item.type === "star" ? "★" : "¥",0,1);ctx.restore();
}

function drawBomb(x, y) {
  ctx.save();ctx.translate(x,y);const gradient=ctx.createRadialGradient(-8,-9,2,0,0,23);gradient.addColorStop(0,"#51605a");gradient.addColorStop(1,"#111b17");ctx.fillStyle=gradient;ctx.beginPath();ctx.arc(0,0,23,0,Math.PI*2);ctx.fill();ctx.strokeStyle="#d4a33c";ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(-8,-20);ctx.quadraticCurveTo(-15,-38,-1,-42);ctx.stroke();ctx.fillStyle="#ffd66b";ctx.beginPath();ctx.arc(0,-43,4,0,Math.PI*2);ctx.fill();ctx.restore();
}

function drawBasket() {
  const x = basketX - 63, y = 500;
  const gradient = ctx.createLinearGradient(x,0,x+126,0);gradient.addColorStop(0,"#7d4429");gradient.addColorStop(.5,"#bd7443");gradient.addColorStop(1,"#7d4429");ctx.fillStyle=gradient;ctx.beginPath();ctx.roundRect(x,y,126,38,[5,5,28,28]);ctx.fill();ctx.strokeStyle="rgba(255,255,255,.25)";ctx.lineWidth=3;for(let stripe=18;stripe<120;stripe+=24){ctx.beginPath();ctx.moveTo(x+stripe,y+4);ctx.lineTo(x+stripe-7,y+32);ctx.stroke()}ctx.strokeStyle="#6d3b25";ctx.lineWidth=9;ctx.beginPath();ctx.moveTo(x+18,y+3);ctx.lineTo(x+34,y-34);ctx.moveTo(x+108,y+3);ctx.lineTo(x+92,y-34);ctx.stroke();
}

function addEvent(text) { events.push(text); renderHud(); }

function playEffect(type) {
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)(); audioContext.resume();
    const oscillator=audioContext.createOscillator(),gain=audioContext.createGain();oscillator.type=type==="bomb"?"sawtooth":"sine";oscillator.frequency.setValueAtTime(type==="bomb"?120:type==="star"?760:560,audioContext.currentTime);oscillator.frequency.exponentialRampToValueAtTime(type==="bomb"?45:type==="star"?980:700,audioContext.currentTime+.16);gain.gain.setValueAtTime(type==="bomb"?.08:.035,audioContext.currentTime);gain.gain.exponentialRampToValueAtTime(.001,audioContext.currentTime+.22);oscillator.connect(gain).connect(audioContext.destination);oscillator.start();oscillator.stop(audioContext.currentTime+.23);
  } catch (_) { /* Optional sound. */ }
}

function collect(item) {
  handled.add(item.id);
  if (item.type === "bomb") {
    score -= 15; combo = 0; addEvent("碰到炸弹，−15 分"); playEffect("bomb");
    arenaWrap.classList.remove("shake"); void arenaWrap.offsetWidth; arenaWrap.classList.add("shake");
  } else {
    const points = item.type === "star" ? 20 : 10;
    score += points; combo += 1; addEvent(`${item.type === "star" ? "接住星星金币" : "接住金币"}，+${points} 分`); playEffect(item.type);
  }
  renderHud();
  if (mode === "online") scheduleScoreSync();
}

function scheduleScoreSync() {
  if (!onlineSession || score === lastSentScore) return;
  window.clearTimeout(scoreSyncTimer);
  scoreSyncTimer = window.setTimeout(async () => {
    if (!onlineSession || score === lastSentScore) return;
    const sent = score;
    try {
      const state = await apiJson(`/api/coin-rooms/${onlineSession.code}/score`, { method:"POST", body:JSON.stringify({token:onlineSession.token,score:sent}) });
      lastSentScore = sent; applyOnlineState(state);
    } catch (_) { /* The room watcher will reconnect. */ }
  }, 350);
}

function gameLoop(now) {
  const delta = Math.min(40, now - lastFrame); lastFrame = now;
  if (keys.left) basketX -= delta * .5;
  if (keys.right) basketX += delta * .5;
  basketX = Math.max(68, Math.min(832, basketX));
  const currentTime = Date.now();
  const beforeStart = startedAt - currentTime;
  waitingOverlay.hidden = true;
  countdownEl.hidden = beforeStart <= 0;
  if (beforeStart > 0) countdownEl.textContent = Math.max(1, Math.ceil(beforeStart / 1000));
  const elapsed = currentTime - startedAt;
  const remaining = Math.max(0, deadline - currentTime);
  timerEl.textContent = (remaining / 1000).toFixed(1);
  ctx.clearRect(0,0,canvas.width,canvas.height);
  if (elapsed >= 0) {
    for (const item of items) {
      if (handled.has(item.id) || elapsed < item.at) continue;
      const progress = (elapsed - item.at) / item.duration;
      const x = item.x + Math.sin(progress * Math.PI * 2) * item.drift;
      const y = -35 + progress * 610;
      if (progress > 1.05) { handled.add(item.id); if (item.type !== "bomb" && combo) { combo = 0; renderHud(); } continue; }
      if (y > 475 && y < 535 && Math.abs(x - basketX) < 79) { collect(item); continue; }
      if (item.type === "bomb") drawBomb(x,y); else drawCoin(item,x,y);
    }
  }
  drawBasket();
  if (remaining <= 0 && !localFinished) { finishLocalRound(); return; }
  if (!localFinished) animationFrame = requestAnimationFrame(gameLoop);
}

async function finishLocalRound() {
  localFinished = true;
  cancelAnimationFrame(animationFrame);
  if (mode === "solo") {
    const record = Math.max(score, Number(localStorage.getItem("coin-high-score") || 0));
    localStorage.setItem("coin-high-score", String(record));
    showSoloResult(record);
    return;
  }
  waitingOverlay.hidden = false;
  waitingOverlay.querySelector("strong").textContent = "已完成，等待好友结算";
  waitingOverlay.querySelector("small").textContent = "双方结束后会公布排名";
  try { applyOnlineState(await apiJson(`/api/coin-rooms/${onlineSession.code}/finish`, { method:"POST", body:JSON.stringify({token:onlineSession.token,score}) })); }
  catch (_) { /* The watcher will obtain the final state. */ }
}

function showSoloResult(record) {
  resultTitle.textContent = score >= record && score > 0 ? "刷新最高纪录" : "挑战完成";
  resultText.textContent = `本局接到 ${score} 分，最高纪录 ${record} 分`;
  resultScores.hidden = true;
  playAgainButton.querySelector("span").textContent = "再来一局";
  playAgainButton.disabled = false;
  resultDialog.hidden = false;
}

async function apiJson(url, options={}) {
  const response=await fetch(url,{...options,headers:{"Content-Type":"application/json",...(options.headers||{})}});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||"网络请求失败");return data;
}

function saveSession(){if(!onlineSession)sessionStorage.removeItem("coin-online-session");else sessionStorage.setItem("coin-online-session",JSON.stringify({code:onlineSession.code,token:onlineSession.token}))}

function enterOnlineSession(data){mode="online";onlineGeneration+=1;onlineSession={code:data.roomCode,token:data.token};saveSession();openGame();opponentLabel.textContent="好友分数";otherRacerName.textContent="好友";otherRaceState.textContent="实时同步";applyOnlineState(data);watchRoom(onlineGeneration)}

function applyOnlineState(state) {
  if(!onlineSession||(onlineSession.revision??-1)>state.revision)return;
  const isNewRound=state.startedAt&&`${state.seed}:${state.startedAt}`!==roundKey;
  Object.assign(onlineSession,{player:state.player,status:state.status,revision:state.revision,opponentConnected:state.opponentConnected,rematchRequested:state.rematchRequested,winner:state.winner});
  opponentScore=state.opponentScore;
  if(state.status==="waiting"){
    waitingOverlay.hidden=false;countdownEl.hidden=true;waitingOverlay.querySelector("strong").textContent="等待好友加入";waitingOverlay.querySelector("small").textContent="加入后双方会同时开始";cancelAnimationFrame(animationFrame);
  }else if(state.status==="playing"){
    resultDialog.hidden=true;resultRevision=-1;waitingOverlay.hidden=!localFinished;
    if(localFinished){waitingOverlay.querySelector("strong").textContent="已完成，等待好友结算";waitingOverlay.querySelector("small").textContent="双方结束后会公布排名"}
    if(isNewRound){startRound(state.seed,state.startedAt,state.deadline,state.score);waitingOverlay.hidden=true}
  }else if(state.status==="finished"){
    cancelAnimationFrame(animationFrame);score=state.score;
    if(resultRevision!==state.revision){resultRevision=state.revision;showOnlineResult(state)}
  }
  renderHud();
}

function showOnlineResult(state){const won=state.winner===state.player,draw=state.winner===0;resultTitle.textContent=draw?"平分秋色":won?"你赢得竞速":"好友赢得竞速";resultText.textContent=`你的分数 ${state.score}，好友分数 ${state.opponentScore}`;resultScores.hidden=false;const boxes=resultScores.querySelectorAll("b");boxes[0].textContent=state.score;boxes[1].textContent=state.opponentScore;playAgainButton.querySelector("span").textContent=state.rematchRequested?"等待好友确认":"邀请再来一局";playAgainButton.disabled=Boolean(state.rematchRequested);resultDialog.hidden=false;playEffect(won?"star":"coin")}

async function watchRoom(generation){while(mode==="online"&&onlineSession&&generation===onlineGeneration){const{code,token,revision}=onlineSession;try{const query=new URLSearchParams({token,revision:String(revision??-1)});const state=await apiJson(`/api/coin-rooms/${code}/state?${query}`);if(generation!==onlineGeneration)return;applyOnlineState(state);if(state.revision===revision)await new Promise(resolve=>setTimeout(resolve,100))}catch(_){if(generation!==onlineGeneration)return;connectionDot.classList.remove("connected");await new Promise(resolve=>setTimeout(resolve,1400))}}}

async function createRoom(){setupError.textContent="";const button=document.querySelector("#createCoinRoom");button.disabled=true;try{enterOnlineSession(await apiJson("/api/coin-rooms",{method:"POST",body:"{}"}))}catch(error){setupError.textContent=error.message}finally{button.disabled=false}}
async function joinRoom(){const code=roomInput.value.toUpperCase().replace(/[^A-Z2-9]/g,"");roomInput.value=code;if(code.length!==6){setupError.textContent="请输入六位房间号";return}try{enterOnlineSession(await apiJson(`/api/coin-rooms/${code}/join`,{method:"POST",body:"{}"}))}catch(error){setupError.textContent=error.message}}

async function rematch(){if(mode==="solo"){startSolo();return}if(!onlineSession||onlineSession.status!=="finished")return;try{applyOnlineState(await apiJson(`/api/coin-rooms/${onlineSession.code}/rematch`,{method:"POST",body:JSON.stringify({token:onlineSession.token})}));playAgainButton.querySelector("span").textContent="等待好友确认";playAgainButton.disabled=true}catch(error){setupError.textContent=error.message}}

async function exitGame(){const session=onlineSession;cancelAnimationFrame(animationFrame);window.clearTimeout(scoreSyncTimer);onlineGeneration+=1;onlineSession=null;saveSession();if(session&&session.status!=="finished")apiJson(`/api/coin-rooms/${session.code}/leave`,{method:"POST",body:JSON.stringify({token:session.token})}).catch(()=>{});resultDialog.hidden=true;gameView.hidden=true;setupView.hidden=false}

async function restoreSession(){const saved=sessionStorage.getItem("coin-online-session");if(!saved)return;try{const session=JSON.parse(saved);const query=new URLSearchParams({token:session.token,revision:"-1"});const state=await apiJson(`/api/coin-rooms/${session.code}/state?${query}`);setMode("online");enterOnlineSession({...state,token:session.token})}catch(_){sessionStorage.removeItem("coin-online-session")}}

canvas.addEventListener("pointermove",event=>{const bounds=canvas.getBoundingClientRect();basketX=Math.max(68,Math.min(832,(event.clientX-bounds.left)/bounds.width*900))});
window.addEventListener("keydown",event=>{if(event.key==="ArrowLeft")keys.left=true;if(event.key==="ArrowRight")keys.right=true});
window.addEventListener("keyup",event=>{if(event.key==="ArrowLeft")keys.left=false;if(event.key==="ArrowRight")keys.right=false});
function bindMoveButton(selector,direction){const button=document.querySelector(selector);button.addEventListener("pointerdown",()=>{keys[direction]=true});["pointerup","pointercancel","pointerleave"].forEach(name=>button.addEventListener(name,()=>{keys[direction]=false}))}
bindMoveButton("#moveLeft","left");bindMoveButton("#moveRight","right");
document.querySelectorAll("[data-coin-mode]").forEach(button=>button.addEventListener("click",()=>setMode(button.dataset.coinMode)));
document.querySelector("#startCoinSolo").addEventListener("click",startSolo);document.querySelector("#createCoinRoom").addEventListener("click",createRoom);document.querySelector("#joinCoinRoom").addEventListener("click",joinRoom);
roomInput.addEventListener("input",()=>{roomInput.value=roomInput.value.toUpperCase().replace(/[^A-Z2-9]/g,"")});roomInput.addEventListener("keydown",event=>{if(event.key==="Enter")joinRoom()});
document.querySelector("#exitCoinGame").addEventListener("click",exitGame);document.querySelector("#coinResultExit").addEventListener("click",exitGame);playAgainButton.addEventListener("click",rematch);
roomCodeEl.addEventListener("click",()=>navigator.clipboard.writeText(onlineSession?.code||"").catch(()=>{}));document.querySelector("#copyCoinInvite").addEventListener("click",async event=>{if(!onlineSession)return;await navigator.clipboard.writeText(`${location.origin}/coin.html?room=${onlineSession.code}`).catch(()=>{});event.currentTarget.textContent="已复制";window.setTimeout(()=>{event.currentTarget.textContent="复制邀请链接"},1200)});
const invitedRoom=new URLSearchParams(location.search).get("room");if(invitedRoom){setMode("online");roomInput.value=invitedRoom.toUpperCase().replace(/[^A-Z2-9]/g,"").slice(0,6)}else restoreSession();
