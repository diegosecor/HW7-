import { validateDuration, createDemoBeats, findBeats } from "./audio-chart.js";

const DESIGN_WIDTH = 1280;
const DESIGN_HEIGHT = 720;
const TRACKING_INTERVAL = 34;
const FLIGHT_TIME = 2.35;
const LEFT_RAIL = 438;
const RIGHT_RAIL = 842;
const CONTROL_TOP = 202;
const CONTROL_BOTTOM = 582;

const difficultySettings = {
  easy: { tolerance: 0.22, label: "EASY", color: "#60d5a8" },
  normal: { tolerance: 0.14, label: "NORMAL", color: "#ffd666" },
  hard: { tolerance: 0.085, label: "HARD", color: "#ff6868" },
};

const setupScreen = document.querySelector("#setup-screen");
const gameScreen = document.querySelector("#game-screen");
const resultsScreen = document.querySelector("#results-screen");
const songInput = document.querySelector("#song-input");
const songName = document.querySelector("#song-name");
const demoButton = document.querySelector("#demo-button");
const startButton = document.querySelector("#start-button");
const setupStatus = document.querySelector("#setup-status");
const playAgainButton = document.querySelector("#play-again-button");
const songAudio = document.querySelector("#song-audio");
const cameraVideo = document.querySelector("#camera-video");
const canvas = document.querySelector("#game-canvas");
let context = canvas.getContext("2d");
const menuCanvas = document.querySelector("#stage-preview") || canvas;
const previewButton = document.querySelector("#preview-button");
const stageMessage = document.querySelector("#stage-message");
let audioBuffer = null;
let audioStartedAt = 0;
let startupToken = 0;
let busy = false;
let loadingStage = "";
let menuFrame = null;
const scoreValue = document.querySelector("#score-value");
const comboValue = document.querySelector("#combo-value");
const multiplierValue = document.querySelector("#multiplier-value");
const judgementValue = document.querySelector("#judgement-value");
const trackingStatus = document.querySelector("#tracking-status");
const finalScore = document.querySelector("#final-score");
const finalHits = document.querySelector("#final-hits");
const finalMisses = document.querySelector("#final-misses");
const finalAccuracy = document.querySelector("#final-accuracy");
const finalCombo = document.querySelector("#final-combo");
const resultsPhrase = document.querySelector("#results-phrase");

let selectedFile = null;
let usingIncludedDemo = false;
let objectUrl = null;
let mediaStream = null;
let audioContext = null;
let musicSource = null;
let musicFilter = null;
let musicGain = null;
let handLandmarker = null;
let faceLandmarker = null;
let visionLoadPromise = null;
let animationFrame = null;

const game = {
  active: false,
  chart: [],
  difficulty: "normal",
  score: 0,
  hits: 0,
  misses: 0,
  combo: 0,
  bestCombo: 0,
  missStreak: 0,
  booedThisStreak: false,
  leftLevel: 0.5,
  rightLevel: 0.5,
  trackingValid: false,
  lastVisionAt: 0,
  lastVisionRun: 0,
  lastFrameAt: 0,
  judgement: { text: "GET READY!", kind: "" },
  particles: [],
  tomatoes: [],
  cameraError: "",
};

songInput.addEventListener("change", onSongSelected);
demoButton.addEventListener("click", useIncludedDemo);
startButton.addEventListener("click", () => startConcert(false));
playAgainButton.addEventListener("click", returnToSetup);
previewButton?.addEventListener("click", () => startConcert(true));
document.querySelector("#back-button")?.addEventListener("click", returnToSetup);
document.querySelector("#check-tracking")?.addEventListener("click", async event => {
  const button = event.currentTarget;
  button.disabled = true;
  setSetupStatus("Checking motion tracking...");
  try { await ensureVisionModels(); setSetupStatus("Motion tracking is ready. You can start with your camera."); }
  catch (error) { setSetupStatus(error.message, true); }
  finally { button.disabled = false; }
});
window.addEventListener("pagehide", releaseCamera);
document.addEventListener("visibilitychange", () => {
  if (document.hidden && game.active && !game.preview) {
    returnToSetup();
    setSetupStatus("Concert stopped when you left the tab. Your camera is off; start again when ready.");
  }
});
useIncludedDemo();
startMenuAnimation();

function onSongSelected() {
  const [file] = songInput.files;
  if (!file || busy) return;
  if (file.size > 100 * 1024 * 1024) { setSetupStatus("Please choose an audio file smaller than 100 MB.", true); return; }
  audioBuffer = null;
  selectedFile = file || null;
  usingIncludedDemo = false;
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = selectedFile ? URL.createObjectURL(selectedFile) : null;
  songAudio.src = objectUrl || "";

  if (!selectedFile) {
    songName.textContent = "No song selected";
    startButton.disabled = true;
    setSetupStatus("Choose an MP3 or WAV to continue.");
    return;
  }

  songName.textContent = selectedFile.name;
  const songDetail = document.querySelector("#song-detail");
  if (songDetail) songDetail.textContent = "Your local audio · stays on this device";
  startButton.disabled = false;
  setSetupStatus("Ready. Camera permission will be requested after you start.");
}

