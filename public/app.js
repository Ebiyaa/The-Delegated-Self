// scan interaction

const WS_URL = 'ws://localhost:8080';
const COUNTDOWN_SECONDS = 30;

let socket = null;
let personas = null;

/** What the current visitor scanned in with — drives near_miss vs consequence. */
let currentTag = null;
/** Which persona card they picked. */
let currentPersona = null;
/** What the video currently on screen represents. */
let videoContext = null;   // 'tag' | 'scenario' | 'outcome'

let countdownTimer = null;
let countdownRemaining = COUNTDOWN_SECONDS;

const el = {
  stage: document.getElementById('stage'),
  video: document.getElementById('stageVideo'),
  walletId: document.getElementById('walletId'),
  pulseDot: document.getElementById('pulseDot'),
  statusText: document.getElementById('readerStatusText'),
  resetBtn: document.getElementById('resetBtn'),

  panelIdle: document.getElementById('panelIdle'),
  panelBiometric: document.getElementById('panelBiometric'),
  panelPersona: document.getElementById('panelPersona'),
  panelCountdown: document.getElementById('panelCountdown'),

  sensorRing: document.getElementById('sensorRing'),
  sensorPalm: document.getElementById('sensorPalm'),
  personaGrid: document.getElementById('personaGrid'),
  countdownPrompt: document.getElementById('countdownPrompt'),
  countdownTimer: document.getElementById('countdownTimer'),

  agentOnRecord: document.getElementById('agentOnRecord'),
  delegation: document.getElementById('delegation'),
  agentStatus: document.getElementById('agentStatus'),
  employmentVerified: document.getElementById('employmentVerified'),
  communityMembership: document.getElementById('communityMembership'),
  governanceHistory: document.getElementById('governanceHistory'),
  creditAccess: document.getElementById('creditAccess'),
  idVerified: document.getElementById('idVerified'),
  idStatus: document.getElementById('idStatus'),
};

// ---- Small helpers ----------------------------------------------------

function send(payload) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function showPanel(name) {
  [el.panelIdle, el.panelBiometric, el.panelPersona, el.panelCountdown]
    .forEach((p) => p.classList.remove('active'));
  const map = {
    idle: el.panelIdle,
    biometric: el.panelBiometric,
    persona: el.panelPersona,
    countdown: el.panelCountdown,
  };
  if (map[name]) map[name].classList.add('active');
}

function setField(node, value) {
  const negative = /^(no|none|revoked|denied|suspended|flagged)$/i.test(value || '');
  node.textContent = value ?? '-';
  node.classList.remove('dash', 'good', 'bad');
  if (!value) node.classList.add('dash');
  else if (negative) node.classList.add('bad');
  else node.classList.add('good');
}

function setPulse(state) {
  el.pulseDot.classList.remove('matched', 'unknown');
  if (state === 'matched') {
    el.pulseDot.classList.add('matched');
    el.statusText.textContent = 'SOUL DOCUMENT RECOGNIZED';
  } else if (state === 'unknown') {
    el.pulseDot.classList.add('unknown');
    el.statusText.textContent = 'UNRECOGNIZED TAG — NOT IN REGISTRY';
  } else {
    el.statusText.textContent = 'READER READY — HOLD A SOUL DOCUMENT TO SCAN';
  }
}

// ---- Video handling ---------------------------------------------------

function playVideo(src, context) {
  videoContext = context;
  el.video.src = src;
  el.video.loop = false;
  el.video.classList.add('active');
  el.video.currentTime = 0;
  el.stage.classList.add('cinema');
  document.body.style.overflow = 'hidden';
  el.video.play().catch(() => {
    // Autoplay may be blocked until the page has had one user gesture.
    // A single click anywhere on the kiosk page satisfies this permanently.
  });
}

function stopVideo() {
  el.video.pause();
  el.video.classList.remove('active');
  el.stage.classList.remove('cinema');
  document.body.style.overflow = '';
}

function onVideoFinished() {
  const finished = videoContext;
  stopVideo();
  videoContext = null;

  if (finished === 'tag') {
    // Tag video done — wake the pads and ask for ring + palm.
    showPanel('biometric');
    resetSensorIndicators();
    send({ type: 'begin-biometric' });
    return;
  }

  if (finished === 'scenario') {
    send({ type: 'end-biometric' });
    startCountdown();
    return;
  }

  if (finished === 'outcome') {
    resetToIdle();
  }
}

el.video.addEventListener('ended', onVideoFinished);

el.video.addEventListener('error', () => {
  console.error('Video failed to load:', el.video.src);
  onVideoFinished();   // don't strand the installation on a black screen
});

// Esc bails out of a playing video and resets the whole interaction.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (el.stage.classList.contains('cinema')) stopVideo();
    resetToIdle();
  }
});

// ---- Stage: biometric --------------------------------------------------

function resetSensorIndicators() {
  [el.sensorRing, el.sensorPalm].forEach((node) => {
    node.classList.remove('ok');
    node.querySelector('.sensor-state').textContent = 'Waiting';
  });
}