function useIncludedDemo() {
  if (busy) return;
  audioBuffer = null;
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = null;
  selectedFile = null;
  usingIncludedDemo = true;
  songInput.value = "";
  songAudio.src = "demo-track.wav";
  songName.textContent = "Panic Parade";
  const songDetail = document.querySelector("#song-detail");
  if (songDetail) songDetail.textContent = "Original demo · 124 BPM · 0:32";
  startButton.disabled = false;
  setSetupStatus("Ready when you are. The demo is already selected.");
}

function selectedDifficulty() {
  return document.querySelector("input[name='difficulty']:checked").value;
}

function setSetupStatus(message, isError = false) {
  setupStatus.textContent = message;
  setupStatus.classList.toggle("error", isError);
}

function setBusy(value) {
  busy = value;
  for (const input of setupScreen.querySelectorAll("button, input")) input.disabled = value;
  startButton.textContent = value ? "Preparing concert…" : "Start with camera";
}

async function startConcert(preview = false) {
  if (busy) return;
  const token = ++startupToken;
  setBusy(true);
  try {
    loadingStage = "Reading audio";
    setSetupStatus("Preparing your song...");
    await ensureAudioGraph();
    if (!audioBuffer) {
      const bytes = selectedFile ? await selectedFile.arrayBuffer() : await fetchLocalAudio();
      audioBuffer = await audioContext.decodeAudioData(bytes);
    }
    validateDuration(audioBuffer.duration);
    const difficulty = selectedDifficulty();
    const beats = usingIncludedDemo ? createDemoBeats(audioBuffer.duration) : findBeats(audioBuffer, audioBuffer.duration);
    const chart = createNotes(beats, audioBuffer.duration, difficulty);
    if (!chart.length) throw new Error("This clip is too short for a concert. Try a longer song.");
    if (!preview) {
      loadingStage = "Preparing motion tracking";
      setSetupStatus("Preparing motion tracking...");
      await ensureVisionModels();
      loadingStage = "Opening camera";
      setSetupStatus("Allow camera access, then stand back with both hands visible.");
      await ensureCamera(token);
    }
    if (token !== startupToken) return;
    resetGame(chart);
    game.difficulty = difficulty;
    game.preview = preview;
    game.phase = preview ? "playing" : "calibrating";
    game.readySince = null;
    game.duration = audioBuffer.duration;
    game.head = null;
    game.lastVideoTime = -1;
    game.trackingErrors = 0;
    songAudio.pause();
    setupScreen.hidden = true;
    resultsScreen.hidden = true;
    gameScreen.hidden = false;
    const modeBadge = document.querySelector("#mode-badge");
    if (modeBadge) modeBadge.textContent = preview ? "AUTOPLAY PREVIEW · NOT YOUR SCORE" : "LIVE CONCERT";
    cameraVideo.classList.toggle("visible", !preview);
    cancelAnimationFrame(menuFrame);
    context = canvas.getContext("2d");
    game.active = true;
    game.lastFrameAt = performance.now();
    if (preview) beginAudio();
    animationFrame = requestAnimationFrame(gameLoop);
  } catch (error) {
    console.error(loadingStage, error);
    stopAudio();
    releaseCamera();
    game.active = false;
    gameScreen.hidden = true;
    setupScreen.hidden = false;
    setSetupStatus(loadingStage + ": " + (error.message || "Please try again."), true);
    startMenuAnimation();
  } finally {
    if (token === startupToken) setBusy(false);
  }
}

async function fetchLocalAudio() {
  const response = await fetch("./demo-track.wav");
  if (!response.ok) throw new Error("The included demo is missing. Choose a local MP3 or WAV.");
  return response.arrayBuffer();
}

async function ensureCamera(token) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Open the game on localhost in Chrome or Edge to use your camera.");
  if (mediaStream?.active) return;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } } });
  } catch (error) {
    const messages = {
      NotAllowedError: "Camera access was not granted. Allow it in your browser, or use Watch preview.",
      NotFoundError: "No camera found. Connect one, or use Watch preview.",
      NotReadableError: "Your camera is busy. Close other camera apps and try again."
    };
    throw new Error(messages[error.name] || "Camera could not start. Try Chrome or Edge, or Watch preview.");
  }
  if (token !== startupToken) { stream.getTracks().forEach(track => track.stop()); throw new Error("Start cancelled."); }
  mediaStream = stream;
  cameraVideo.srcObject = stream;
  await cameraVideo.play();
  if (!cameraVideo.videoWidth) {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error("Camera did not send a picture. Please try again.")); }, 10000);
      const ready = () => { cleanup(); resolve(); };
      const cleanup = () => { clearTimeout(timer); cameraVideo.removeEventListener("loadeddata", ready); };
      cameraVideo.addEventListener("loadeddata", ready, { once: true });
    });
  }
}

function releaseCamera() {
  mediaStream?.getTracks().forEach(track => track.stop());
  mediaStream = null;
  cameraVideo.srcObject = null;
}

function beginAudio() {
  musicGain.gain.cancelScheduledValues(audioContext.currentTime);
  musicGain.gain.value = 0.8;
  musicFilter.frequency.cancelScheduledValues(audioContext.currentTime);
  musicFilter.frequency.value = audioContext.sampleRate / 2;
  musicFilter.Q.value = 0.0001;
  musicSource = audioContext.createBufferSource();
  musicSource.buffer = audioBuffer;
  musicSource.connect(musicFilter);
  audioStartedAt = audioContext.currentTime;
  musicSource.onended = () => { if (game.active && game.phase === "playing") finishConcert(); };
  musicSource.start();
  game.phase = "playing";
}

function stopAudio() {
  if (musicSource) {
    musicSource.onended = null;
    try { musicSource.stop(); } catch {}
    musicSource.disconnect();
    musicSource = null;
  }
}
function songTime() { return game.phase === "playing" ? Math.min(game.duration, Math.max(0, audioContext.currentTime - audioStartedAt)) : 0; }

async function ensureVisionModels() {
  if (handLandmarker && faceLandmarker) return;
  if (!visionLoadPromise) visionLoadPromise = loadVisionModels();
  return visionLoadPromise;
}

async function loadVisionModels() {
  try {
    const { FilesetResolver, HandLandmarker, FaceLandmarker } = await import(
      "./node_modules/@mediapipe/tasks-vision/vision_bundle.mjs"
    );
    const vision = await FilesetResolver.forVisionTasks(
      new URL("./node_modules/@mediapipe/tasks-vision/wasm", import.meta.url).href
    );
    const commonOptions = { delegate: "CPU" };
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        ...commonOptions,
        modelAssetPath: new URL("./assets/models/hand_landmarker.task", import.meta.url).href,
      },
      runningMode: "VIDEO",
      numHands: 2,
    });
    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        ...commonOptions,
        modelAssetPath: new URL("./assets/models/face_landmarker.task", import.meta.url).href,
      },
      runningMode: "VIDEO",
      numFaces: 1,
    });
  } catch (error) {
    handLandmarker?.close(); faceLandmarker?.close();
    handLandmarker = null; faceLandmarker = null;
    visionLoadPromise = null;
    console.error("Motion tracking initialization failed", error);
    throw new Error("Motion tracking could not start. Try Chrome or Edge; Watch preview works without a camera.");
  }
}

async function ensureAudioGraph() {
  if (!audioContext) {
    audioContext = new AudioContext();
    musicFilter = audioContext.createBiquadFilter();
    musicFilter.type = "lowpass";
    musicFilter.frequency.value = 22050;
    musicGain = audioContext.createGain();
    musicGain.gain.value = 1;
    musicFilter.connect(musicGain).connect(audioContext.destination);
  }
  await audioContext.resume();
}

function createNotes(beats, duration, difficulty) {
  validateDuration(duration);
  const notes = [];
  const random = mulberry32(Math.floor(duration * 1000) ^ beats.length);
  const settings = difficultySettings[difficulty];
  const lastLevel = { left: 0.48, right: 0.52 };
  const addNote = (time, hand, forceWideMove = false) => {
    if (time < FLIGHT_TIME + 0.15 || time > duration - 0.15) return;
    const level = nextLevel(hand, lastLevel[hand], difficulty, forceWideMove, random);
    lastLevel[hand] = level;
    notes.push({ time, hand, level, judged: false, result: null, tolerance: settings.tolerance });
  };

  if (difficulty === "easy") {
    beats.forEach((beat, index) => {
      if (index % 2 === 0) addNote(beat, index % 4 === 0 ? "left" : "right");
    });
  } else if (difficulty === "normal") {
    beats.forEach((beat, index) => {
      const hand = index % 2 === 0 ? "left" : "right";
      addNote(beat, hand);
      if (index > 0 && index % 7 === 0) addNote(beat, hand === "left" ? "right" : "left");
    });
  } else {
    beats.forEach((beat, index) => {
      const hand = index % 2 === 0 ? "left" : "right";
      addNote(beat, hand, true);
      const nextBeat = beats[index + 1];
      if (nextBeat && nextBeat - beat > 0.46) addNote(beat + (nextBeat - beat) / 2, hand === "left" ? "right" : "left", true);
      if (index > 0 && index % 4 === 0) addNote(beat, hand === "left" ? "right" : "left", true);
    });
  }

  return notes.sort((a, b) => a.time - b.time);
}

function nextLevel(hand, previous, difficulty, forceWideMove, random) {
  const range = difficulty === "easy" ? [0.28, 0.72] : [0.14, 0.9];
  let value = range[0] + random() * (range[1] - range[0]);
  const minimumMove = forceWideMove ? 0.34 : difficulty === "normal" ? 0.16 : 0.08;
  if (Math.abs(value - previous) < minimumMove) {
    value = previous < 0.5 ? Math.min(range[1], previous + minimumMove + random() * 0.2) : Math.max(range[0], previous - minimumMove - random() * 0.2);
  }
  return clamp(value, range[0], range[1]);
}