function updateSensors(ring, palm) {
  const apply = (node, ok) => {
    node.classList.toggle('ok', ok);
    node.querySelector('.sensor-state').textContent = ok ? 'Confirmed' : 'Waiting';
  };
  apply(el.sensorRing, ring);
  apply(el.sensorPalm, palm);
}

// ---- Stage: persona ----------------------------------------------------

function buildPersonaCards() {
  if (!personas) return;
  el.personaGrid.innerHTML = '';

  ['cautious', 'balanced', 'autonomous'].forEach((key) => {
    const p = personas[key];
    if (!p) return;

    const card = document.createElement('button');
    card.className = 'persona-card';
    card.type = 'button';
    card.innerHTML =
      `<div class="persona-label">${p.label}</div>` +
      `<div class="persona-blurb">${p.blurb || ''}</div>`;
    card.addEventListener('click', () => choosePersona(key));
    el.personaGrid.appendChild(card);
  });
}

function choosePersona(key) {
  currentPersona = key;
  const p = personas[key];
  if (!p) return;
  playVideo(p.video, 'scenario');
}

// ---- Stage: countdown --------------------------------------------------

function startCountdown() {
  const action = (personas && currentPersona && personas[currentPersona]?.action) || 'take action';
  el.countdownPrompt.textContent =
    `Your custodian is about to ${action} in ${COUNTDOWN_SECONDS} seconds.`;

  countdownRemaining = COUNTDOWN_SECONDS;
  el.countdownTimer.textContent = countdownRemaining;
  showPanel('countdown');

  clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    countdownRemaining -= 1;
    el.countdownTimer.textContent = Math.max(countdownRemaining, 0);

    if (countdownRemaining <= 0) {
      clearInterval(countdownTimer);
      countdownTimer = null;
      // Nobody intervened — the custodian's action goes through.
      playOutcome('consequence');
    }
  }, 1000);
}

function onButtonPressed() {
  // Only meaningful while the countdown is actually running.
  if (!countdownTimer) return;
  clearInterval(countdownTimer);
  countdownTimer = null;

  // Tags 1 and 2 (sovereign, delegated) earn a near miss.
  // Tag 3 (restricted) gets the consequence even with an intervention.
  const outcome = currentTag?.interventionOutcome || 'consequence';
  playOutcome(outcome);
}

function playOutcome(kind) {
  const src = personas?._outcomes?.[kind];
  if (!src) {
    console.error('No video configured for outcome:', kind);
    resetToIdle();
    return;
  }
  playVideo(src, 'outcome');
}

// ---- Reset -------------------------------------------------------------

function resetToIdle() {
  clearInterval(countdownTimer);
  countdownTimer = null;
  currentTag = null;
  currentPersona = null;
  videoContext = null;

  stopVideo();
  showPanel('idle');
  setPulse('ready');
  resetSensorIndicators();

  el.walletId.textContent = 'None detected';
  ['agentOnRecord', 'delegation', 'agentStatus', 'employmentVerified',
   'communityMembership', 'governanceHistory', 'creditAccess',
   'idVerified', 'idStatus'].forEach((k) => setField(el[k], null));

  send({ type: 'reset' });
}

el.resetBtn.addEventListener('click', resetToIdle);

// ---- Scan --------------------------------------------------------------

function onScan(data) {
  currentTag = data;
  setPulse('matched');

  el.walletId.textContent = data.walletId || data.uid;

  setField(el.agentOnRecord, data.agentOnRecord);
  setField(el.delegation, data.delegation);
  setField(el.agentStatus, data.agentStatus);
  setField(el.employmentVerified, data.employmentVerified);
  setField(el.communityMembership, data.communityMembership);
  setField(el.governanceHistory, data.governanceHistory);
  setField(el.creditAccess, data.creditAccess);
  setField(el.idVerified, data.idVerified);
  setField(el.idStatus, data.idStatus);


  showPanel('biometric');
  resetSensorIndicators();
  send({ type: 'begin-biometric' });
}

//  WebSocket 

function connect() {
  const ws = new WebSocket(WS_URL);
  socket = ws;

  ws.onopen = () => {
    console.log('Connected to Continuum bridge.');
    setPulse('ready');
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);

    switch (data.type) {
      case 'status':
        if (data.personas) {
          personas = data.personas;
          buildPersonaCards();
        }
        setPulse('ready');
        break;

      case 'scan':
        onScan(data);
        break;

      case 'unknown':
        setPulse('unknown');
        break;

      case 'sensors':
        updateSensors(data.ring, data.palm);
        break;

      case 'biometric-ok':
        updateSensors(true, true);
        // Brief pause on all-green before the cards appear.
        setTimeout(() => showPanel('persona'), 900);
        break;

      case 'button':
        onButtonPressed();
        break;
    }
  };

  ws.onclose = () => {
    console.warn('Lost connection to server.js — retrying in 2s...');
    el.statusText.textContent = 'SERVER OFFLINE — CHECK server.js';
    setTimeout(connect, 2000);
  };

  ws.onerror = () => ws.close();
}

connect();