function resetGame(chart) {
  Object.assign(game, {
    active: false,
    chart,
    score: 0,
    hits: 0,
    misses: 0,
    combo: 0,
    bestCombo: 0,
    missStreak: 0,
    booedThisStreak: false,
    leftLevel: 0.5,
    rightLevel: 0.5,
    trackingValid: false,
    lastVisionAt: 0,
    lastVisionRun: 0,
    particles: [],
    tomatoes: [],
    judgement: { text: "GET READY!", kind: "" },
    cameraError: "",
  });
  updateHud();
}

function gameLoop(now) {
  if (!game.active) return;
  try {
    const elapsed = Math.min(0.08, (now - game.lastFrameAt) / 1000 || 0);
    game.lastFrameAt = now;
    if (game.preview) updatePreviewHands(songTime(), now);
    else updateTracking(now);
    if (game.phase === "calibrating") {
      if (!game.trackingValid) game.readySince = null;
      else game.readySince ??= now;
      const remaining = game.readySince === null ? 3 : Math.max(0, 3 - Math.floor((now - game.readySince) / 1000));
      if (stageMessage) {
        stageMessage.hidden = false;
        stageMessage.textContent = game.trackingValid ? "Ready in " + remaining + " · keep both hands in view" : "Step back · show your face and both hands";
      }
      if (game.readySince !== null && now - game.readySince >= 3000) beginAudio();
    } else {
      if (stageMessage) stageMessage.hidden = true;
      evaluateNotes(songTime());
    }
    updateEffects(elapsed);
    render(songTime());
    const songProgress = document.querySelector("#song-progress");
    const songTimeLabel = document.querySelector("#song-time");
    if (songProgress) songProgress.value = songTime() / game.duration;
    if (songTimeLabel) songTimeLabel.textContent = formatTime(songTime()) + " / " + formatTime(game.duration);
    animationFrame = requestAnimationFrame(gameLoop);
  } catch (error) {
    console.error("Concert stopped", error);
    returnToSetup();
    setSetupStatus("The concert stopped: " + error.message + ". You can try again.", true);
  }
}

function updatePreviewHands(time, now) {
  for (const hand of ["left", "right"]) {
    const next = game.chart.find(note => note.hand === hand && !note.judged);
    if (next) game[hand + "Level"] = smooth(game[hand + "Level"], next.level, 0.22);
  }
  game.trackingValid = true;
  game.lastVisionAt = now;
}

function updateTracking(now) {
  if (!handLandmarker || !faceLandmarker || cameraVideo.readyState < 2 || !cameraVideo.videoWidth) { game.trackingValid = false; return; }
  if (cameraVideo.currentTime === game.lastVideoTime) return;
  game.lastVideoTime = cameraVideo.currentTime;
  if (now - game.lastVisionRun < TRACKING_INTERVAL) return;
  game.lastVisionRun = now;

  try {
    const hands = handLandmarker.detectForVideo(cameraVideo, now);
    const faces = faceLandmarker.detectForVideo(cameraVideo, now);
    const head = faces.faceLandmarks?.[0]?.[1];
    let leftHand = null;
    let rightHand = null;

    hands.landmarks?.forEach((landmarks, index) => {
      const label = hands.handedness?.[index]?.[0]?.categoryName;
      const palm = landmarks[9];
      if (label === "Left") rightHand = palm;
      if (label === "Right") leftHand = palm;
    });

    game.head = head;
    game.trackingErrors = 0;
    game.cameraError = "";
    game.trackingValid = Boolean(head && leftHand && rightHand);
    if (game.trackingValid) {
      game.leftLevel = smooth(game.leftLevel, cameraToLevel(leftHand.y, head.y), 0.42);
      game.rightLevel = smooth(game.rightLevel, cameraToLevel(rightHand.y, head.y), 0.42);
      game.lastVisionAt = now;
    }
  } catch (error) {
    game.trackingValid = false;
    game.cameraError = "TRACKING HICCUP";
    game.trackingErrors += 1;
    if (game.trackingErrors > 10) throw new Error("Tracking stopped. Restart the concert or try another browser.");
  }
}

function cameraToLevel(handY, headY) {
  return clamp(((headY - handY) + 0.34) / 0.78, 0, 1);
}

function evaluateNotes(songTime) {
  for (const note of game.chart) {
    if (note.judged || songTime < note.time) continue;
    note.judged = true;
    const currentLevel = note.hand === "left" ? game.leftLevel : game.rightLevel;
    const trackingFresh = game.trackingValid && performance.now() - game.lastVisionAt < 240;
    const distance = Math.abs(currentLevel - note.level);
    if (trackingFresh && distance <= note.tolerance) recordHit(note, distance);
    else recordMiss(note, trackingFresh ? "MISS!" : "NO TRACK!");
  }
}

function recordHit(note, distance) {
  note.result = "hit";
  game.hits += 1;
  game.combo += 1;
  game.bestCombo = Math.max(game.bestCombo, game.combo);
  game.missStreak = 0;
  game.booedThisStreak = false;
  const ratio = distance / note.tolerance;
  const rating = ratio < 0.3 ? "PERFECT!" : ratio < 0.67 ? "GREAT!" : "GOOD!";
  const basePoints = rating === "PERFECT!" ? 100 : rating === "GREAT!" ? 75 : 50;
  const multiplier = scoreMultiplier();
  game.score += basePoints * multiplier;
  game.judgement = { text: rating, kind: rating === "PERFECT!" ? "perfect" : "good" };
  spawnParticles(note, rating === "PERFECT!" ? 14 : 8, note.hand === "left" ? "#72d8ef" : "#ff8a91");
  updateHud();
}

function recordMiss(note, label) {
  note.result = "miss";
  game.misses += 1;
  game.combo = 0;
  game.missStreak += 1;
  game.judgement = { text: label, kind: "miss" };
  spawnParticles(note, 9, "#ff6868");
  triggerDissonance();

  if (game.missStreak >= 5 && !game.booedThisStreak) {
    game.booedThisStreak = true;
    playBoo();
  }
  if (game.misses >= 4 && game.misses > game.hits && game.misses % 2 === 0) throwTomato();
  updateHud();
}

function scoreMultiplier() {
  if (game.combo >= 30) return 4;
  if (game.combo >= 20) return 3;
  if (game.combo >= 10) return 2;
  return 1;
}

function updateHud() {
  scoreValue.textContent = String(game.score).padStart(6, "0");
  comboValue.textContent = String(game.combo);
  multiplierValue.textContent = `x${scoreMultiplier()}`;
  judgementValue.textContent = game.judgement.text;
  judgementValue.className = `judgement ${game.judgement.kind}`;
  const isFresh = game.trackingValid && performance.now() - game.lastVisionAt < 240;
  trackingStatus.textContent = game.preview ? "AUTOMATIC HANDS · CAMERA OFF" : isFresh ? "HEAD + BOTH HANDS DETECTED" : game.cameraError || "SHOW YOUR HEAD + BOTH HANDS";
  trackingStatus.className = `tracking-status ${isFresh ? "ready" : "warning"}`;
}

function render(songTime) {
  context.clearRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
  drawTheatre(songTime);
  drawControlRails();
  drawNotes(songTime);
  drawConductor();
  drawEffects();
  updateHud();
}

function drawTheatre(songTime) {
  const gradient = context.createLinearGradient(0, 0, 0, DESIGN_HEIGHT);
  gradient.addColorStop(0, "#201844");
  gradient.addColorStop(0.54, "#5a2d52");
  gradient.addColorStop(0.55, "#653d2e");
  gradient.addColorStop(1, "#181324");
  context.fillStyle = gradient;
  context.fillRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);

  context.save();
  context.globalAlpha = 0.1;
  if (cameraVideo.readyState >= 2) {
    context.translate(DESIGN_WIDTH, 0);
    context.scale(-1, 1);
    context.drawImage(cameraVideo, 230, 112, 820, 470);
  }
  context.restore();

  context.fillStyle = "#321948";
  context.beginPath();
  context.moveTo(0, 0);
  context.lineTo(182, 0);
  context.lineTo(143, 520);
  context.lineTo(0, 590);
  context.closePath();
  context.fill();
  context.beginPath();
  context.moveTo(DESIGN_WIDTH, 0);
  context.lineTo(DESIGN_WIDTH - 182, 0);
  context.lineTo(DESIGN_WIDTH - 143, 520);
  context.lineTo(DESIGN_WIDTH, 590);
  context.closePath();
  context.fill();
  drawCurtain(0, 0, 150, 576, false);
  drawCurtain(DESIGN_WIDTH - 150, 0, 150, 576, true);

  for (let index = 0; index < 7; index += 1) {
    const x = 170 + index * 160;
    context.fillStyle = index % 2 ? "#552244" : "#612746";
    context.beginPath();
    context.moveTo(x, 98);
    context.lineTo(x + 90, 575);
    context.lineTo(x + 145, 575);
    context.lineTo(x + 85, 98);
    context.closePath();
    context.fill();
  }

  context.save();
  context.globalAlpha = 0.18;
  context.fillStyle = "#ffe3a1";
  for (let index = 0; index < 4; index += 1) {
    const x = 235 + index * 280 + Math.sin(songTime * 1.8 + index) * 28;
    context.beginPath();
    context.moveTo(x, 62);
    context.lineTo(x + 110, 530);
    context.lineTo(x - 110, 530);
    context.closePath();
    context.fill();
  }
  context.restore();

  drawOrchestra();
  context.fillStyle = "#171020";
  context.fillRect(0, 584, DESIGN_WIDTH, 136);
  context.fillStyle = "#3f2733";
  context.fillRect(0, 579, DESIGN_WIDTH, 8);
  context.fillStyle = "#ffd666";
  context.globalAlpha = 0.52;
  context.fillRect(0, 588, DESIGN_WIDTH, 2);
  context.globalAlpha = 1;
  drawAudience();
}

function drawCurtain(x, y, width, height, flip) {
  context.save();
  if (flip) {
    context.translate(DESIGN_WIDTH, 0);
    context.scale(-1, 1);
    x = 0;
  }
  for (let index = 0; index < 7; index += 1) {
    context.fillStyle = index % 2 ? "#7d1f33" : "#b03748";
    context.beginPath();
    context.moveTo(x + index * 25, y);
    context.lineTo(x + index * 25 + 31, y);
    context.lineTo(x + index * 22 + 15, y + height);
    context.lineTo(x + index * 7, y + height);
    context.closePath();
    context.fill();
  }
  context.restore();
}

function drawOrchestra() {
  for (let index = 0; index < 10; index += 1) {
    const row = index < 5 ? 0 : 1;
    const col = index % 5;
    const x = 292 + col * 175 + (row ? 62 : 0);
    const y = row ? 472 : 405;
    const coat = ["#537cb2", "#bb5e72", "#658d69", "#8f5d9c", "#b68a47"][index % 5];
    context.fillStyle = "#171626";
    context.fillRect(x - 27, y + 26, 60, 10);
    context.fillStyle = coat;
    context.beginPath();
    context.moveTo(x - 24, y + 29);
    context.lineTo(x + 26, y + 29);
    context.lineTo(x + 38, y + 84);
    context.lineTo(x - 34, y + 84);
    context.closePath();
    context.fill();
    context.fillStyle = "#e6ad8c";
    context.beginPath();
    context.arc(x, y + 12, 21, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#3e2633";
    context.beginPath();
    context.arc(x, y + 5, 23, Math.PI, Math.PI * 2);
    context.fill();
    context.strokeStyle = "#f5cf80";
    context.lineWidth = 4;
    context.beginPath();
    context.moveTo(x + 20, y + 56);
    context.lineTo(x + 57, y + 41);
    context.stroke();
    context.strokeStyle = "#c87b46";
    context.lineWidth = 8;
    context.beginPath();
    context.arc(x + 62, y + 40, 18, -1.1, 1.1);
    context.stroke();
  }
}

function drawAudience() {
  for (let index = 0; index < 29; index += 1) {
    const x = index * 48 + 8;
    const y = 622 + (index % 3) * 18;
    context.fillStyle = ["#242136", "#33314c", "#482c40"][index % 3];
    context.beginPath();
    context.arc(x, y, 18 + (index % 4) * 3, Math.PI, 0);
    context.lineTo(x + 25, 710);
    context.lineTo(x - 25, 710);
    context.closePath();
    context.fill();
  }
}

function drawControlRails() {
  const setting = difficultySettings[game.difficulty];
  const freshTracking = game.trackingValid && performance.now() - game.lastVisionAt < 240;
  context.save();
  context.globalAlpha = 0.3;
  context.setLineDash([10, 13]);
  context.lineWidth = 4;
  context.strokeStyle = "#72d8ef";
  context.beginPath();
  context.moveTo(LEFT_RAIL, CONTROL_TOP - 8);
  context.lineTo(LEFT_RAIL, CONTROL_BOTTOM + 8);
  context.stroke();
  context.strokeStyle = "#ff8a91";
  context.beginPath();
  context.moveTo(RIGHT_RAIL, CONTROL_TOP - 8);
  context.lineTo(RIGHT_RAIL, CONTROL_BOTTOM + 8);
  context.stroke();
  context.restore();
  context.setLineDash([]);

  const markerHeight = (CONTROL_BOTTOM - CONTROL_TOP) * setting.tolerance;
  [LEFT_RAIL, RIGHT_RAIL].forEach((x, index) => {
    context.strokeStyle = index === 0 ? "#72d8ef" : "#ff8a91";
    context.lineWidth = 3;
    context.globalAlpha = freshTracking ? 0.4 : 0.15;
    context.strokeRect(x - 17, CONTROL_TOP + 15, 34, CONTROL_BOTTOM - CONTROL_TOP - 30);
    context.globalAlpha = 1;
    context.fillStyle = "#fff9ed";
    context.font = "900 12px Trebuchet MS";
    context.textAlign = "center";
    context.fillText(index === 0 ? "L" : "R", x, 188);
    context.globalAlpha = 0.08;
    context.fillStyle = index === 0 ? "#72d8ef" : "#ff8a91";
    context.fillRect(x - 20, CONTROL_TOP, 40, markerHeight);
    context.globalAlpha = 1;
  });
}

function drawNotes(songTime) {
  for (const note of game.chart) {
    const travelStart = note.time - FLIGHT_TIME;
    const progress = (songTime - travelStart) / FLIGHT_TIME;
    if (progress < 0 || progress > 1.16) continue;
    const y = levelToY(note.level);
    const isLeft = note.hand === "left";
    const targetX = isLeft ? LEFT_RAIL : RIGHT_RAIL;
    const startX = isLeft ? -90 : DESIGN_WIDTH + 90;
    const x = clamp(startX + (targetX - startX) * progress, Math.min(startX, targetX), Math.max(startX, targetX));
    const color = isLeft ? "#72d8ef" : "#ff8a91";

    if (!note.judged && progress > 0) {
      const radius = note.tolerance * (CONTROL_BOTTOM - CONTROL_TOP);
      context.globalAlpha = 0.24 + (1 - progress) * 0.2;
      context.strokeStyle = color;
      context.lineWidth = 3;
      context.beginPath();
      context.rect(targetX - 25, y - radius, 50, radius * 2);
      context.stroke();
      context.globalAlpha = 1;
    }

    context.save();
    if (note.result === "miss") context.globalAlpha = Math.max(0, 1 - (songTime - note.time) * 2.2);
    if (note.result === "hit") context.globalAlpha = Math.max(0, 1 - (songTime - note.time) * 3);
    context.fillStyle = color;
    context.beginPath();
    context.arc(x, y, 17, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = "#fff9ed";
    context.lineWidth = 4;
    context.beginPath();
    context.arc(x, y, 9, 0, Math.PI * 2);
    context.stroke();
    context.fillStyle = "#26172d";
    context.font = "900 12px Trebuchet MS";
    context.textAlign = "center";
    context.fillText(isLeft ? "L" : "R", x, y + 4);
    context.restore();
  }
}

function drawConductor() {
  const headX = DESIGN_WIDTH / 2;
  const headY = 515;
  const leftX = LEFT_RAIL;
  const rightX = RIGHT_RAIL;
  const leftY = levelToY(game.leftLevel);
  const rightY = levelToY(game.rightLevel);
  const freshTracking = game.trackingValid && performance.now() - game.lastVisionAt < 240;

  context.save();
  context.globalAlpha = freshTracking ? 0.94 : 0.36;
  context.fillStyle = "#151221";
  context.beginPath();
  context.moveTo(headX - 80, 590);
  context.lineTo(headX + 80, 590);
  context.lineTo(headX + 56, 462);
  context.lineTo(headX - 56, 462);
  context.closePath();
  context.fill();
  context.fillStyle = "#0b0a12";
  context.beginPath();
  context.arc(headX, headY - 100, 47, 0, Math.PI * 2);
  context.fill();

  drawArm(headX - 38, 474, leftX, leftY, "#72d8ef");
  drawArm(headX + 38, 474, rightX, rightY, "#ff8a91");
  drawHand(leftX, leftY, "#72d8ef", "L");
  drawHand(rightX, rightY, "#ff8a91", "R");
  context.restore();
}

function drawArm(shoulderX, shoulderY, handX, handY, color) {
  const bendX = (shoulderX + handX) / 2;
  const bendY = Math.min(shoulderY - 18, handY + 38);
  context.strokeStyle = "#090812";
  context.lineWidth = 24;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(shoulderX, shoulderY);
  context.quadraticCurveTo(bendX, bendY, handX, handY);
  context.stroke();
  context.strokeStyle = color;
  context.globalAlpha *= 0.45;
  context.lineWidth = 5;
  context.stroke();
  context.globalAlpha /= 0.45;
}

function drawHand(x, y, color, letter) {
  context.fillStyle = color;
  context.beginPath();
  context.arc(x, y, 22, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = "#fff9ed";
  context.lineWidth = 3;
  context.stroke();
  context.fillStyle = "#18111e";
  context.font = "900 16px Trebuchet MS";
  context.textAlign = "center";
  context.fillText(letter, x, y + 6);
}

function spawnParticles(note, count, color) {
  const x = note.hand === "left" ? LEFT_RAIL : RIGHT_RAIL;
  const y = levelToY(note.level);
  for (let index = 0; index < count; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 70 + Math.random() * 170;
    game.particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 0.5 + Math.random() * 0.35, age: 0, color });
  }
}

function throwTomato() {
  game.tomatoes.push({ x: Math.random() > 0.5 ? -30 : DESIGN_WIDTH + 30, y: 350 + Math.random() * 200, vx: 350 + Math.random() * 120, age: 0, life: 1.15 });
}

function updateEffects(delta) {
  game.particles = game.particles.filter((particle) => {
    particle.age += delta;
    particle.x += particle.vx * delta;
    particle.y += particle.vy * delta;
    particle.vy += 190 * delta;
    return particle.age < particle.life;
  });
  game.tomatoes = game.tomatoes.filter((tomato) => {
    tomato.age += delta;
    tomato.x += tomato.vx * delta * (tomato.x < DESIGN_WIDTH / 2 ? 1 : -1);
    tomato.y += Math.sin(tomato.age * Math.PI) * -80 * delta;
    return tomato.age < tomato.life;
  });
}

function drawEffects() {
  for (const particle of game.particles) {
    context.globalAlpha = 1 - particle.age / particle.life;
    context.fillStyle = particle.color;
    context.fillRect(particle.x - 3, particle.y - 3, 6, 6);
  }
  context.globalAlpha = 1;
  for (const tomato of game.tomatoes) {
    context.fillStyle = "#d84d43";
    context.beginPath();
    context.arc(tomato.x, tomato.y, 16, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#76a650";
    context.beginPath();
    context.moveTo(tomato.x, tomato.y - 19);
    context.lineTo(tomato.x - 8, tomato.y - 7);
    context.lineTo(tomato.x + 8, tomato.y - 7);
    context.closePath();
    context.fill();
  }
}

function triggerDissonance() {
  if (!audioContext || !musicGain || !musicFilter) return;
  const now = audioContext.currentTime;
  musicGain.gain.cancelScheduledValues(now);
  musicFilter.frequency.cancelScheduledValues(now);
  musicGain.gain.setValueAtTime(0.28, now);
  musicFilter.frequency.setValueAtTime(750, now);
  musicFilter.Q.setValueAtTime(11, now);
  musicFilter.frequency.linearRampToValueAtTime(260, now + 0.11);
  musicFilter.frequency.linearRampToValueAtTime(22050, now + 0.42);
  musicFilter.Q.linearRampToValueAtTime(0.0001, now + 0.42);
  musicGain.gain.linearRampToValueAtTime(1, now + 0.42);
}

function playBoo() {
  if (!audioContext) return;
  const now = audioContext.currentTime;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = "sawtooth";
  oscillator.frequency.setValueAtTime(145, now);
  oscillator.frequency.linearRampToValueAtTime(96, now + 0.85);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.13, now + 0.07);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.95);
  oscillator.connect(gain).connect(audioContext.destination);
  oscillator.start(now);
  oscillator.stop(now + 1);
}

function playApplause() {
  if (!audioContext) return;
  const now = audioContext.currentTime;
  for (let index = 0; index < 18; index += 1) {
    const start = now + index * 0.085 + Math.random() * 0.05;
    const duration = 0.025 + Math.random() * 0.035;
    const buffer = audioContext.createBuffer(1, Math.floor(audioContext.sampleRate * duration), audioContext.sampleRate);
    const data = buffer.getChannelData(0);
    for (let sample = 0; sample < data.length; sample += 1) data[sample] = (Math.random() * 2 - 1) * (1 - sample / data.length);
    const source = audioContext.createBufferSource();
    const gain = audioContext.createGain();
    gain.gain.value = 0.11;
    source.buffer = buffer;
    source.connect(gain).connect(audioContext.destination);
    source.start(start);
  }
}

function finishConcert() {
  if (!game.active) return;
  evaluateNotes(game.duration);
  game.active = false;
  game.phase = "results";
  stopAudio();
  releaseCamera();
  cancelAnimationFrame(animationFrame);
  playApplause();
  const total = game.hits + game.misses;
  const accuracy = total ? Math.round((game.hits / total) * 100) : 0;
  finalScore.textContent = String(game.score).padStart(6, "0");
  finalHits.textContent = game.hits;
  finalMisses.textContent = game.misses;
  finalAccuracy.textContent = `${accuracy}%`;
  finalCombo.textContent = game.bestCombo;
  resultsPhrase.textContent = game.preview ? "Preview complete. Now it is your turn to take the podium." : resultLine(accuracy);
  document.querySelector("#results-title").textContent = game.preview ? "Preview complete" : "Your curtain call";
  gameScreen.hidden = true;
  resultsScreen.hidden = false;
}

function resultLine(accuracy) {
  if (accuracy < 30) return "The tomatoes want an encore. The orchestra has changed its locks.";
  if (accuracy < 50) return "Somewhere, a triangle player is quietly crying.";
  if (accuracy < 70) return "The audience survived. Barely. Take a tiny bow.";
  if (accuracy < 90) return "A surprisingly respectable disaster. The crowd is confused but clapping.";
  return "Maestro! The ugly theatre has never sounded so glorious.";
}

function returnToSetup() {
  startupToken++;
  stopAudio();
  releaseCamera();
  game.active = false;
  game.preview = false;
  game.phase = "setup";
  cancelAnimationFrame(animationFrame);
  resultsScreen.hidden = true;
  gameScreen.hidden = true;
  setupScreen.hidden = false;
  setBusy(false);
  setSetupStatus("Ready for an encore. Your song is still selected.");
  startMenuAnimation();
}

function formatTime(time) { return Math.floor(time / 60) + ":" + String(Math.floor(time % 60)).padStart(2, "0"); }

function startMenuAnimation() {
  cancelAnimationFrame(menuFrame);
  const previewChart = createNotes(createDemoBeats(32), 32, "normal");
  const tick = now => {
    if (setupScreen.hidden) return;
    const time = 4 + (now / 1000 % 22);
    const previous = { chart: game.chart, leftLevel: game.leftLevel, rightLevel: game.rightLevel, trackingValid: game.trackingValid, lastVisionAt: game.lastVisionAt };
    game.chart = previewChart;
    game.leftLevel = 0.5 + Math.sin(now / 700) * 0.23;
    game.rightLevel = 0.5 + Math.cos(now / 900) * 0.27;
    game.trackingValid = true;
    game.lastVisionAt = now;
    context = menuCanvas.getContext("2d");
    context.clearRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
    drawTheatre(time);
    drawControlRails();
    drawNotes(time);
    drawConductor();
    Object.assign(game, previous);
    context = canvas.getContext("2d");
    menuFrame = requestAnimationFrame(tick);
  };
  menuFrame = requestAnimationFrame(tick);
}

function levelToY(level) {
  return CONTROL_BOTTOM - level * (CONTROL_BOTTOM - CONTROL_TOP);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function smooth(current, next, amount) {
  return current + (next - current) * amount;
}

function mulberry32(seed) {
  return () => {
    let value = seed += 0x6D2B79F5;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
