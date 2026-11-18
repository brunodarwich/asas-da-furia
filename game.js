const canvas = document.querySelector('#flight');
const game = document.querySelector('.game');
const hud = document.querySelector('.hud');
const integrity = document.querySelector('#integrity');
const waveLabel = document.querySelector('#wave');
const scoreLabel = document.querySelector('#score');
const cameraLabel = document.querySelector('#camera');
const overlay = document.querySelector('.overlay');
const tutorial = document.querySelector('#tutorial');
const showTutorial = document.querySelector('#show-tutorial');
const title = document.querySelector('#title');
const eyebrow = document.querySelector('#eyebrow');
const description = document.querySelector('#description');
const action = document.querySelector('#action');
const restart = document.querySelector('#restart');
const ejection = document.querySelector('#ejection');
const ejectButton = document.querySelector('#eject');
const flightGuide = document.querySelector('#flight-guide');
const pilotGuide = document.querySelector('#pilot-guide');
const groundGuide = document.querySelector('#ground-guide');
const pistolGuide = document.querySelector('#pistol-guide');
const pilotHealth = document.querySelector('#pilot-health');
const pilotAmmo = document.querySelector('#pilot-ammo');
const pilotPrompt = document.querySelector('#pilot-prompt');
const aircraftReadout = integrity.closest('.readout');
const waveReadout = waveLabel.closest('.readout');
const touchCamera = document.querySelector('#touch-camera');
const touchFire = document.querySelector('[data-flight-key="Fire"]');
const touchReload = document.querySelector('[data-flight-key="KeyR"]');
const touchFlightButtons = [document.querySelector('#touch-roll'), document.querySelector('[data-flight-key="ShiftLeft"]')];
const sound = document.querySelector('#sound');
const altitudeKeys = document.querySelector('#altitude-keys');
const touchControls = document.querySelector('.touch-controls');
const touchAltitude = document.querySelector('.touch-altitude');
const touchActions = document.querySelector('.touch-actions');
const stick = document.querySelector('#stick');
const touchDevice = matchMedia('(pointer:coarse), (hover:none)');
const audio = createFlightAudio();
const world = createWorld();
const render = createRenderer(canvas, world);
const cameraNames = ['VISTA SUPERIOR', 'PERSEGUIÇÃO', 'COCKPIT'];
const keys = new Set();
const touchKeys = new Map();
const WAVE_SIZES = [2, 3, 4];
const WAVE_DRONE_MODELS = [
  ['droneA', 'droneB'],
  ['droneC', 'droneA', 'droneB'],
  ['droneA', 'droneB', 'droneC', 'droneC']
];
const FRAME = 1 / 60;
const PARTICLE_LIMIT = 270;
const pilotLabels = {falling: 'EM QUEDA', parachute: 'PARAQUEDAS', swimming: 'NADANDO', walking: 'EM TERRA'};
let state;
let status = 'intro';
let firing = false;
let pointerInside = false;
let muted = false;
let stickPointer = null;
let lookTouch = null;
let lookDrag = null;
let pilotLocked = false;
let pilotShot = false;
let pilotPointerFallback = false;
let pilotFallbackUsed = false;
let pointerPauseAt = -Infinity;
let stickX = 0, stickY = 0;
const approach = (value, target, rate, dt) => lerp(value, target, 1 - Math.exp(-rate * dt));
const held = code => keys.has(code) || touchKeys.has(code);

function makePlayer() {
  return {x: 2070, y: 1350, z: 236, yaw: -.43, pitch: 0, roll: 0, hp: 100,
    course: -.43, turnRate: 0, verticalSpeed: 0, wakeIn: 0, groundContact: false,
    speed: 153, boost: false, rollTime: 0, rollSide: 1, cooldown: 0, model: 'falcao'};
}

function makeState() {
  return {player: makePlayer(), time: 0, camera: 0, score: 0, wave: 0, running: false,
    enemies: [], particles: [], shots: [], trail: [], trailTime: 0, banner: 0,
    waveDelay: 0, hit: 0, muzzle: 0, pointer: {x: MID_X, y: MID_Y},
    pilotMode: null, pilot: null, wreck: null, shore: null, ground: null};
}

function refreshHud() {
  integrity.value = Math.ceil(state.player.hp);
  waveLabel.textContent = `${state.wave + 1} / ${WAVE_SIZES.length}`;
  scoreLabel.textContent = String(state.score).padStart(4, '0');
  const pilot = state.pilot;
  const walking = state.pilotMode === 'walking';
  cameraLabel.textContent = pilot ? PILOT_CAMERAS[pilot.camera]
    : pilotLabels[state.pilotMode] ?? cameraNames[state.camera];
  aircraftReadout.hidden = waveReadout.hidden = Boolean(state.pilotMode);
  game.classList.toggle('ground', Boolean(pilot));
  flightGuide.hidden = Boolean(state.pilotMode);
  pilotGuide.hidden = !state.pilotMode || state.pilotMode === 'falling';
  groundGuide.hidden = !pilot;
  pistolGuide.hidden = !walking;
  altitudeKeys.hidden = state.camera !== 0;
  touchAltitude.hidden = Boolean(state.pilotMode) || state.camera !== 0;
  touchActions.hidden = Boolean(state.pilotMode) && !pilot;
  touchFire.hidden = Boolean(pilot) && !walking;
  touchReload.hidden = !walking;
  for (const button of touchFlightButtons) button.hidden = Boolean(state.pilotMode);
  ejection.hidden = state.pilotMode !== 'falling';
  refreshPilotHud();
}

function refreshPilotHud() {
  const {pilot} = state;
  pilotHealth.parentElement.hidden = !pilot;
  pilotAmmo.parentElement.hidden = state.pilotMode !== 'walking';
  pilotPrompt.hidden = !pilot || pilot.camera !== 1 || touchDevice.matches || pilotLocked || pilotFallbackUsed || !state.running;
  if (!pilot) return;
  pilotHealth.textContent = pilot.health;
  pilotAmmo.textContent = pilot.reload > 0 ? 'Recarregando…' : pilot.magazine + ' / ' + pilot.reserve;
  pilotPrompt.textContent = pilotPointerFallback ? 'Arraste com o botão direito para mirar' : 'Clique na arena para mirar';
}

function releasePilotPointer() {
  pilotLocked = false;
  if (document.pointerLockElement === canvas) document.exitPointerLock();
}

function releaseInput() {
  keys.clear();
  touchKeys.clear();
  for (const button of touchControls.querySelectorAll('.is-held')) button.classList.remove('is-held');
  stickPointer = null;
  lookTouch = null;
  lookDrag = null;
  pilotShot = false;
  if (state.pilot) state.pilot.dx = state.pilot.dy = 0;
  steerTouch(0, 0);
  firing = false;
  pointerInside = false;
}

function setStatus(next) {
  status = next;
  state.running = next === 'playing';
  game.classList.toggle('intro', next === 'intro');
  game.classList.toggle('playing', state.running);
  hud.hidden = !state.running;
  overlay.hidden = state.running;
  if (!state.running) ejection.hidden = true;
  restart.hidden = next !== 'paused' || !state.pilotMode;
  showTutorial.hidden = next !== 'intro';
  refreshTouchControls();
  audio.setPlaying(state.running);
  if (state.running) {
    action.blur();
    refreshHud();
    return;
  }
  releaseInput();
  releasePilotPointer();
  const screens = {
    paused: ['MISSÃO EM CURSO', 'PAUSA', 'Pressione Esc para continuar.', 'Retomar missão'],
    lost: ['CAÇA FORA DE COMBATE', 'MISSÃO<br><em>ENCERRADA</em>', 'O avião atingiu a superfície antes da ejeção.', 'Tentar novamente'],
    pilotLost: ['PATRULHA INIMIGA', 'RESGATE<br><em>INTERROMPIDO</em>', 'O piloto foi abatido antes de chegar ao helicóptero.', 'Tentar novamente'],
    rescued: ['EXTRAÇÃO CONCLUÍDA', 'PILOTO<br><em>RESGATADO</em>', 'O helicóptero aliado recolheu o piloto.', 'Nova missão'],
    won: ['ARQUIPÉLAGO SEGURO', 'MISSÃO<br><em>CUMPRIDA</em>', `Três ondas derrubadas · ${state.score} pontos`, 'Jogar novamente']
  };
  if (!screens[next]) return;
  [eyebrow.textContent, title.innerHTML, description.textContent] = screens[next];
  action.innerHTML = `${screens[next][3]} <span aria-hidden="true">▸</span>`;
  action.focus({preventScroll: true});
}

function spawnWave() {
  const p = state.player;
  const count = WAVE_SIZES[state.wave];
  for (let i = 0; i < count; i++) {
    const yaw = p.yaw + (i - (count - 1) / 2) * .39;
    const distance = 189 + (i % 2) * 39 + state.wave * 28;
    const hp = 3 + Number(state.wave > 0);
    state.enemies.push({
      x: wrap(p.x + Math.sin(yaw) * distance), y: wrap(p.y - Math.cos(yaw) * distance),
      z: clamp(p.z + (i % 3 - 1) * 21, 165, 460), yaw: yaw + Math.PI, pitch: 0, roll: 0,
      model: WAVE_DRONE_MODELS[state.wave][i], hp, maxHp: hp, speed: 95 + state.wave * 12,
      phase: 1 + i * 2.1, fireIn: 1.65 + i * .65
    });
  }
  state.banner = 1.6;
  refreshHud();
}

function start() {
  releasePilotPointer();
  pilotPointerFallback = false;
  pilotFallbackUsed = false;
  state = makeState();
  releaseInput();
  spawnWave();
  setStatus('playing');
}

function turnTowards(ship, yaw, speed, dt) {
  const turn = clamp(angleDelta(yaw, ship.yaw) * 3.8, -speed, speed);
  ship.yaw = angleDelta(ship.yaw + turn * dt, 0);
  return turn;
}

function rememberPose(ship) {
  const {x, y, z, yaw, pitch, roll} = ship;
  ship.previousPose = {x, y, z, yaw, pitch, roll};
}

function moveShip(ship, dt) {
  const flat = Math.cos(ship.pitch) * ship.speed * dt;
  ship.x = wrap(ship.x + Math.sin(ship.yaw) * flat);
  ship.y = wrap(ship.y - Math.cos(ship.yaw) * flat);
  ship.z = clamp(ship.z + Math.sin(ship.pitch) * ship.speed * dt, 74, 490);
}

function shoot(ship, yaw, pitch, hostile) {
  const speed = hostile ? 305 : 690;
  const x = Math.sin(yaw) * Math.cos(pitch);
  const y = -Math.cos(yaw) * Math.cos(pitch);
  const z = Math.sin(pitch);
  const shot = {
    x: wrap(ship.x + x * 19), y: wrap(ship.y + y * 19), z: ship.z + z * 19,
    dx: x * speed, dy: y * speed, dz: z * speed, hostile, life: hostile ? 1.85 : .92
  };
  state.shots.push(shot);
  emit({...shot, dx: 0, dy: 0, dz: 0, type: 'flash', life: .075, size: 12,
    color: hostile ? '#ff655a' : '#ffd17a'});
  if (!hostile) state.muzzle = .075;
  audio.play(hostile ? 'hostile' : 'cannon', hostile ? .45 : 1);
}

function aimPlayer() {
  const p = state.player;
  let x = state.pointer.x - MID_X, y = state.pointer.y - MID_Y;
  let yaw = p.yaw, pitch = p.pitch;
  if (!pointerInside) return {yaw, pitch};
  if (state.camera === 0) {
    if (Math.hypot(x, y) > 15) yaw = Math.atan2(x, -y);
  } else {
    const chase = state.camera === 1;
    const tilt = -Math.sin(p.roll) * (chase ? .12 : .19);
    [x, y] = [x * Math.cos(tilt) + y * Math.sin(tilt), y * Math.cos(tilt) - x * Math.sin(tilt)];
    const reference = chase ? p.pitch * .63 - .22 : p.pitch;
    const depth = chase ? 434 : 302;
    yaw += Math.atan2(x * depth / FOCAL, 310);
    pitch = Math.atan2((chase ? 36 : 5) + (Math.tan(reference) - y / FOCAL) * depth, 310);
  }

  // Assistência curta na direção da mira para compensar o tamanho dos sprites.
  const originalYaw = yaw, originalPitch = pitch;
  let best = .23;
  for (const enemy of state.enemies) {
    const dx = delta(enemy.x, p.x), dy = delta(enemy.y, p.y);
    const distance = Math.hypot(dx, dy);
    if (distance > 560) continue;
    const bearing = Math.atan2(dx, -dy);
    const elevation = Math.atan2(enemy.z - p.z, distance);
    const error = Math.hypot(angleDelta(bearing, originalYaw), state.camera === 0 ? 0 : elevation - originalPitch);
    if (error >= best || (state.camera !== 0 && Math.abs(angleDelta(bearing, p.yaw)) > 1.25)) continue;
    best = error;
    const lead = distance / 790;
    const flat = enemy.speed * Math.cos(enemy.pitch) * lead;
    yaw = Math.atan2(dx + Math.sin(enemy.yaw) * flat, -dy + Math.cos(enemy.yaw) * flat);
    pitch = Math.atan2(enemy.z - p.z + Math.sin(enemy.pitch) * enemy.speed * lead, distance);
  }
  return {yaw, pitch};
}

function updatePlayer(dt) {
  const p = state.player;
  rememberPose(p);
  let turn = 0;
  let climb = state.camera === 0 ? (Number(held('KeyW')) - Number(held('KeyS'))) * .46 : 0;
  if (pointerInside) {
    const x = state.pointer.x - MID_X, y = state.pointer.y - MID_Y;
    if (state.camera === 0) {
      if (Math.hypot(x, y) > 15) turn = clamp(angleDelta(Math.atan2(x, -y), p.yaw) * 5.2, -2.7, 2.7);
    } else {
      turn = clamp(x / 170, -1, 1) * 2.1;
      climb = clamp(-y / 153, -1, 1) * .48;
    }
  }
  p.turnRate = approach(p.turnRate, turn, 15, dt);
  p.yaw = angleDelta(p.yaw + p.turnRate * dt, 0);
  p.course = angleDelta(p.course + angleDelta(p.yaw, p.course) * (1 - Math.exp(-11 * dt)), 0);
  p.pitch = approach(p.pitch, climb, 8, dt);
  const bank = p.turnRate * .23;
  if (p.rollTime > 0) {
    p.rollTime = Math.max(0, p.rollTime - dt);
    const progress = 1 - p.rollTime / .64;
    p.roll = bank + p.rollSide * TAU * (progress * progress * (3 - 2 * progress));
    if (!p.rollTime) p.roll = bank;
  } else {
    p.roll = approach(p.roll, bank, 11, dt);
  }
  const wasBoosting = p.boost;
  p.boost = held('ShiftLeft') || held('ShiftRight');
  if (p.boost && !wasBoosting) audio.play('boost');
  const targetSpeed = (p.boost ? 290 : 159) - Math.sin(p.pitch) * 83 - Math.abs(p.turnRate) * 4;
  p.speed = approach(p.speed, targetSpeed, p.boost ? 4.7 : 2.35, dt);
  const flat = Math.cos(p.pitch) * p.speed;
  const vx = Math.sin(p.course) * flat, vy = -Math.cos(p.course) * flat;
  p.verticalSpeed = approach(p.verticalSpeed, Math.sin(p.pitch) * p.speed, 10, dt);
  p.x = wrap(p.x + vx * dt);
  p.y = wrap(p.y + vy * dt);
  p.z = Math.min(490, p.z + p.verticalSpeed * dt);
  if (p.z >= 490) p.verticalSpeed = Math.min(0, p.verticalSpeed);
  terrainContact(p, vx, vy);
  if (state.pilotMode) return;
  seaWake(p, dt);
  p.cooldown -= dt;
  if ((firing || held('Fire')) && p.cooldown <= 0) {
    const aim = aimPlayer();
    shoot(p, aim.yaw, aim.pitch, false);
    p.cooldown = .129;
  }
  state.trailTime -= dt;
  if (state.trailTime <= 0) {
    const {x, y, z, yaw, roll} = p;
    state.trail.push({x, y, z, yaw, roll, time: state.time});
    state.trailTime = .033;
  }
  while (state.trail.length && state.time - state.trail[0].time > 2.05) state.trail.shift();
}

function terrainContact(p, vx, vy) {
  const {height, index, ocean} = world;
  const cell = index(p.x, p.y);
  const ground = height[cell];
  const clearance = ground + 11;
  if (p.z > clearance + 8) p.groundContact = false;
  if (p.z >= clearance) return;

  const dx = (height[index(p.x + 8, p.y)] - height[index(p.x - 8, p.y)]) / 16;
  const dy = (height[index(p.x, p.y + 8)] - height[index(p.x, p.y - 8)]) / 16;
  const impact = Math.max(0, (dx * vx + dy * vy - p.verticalSpeed) / Math.hypot(dx, dy, 1));
  p.z = clearance + 2;
  p.verticalSpeed = clamp(19 + impact * .26, 19, 56);
  p.pitch = Math.max(p.pitch, .075);
  if (p.groundContact) return;
  p.groundContact = true;
  p.speed *= impact > 52 ? .68 : .89;
  if (ocean[cell]) spray(p, 12);
  else burst({x: p.x, y: p.y, z: ground + 4}, false);
  audio.play(impact > 52 ? 'hit' : 'scrape');
  damage(Math.round(clamp(4 + impact * .38, 5, 50)));
}

function seaWake(p, dt) {
  p.wakeIn = Math.max(0, p.wakeIn - dt);
  if (p.wakeIn || p.z > 57 || p.speed < 177 || !world.ocean[world.index(p.x, p.y)]) return;
  p.wakeIn = .055;
  spray(p, p.boost ? 4 : 2);
}

function spray(p, count) {
  for (let i = 0; i < count; i++) {
    const offset = (Math.random() - .5) * 17;
    const angle = p.course + (offset < 0 ? -1 : 1) * 1.3;
    emit({x: wrap(p.x + Math.cos(p.course) * offset), y: wrap(p.y + Math.sin(p.course) * offset),
      z: 1, dx: Math.sin(angle) * 22, dy: -Math.cos(angle) * 22, dz: 4 + Math.random() * 19,
      life: .55 + Math.random() * .5, size: 3 + Math.random() * 4, type: 'spray', color: '#d5f5f2'});
  }
}

function updateDrones(dt) {
  const p = state.player;
  for (const enemy of state.enemies) {
    rememberPose(enemy);
    const dx = delta(p.x, enemy.x), dy = delta(p.y, enemy.y);
    const distance = Math.hypot(dx, dy);
    const bearing = Math.atan2(dx, -dy);
    const orbit = enemy.phase % 2 < 1 ? 1 : -1;
    const offset = clamp((240 - distance) / 130, 0, 1) * 1.9 * orbit;
    const turn = turnTowards(enemy, bearing + offset, 1.4, dt);
    enemy.roll = lerp(enemy.roll, turn * .31, dt * 4);
    const ground = world.height[world.index(enemy.x, enemy.y)];
    const altitude = Math.max(ground + 44, p.z + Math.sin(state.time + enemy.phase) * 30);
    enemy.pitch = clamp((altitude - enemy.z) / 100, -.32, .32);
    moveShip(enemy, dt);
    enemy.fireIn -= dt;
    if (enemy.fireIn > 0 || distance > 410 || Math.abs(angleDelta(bearing, enemy.yaw)) > 1.25) continue;
    const lead = distance / 710;
    const aimX = dx + Math.sin(p.course) * p.speed * lead;
    const aimY = dy - Math.cos(p.course) * p.speed * lead;
    shoot(enemy, Math.atan2(aimX, -aimY), Math.atan2(p.z - enemy.z + p.verticalSpeed * lead, distance), true);
    enemy.fireIn = 2.1 - state.wave * .35 + enemy.phase % .6;
  }
}

function emit(particle) {
  if (state.particles.length >= PARTICLE_LIMIT) state.particles.shift();
  state.particles.push({...particle, lifetime: particle.life});
}

function burst(ship, large) {
  const colors = ['#fff4aa', '#ffae55', '#f47a48', '#c44c48', '#626b70'];
  if (large) {
    emit({x: ship.x, y: ship.y, z: ship.z, dx: 0, dy: 0, dz: 0, life: .21, size: 49, type: 'flash', color: '#ffae58'});
    audio.play('explosion');
  }
  const count = large ? 44 : 10;
  for (let i = 0; i < count; i++) {
    const a = Math.random() * TAU, v = 6 + Math.random() * (large ? 120 : 58);
    const smoke = large && i < 17;
    const debris = large && i >= count - 8;
    emit({x: ship.x, y: ship.y, z: ship.z, dx: Math.sin(a) * v * (smoke ? .27 : 1),
      dy: Math.cos(a) * v * (smoke ? .27 : 1), dz: smoke ? 8 + Math.random() * 19 : (Math.random() - .35) * v,
      life: .2 + Math.random() * (large ? .85 : .26) + (smoke ? .75 : 0),
      size: 1 + Math.random() * (large ? 8 : 4), type: smoke ? 'smoke' : debris ? 'debris' : 'spark',
      color: smoke ? (i % 2 ? '#31465a' : '#536174') : debris ? '#443c44' : colors[i % colors.length]});
  }
}

function damage(amount) {
  const p = state.player;
  if (p.hp <= 0 || state.hit > .16) return;
  p.hp = Math.max(0, p.hp - amount);
  state.hit = .3;
  if (!p.hp) {
    burst(p, false);
    state.pilotMode = 'falling';
    state.camera = 0;
    state.banner = 0;
    state.muzzle = 0;
    state.trail.length = 0;
    state.enemies.length = 0;
    const clearance = Math.max(0, p.z - world.height[world.index(p.x, p.y)]);
    state.wreck = {...p, elapsed: 0, duration: clamp(1.8 + clearance / 110, 2, 4.5),
      initialZ: p.z, smokeIn: 0};
    p.boost = false;
    releaseInput();
  }
  refreshHud();
}

function eject() {
  if (!state.running || state.pilotMode !== 'falling') return;
  const p = state.player;
  p.z = state.wreck.z + 24;
  p.previousPose = null;
  p.roll = 0;
  p.pitch = 0;
  p.speed = 0;
  state.pilotMode = 'parachute';
  refreshHud();
}

function updateWreck(dt) {
  const wreck = state.wreck;
  if (!wreck) return;
  rememberPose(wreck);
  wreck.elapsed += dt;
  const progress = Math.min(1, wreck.elapsed / wreck.duration);
  wreck.yaw += dt * (.5 + progress * .9);
  wreck.course = wreck.yaw;
  wreck.roll += dt * 3.5;
  wreck.pitch = lerp(-.18, -1.02, progress);
  wreck.x = wrap(wreck.x + Math.sin(wreck.yaw) * wreck.speed * .72 * dt);
  wreck.y = wrap(wreck.y - Math.cos(wreck.yaw) * wreck.speed * .72 * dt);
  const cell = world.index(wreck.x, wreck.y);
  const ground = world.height[cell];
  wreck.z = lerp(Math.max(wreck.initialZ * (1 - progress * progress), ground + 3), ground, progress ** 4);
  if (state.pilotMode === 'falling') {
    const p = state.player;
    rememberPose(p);
    p.x = wreck.x;
    p.y = wreck.y;
    p.z = wreck.z;
    p.yaw = p.course = wreck.yaw;
  }
  wreck.smokeIn -= dt;
  if (wreck.smokeIn <= 0) {
    const tail = 16;
    emit({x: wrap(wreck.x - Math.sin(wreck.yaw) * tail), y: wrap(wreck.y + Math.cos(wreck.yaw) * tail),
      z: wreck.z, dx: 0, dy: 0, dz: 9, size: 9, life: 1.15, type: 'smoke', color: '#27313c'});
    wreck.smokeIn = .055;
  }
  if (progress < 1) return;
  burst(wreck, true);
  if (world.ocean[cell]) spray(wreck, 18);
  state.wreck = null;
  if (state.pilotMode === 'falling') setStatus('lost');
}

function nearestLand(p) {
  let best = Infinity;
  let shore = null;
  for (let i = 0; i < world.ocean.length; i++) {
    if (world.ocean[i]) continue;
    const x = (i % MAP_SIZE + .5) * MAP_SCALE;
    const y = (Math.floor(i / MAP_SIZE) + .5) * MAP_SCALE;
    const dx = delta(x, p.x), dy = delta(y, p.y);
    const distance = dx * dx + dy * dy;
    if (distance >= best) continue;
    best = distance;
    shore = {x, y};
  }
  return shore;
}

function updatePilot(dt) {
  const p = state.player;
  rememberPose(p);
  const parachute = state.pilotMode === 'parachute';
  const usingStick = Math.hypot(stickX, stickY) > .14;
  const x = Number(held('KeyD') || held('ArrowRight')) - Number(held('KeyA') || held('ArrowLeft')) + (usingStick ? stickX : 0);
  const y = Number(held('KeyS') || held('ArrowDown')) - Number(held('KeyW') || held('ArrowUp')) + (usingStick ? stickY : 0);
  const magnitude = Math.hypot(x, y);
  const pilot = state.pilot;
  const overhead = pilot?.camera === 2;
  if (overhead && pointerInside) {
    const aimX = state.pointer.x - MID_X;
    const aimY = state.pointer.y - MID_Y;
    const distance = Math.hypot(aimX, aimY) / PILOT_MAP_ZOOM;
    if (distance > 4) {
      pilot.yaw = Math.atan2(aimX, -aimY);
      const targetHeight = world.groundHeight(p.x + aimX / PILOT_MAP_ZOOM, p.y + aimY / PILOT_MAP_ZOOM);
      pilot.pitch = Math.atan2(targetHeight + 9 - p.z - pilot.eyeHeight, distance);
    }
  }
  const swimming = state.pilotMode === 'swimming';
  const crouching = !swimming && held('KeyC');
  const walkingSlow = held('ShiftLeft') || held('ShiftRight');
  const maxSpeed = parachute ? 42 : swimming ? 52 : crouching ? 26 : walkingSlow ? 36 : 77;
  const speed = maxSpeed * Math.min(1, magnitude);
  const yaw = Math.atan2(x, -y) + (overhead ? 0 : (pilot?.yaw ?? 0));
  let dx = magnitude > 0 ? Math.sin(yaw) * speed : 0;
  let dy = magnitude > 0 ? -Math.cos(yaw) * speed : 0;
  if (pilot) {
    const rate = swimming ? 8 : magnitude > 0 ? 18 : 30;
    pilot.dx = dx = approach(pilot.dx, dx, rate, dt);
    pilot.dy = dy = approach(pilot.dy, dy, rate, dt);
    pilot.eyeHeight = approach(pilot.eyeHeight, crouching ? 7 : PILOT_EYE_HEIGHT, 13, dt);
  }
  p.speed = Math.hypot(dx, dy);
  if (magnitude > 0) p.yaw = p.course = yaw;
  const nextX = wrap(p.x + dx * dt);
  if (!state.ground?.blocks({x: nextX, y: p.y})) p.x = nextX;
  else pilot.dx = 0;
  const nextY = wrap(p.y + dy * dt);
  if (!state.ground?.blocks({x: p.x, y: nextY})) p.y = nextY;
  else pilot.dy = 0;
  if (swimming && !state.ground && state.time >= (state.shoreUpdate ?? 0)) {
    state.shore = nearestLand(p);
    state.shoreUpdate = state.time + .5;
  }
  const cell = world.index(p.x, p.y);
  const ground = world.height[cell];
  if (parachute) {
    p.z -= 68 * dt;
    if (p.z > ground) return;
  }
  const mode = world.ocean[cell] ? 'swimming' : 'walking';
  p.z = mode === 'walking' ? world.groundHeight(p.x, p.y) : 0;
  if (mode === state.pilotMode) return;
  if (parachute && mode === 'swimming') spray(p, 13);
  state.pilotMode = mode;
  if (!pilot) {
    state.shore = mode === 'swimming' ? nearestLand(p) : null;
    const heading = state.shore ? Math.atan2(delta(state.shore.x, p.x), -delta(state.shore.y, p.y)) : p.yaw;
    state.pilot = createPilotControls(heading);
    state.shots.length = 0;
    state.hit = 0;
    state.muzzle = 0;
    pilotShot = false;
    firing = false;
  }
  if (mode === 'walking' && !state.ground) {
    state.ground = createGroundMission(world, p, state.pilot);
  }
  if (mode === 'swimming') {
    state.pilot.reload = 0;
    pilotShot = false;
    state.muzzle = 0;
  }
  if (mode === 'walking') state.shore = null;
  refreshHud();
}

function reloadPilot() {
  const {pilot, pilotMode} = state;
  if (pilotMode !== 'walking' || pilot.reload > 0 || !pilot.reserve || pilot.magazine >= PISTOL_CAPACITY) return;
  pilot.reload = 1.08;
  refreshPilotHud();
}

function updatePilotCombat(dt) {
  const ground = state.ground;
  const pilot = state.pilot;
  const walking = state.pilotMode === 'walking';
  pilot.cooldown = Math.max(0, pilot.cooldown - dt);
  pilot.recoil = Math.max(0, pilot.recoil - 1.75 * dt);
  pilot.hit = Math.max(0, pilot.hit - dt * 2.6);
  pilot.spread = (pilot.eyeHeight < 9 ? .006 : .01) + (state.player.speed / 77) ** 2 * .105 + pilot.recoil * .045;
  if (pilot.reload > 0) {
    pilot.reload = Math.max(0, pilot.reload - dt);
    if (!pilot.reload) {
      const loaded = Math.min(PISTOL_CAPACITY - pilot.magazine, pilot.reserve);
      pilot.magazine += loaded;
      pilot.reserve -= loaded;
      refreshPilotHud();
    }
  }
  if (walking && pilotShot && !pilot.cooldown && !pilot.reload) {
    if (!pilot.magazine) reloadPilot();
    else {
      pilot.magazine--;
      const hit = ground.fire(state.player);
      pilot.cooldown = .23;
      pilot.recoil = Math.min(1, pilot.recoil + .45);
      state.muzzle = .09;
      audio.play('cannon', .5);
      if (hit) {
        burst(hit, false);
        audio.play('hit', .56);
        pilot.confirm = .15;
      }
      refreshPilotHud();
    }
  }
  pilotShot = false;
  pilot.confirm = Math.max(0, (pilot.confirm ?? 0) - dt);
  if (!ground) return;
  const health = pilot.health;
  const outcome = ground.update(dt, state.player, walking);
  if (ground.soldiers.some(soldier => soldier.flash === .095)) audio.play('hostile', .48);
  if (pilot.health !== health) {
    audio.play('hit', .53);
    refreshPilotHud();
  }
  if (outcome) setStatus(outcome);
}

function updateProjectiles(dt) {
  for (const shot of state.shots) {
    shot.x = wrap(shot.x + shot.dx * dt);
    shot.y = wrap(shot.y + shot.dy * dt);
    shot.z += shot.dz * dt;
    shot.life -= dt;
    if (shot.life <= 0 || shot.z <= world.height[world.index(shot.x, shot.y)]) {
      shot.life = 0;
      continue;
    }
    const targets = shot.hostile ? [state.player] : state.enemies;
    for (const ship of targets) {
      if (ship.hp <= 0 || Math.hypot(delta(shot.x, ship.x), delta(shot.y, ship.y), (shot.z - ship.z) * 1.35) > 21) continue;
      shot.life = 0;
      if (shot.hostile) {
        if (!ship.rollTime) {
          burst(shot, false);
          audio.play('hit');
          damage(16 + state.wave * 2);
        }
      } else {
        ship.hp--;
        burst(ship.hp ? shot : ship, ship.hp === 0);
        if (ship.hp) audio.play('hit', .56);
        if (!ship.hp) {
          state.score += 100 * (state.wave + 1);
          refreshHud();
        }
      }
      break;
    }
  }
  state.shots = state.shots.filter(shot => shot.life > 0);
  state.enemies = state.enemies.filter(enemy => enemy.hp > 0);
}

function updateParticles(dt) {
  for (const p of state.particles) {
    p.x = wrap(p.x + p.dx * dt);
    p.y = wrap(p.y + p.dy * dt);
    p.z += p.dz * dt;
    if (p.type === 'spark' || p.type === 'debris') p.dz -= 49 * dt;
    if (p.type === 'spray') {
      p.dz -= 65 * dt;
      p.z = Math.max(1, p.z);
      if (p.z === 1 && !world.ocean[world.index(p.x, p.y)]) p.life = 0;
    }
    p.life -= dt;
  }
  state.particles = state.particles.filter(p => p.life > 0);
}

function step(dt) {
  state.time += dt;
  state.hit = Math.max(0, state.hit - dt);
  state.muzzle = Math.max(0, state.muzzle - dt);
  state.banner = Math.max(0, state.banner - dt);
  updateParticles(dt);
  if (state.pilotMode) {
    if (state.pilotMode !== 'falling') updatePilot(dt);
    updateWreck(dt);
    updateProjectiles(dt);
    if (state.pilot) updatePilotCombat(dt);
    return;
  }
  updatePlayer(dt);
  if (state.pilotMode) return;
  updateDrones(dt);
  updateProjectiles(dt);
  if (state.player.hp === 0) return;
  if (state.enemies.length) return;
  state.waveDelay += dt;
  if (state.waveDelay < 1.2) return;
  if (state.wave + 1 === WAVE_SIZES.length) {
    setStatus('won');
    return;
  }
  state.wave++;
  state.waveDelay = 0;
  spawnWave();
}

function point(event) {
  if (touchDevice.matches && event.pointerType === 'touch') return;
  const box = canvas.getBoundingClientRect();
  state.pointer.x = clamp((event.clientX - box.left) * WIDTH / box.width, 0, WIDTH - 1);
  state.pointer.y = clamp((event.clientY - box.top) * HEIGHT / box.height, 0, HEIGHT - 1);
  pointerInside = true;
}

function refreshTouchControls() {
  document.body.classList.toggle('touch-device', touchDevice.matches);
  document.body.classList.toggle('playing-touch', touchDevice.matches && state.running);
  touchControls.hidden = !touchDevice.matches || !state.running;
}

function steerTouch(x, y) {
  const magnitude = Math.max(1, Math.hypot(x, y));
  stickX = x / magnitude;
  stickY = y / magnitude;
  stick.firstElementChild.style.transform = `translate(${stickX * 22}px,${stickY * 22}px)`;
  if (state.ground) return;
  state.pointer.x = MID_X + stickX * 171;
  state.pointer.y = MID_Y + stickY * 153;
  pointerInside = Math.hypot(stickX, stickY) > .14;
}

function moveStick(event) {
  if (event.pointerId !== stickPointer) return;
  const box = stick.getBoundingClientRect();
  steerTouch((event.clientX - box.left - box.width / 2) / 29,
    (event.clientY - box.top - box.height / 2) / 29);
}

function nextCamera() {
  if (state.pilot) {
    state.pilot.camera = (state.pilot.camera + 1) % PILOT_CAMERAS.length;
    state.pilot.pitch = 0;
    releaseInput();
    releasePilotPointer();
    state.pointer = {x: MID_X, y: MID_Y};
    pointerInside = false;
    refreshHud();
    return;
  }
  if (state.pilotMode) return;
  state.camera = (state.camera + 1) % cameraNames.length;
  if (stickPointer !== null) steerTouch(stickX, stickY);
  else {
    state.pointer = {x: MID_X, y: MID_Y};
    pointerInside = false;
  }
  if (state.camera !== 0) {
    for (const button of touchAltitude.querySelectorAll('button')) {
      touchKeys.delete(button.dataset.flightKey);
      button.classList.remove('is-held');
    }
  }
  refreshHud();
}

function roll(side) {
  if (state.pilotMode || state.player.rollTime) return;
  state.player.rollTime = .64;
  state.player.rollSide = side;
}

touchDevice.addEventListener('change', () => {
  releaseInput();
  refreshTouchControls();
});
stick.addEventListener('pointerdown', event => {
  if (status !== 'playing' || stickPointer !== null) return;
  stickPointer = event.pointerId;
  stick.setPointerCapture(event.pointerId);
  moveStick(event);
});
stick.addEventListener('pointermove', moveStick);
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  stick.addEventListener(type, event => {
    if (event.pointerId !== stickPointer) return;
    stickPointer = null;
    steerTouch(0, 0);
  });
}
for (const button of touchControls.querySelectorAll('[data-flight-key]')) {
  const code = button.dataset.flightKey;
  button.addEventListener('pointerdown', event => {
    if (status !== 'playing' || touchKeys.has(code)) return;
    if (code === 'KeyR') reloadPilot();
    if (code === 'Fire' && state.pilotMode === 'walking') pilotShot = true;
    button.setPointerCapture(event.pointerId);
    touchKeys.set(code, event.pointerId);
    button.classList.add('is-held');
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    button.addEventListener(type, event => {
      if (touchKeys.get(code) !== event.pointerId) return;
      touchKeys.delete(code);
      button.classList.remove('is-held');
    });
  }
}
touchCamera.addEventListener('click', nextCamera);
document.querySelector('#touch-roll').addEventListener('click', () => roll(1));

action.addEventListener('click', () => {
  audio.activate();
  if (status === 'paused') setStatus('playing');
  else start();
});
restart.addEventListener('click', start);
showTutorial.addEventListener('click', () => tutorial.showModal());
ejectButton.addEventListener('click', eject);
sound.addEventListener('click', () => {
  muted = !muted;
  sound.setAttribute('aria-pressed', String(muted));
  sound.setAttribute('aria-label', muted ? 'Ativar som' : 'Silenciar');
  sound.textContent = muted ? '×♪' : '♪';
  audio.setMuted(muted);
});
document.querySelector('#pause').addEventListener('click', () => setStatus('paused'));

function turnPilot(dx, dy, sensitivity) {
  const pilot = state.pilot;
  pilot.yaw = angleDelta(pilot.yaw + dx * sensitivity, 0);
  pilot.pitch = clamp(pilot.pitch - dy * sensitivity, -.55, .55);
}

function usePilotPointerFallback() {
  pilotPointerFallback = true;
  refreshPilotHud();
}

function capturePilotPointer() {
  if (!canvas.requestPointerLock) {
    usePilotPointerFallback();
    return;
  }
  try {
    canvas.requestPointerLock()?.catch(usePilotPointerFallback);
  } catch {
    usePilotPointerFallback();
  }
}

document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === canvas) {
    if (status !== 'playing' || state.pilot?.camera !== 1) releasePilotPointer();
    else {
      pilotLocked = true;
      refreshPilotHud();
    }
  } else if (pilotLocked) {
    pilotLocked = false;
    if (status === 'playing') {
      pointerPauseAt = performance.now();
      setStatus('paused');
    }
  }
});
document.addEventListener('pointerlockerror', () => {
  if (status === 'playing' && state.pilot?.camera === 1) usePilotPointerFallback();
});
document.addEventListener('mousemove', event => {
  if (pilotLocked && status === 'playing') turnPilot(event.movementX, event.movementY, .0028);
});
canvas.addEventListener('contextmenu', event => { if (state.pilot && state.running) event.preventDefault(); });
canvas.addEventListener('pointermove', event => {
  const look = event.pointerType === 'touch' ? lookTouch : lookDrag;
  if (look?.id === event.pointerId && state.pilot) {
    const scale = WIDTH / canvas.getBoundingClientRect().width;
    turnPilot(event.clientX - look.x, event.clientY - look.y, scale * (lookTouch === look ? .006 : .0038));
    look.x = event.clientX;
    look.y = event.clientY;
    return;
  }
  if (!state.pilot || state.pilot.camera === 2) point(event);
});
canvas.addEventListener('pointerleave', () => { pointerInside = false; });
canvas.addEventListener('pointerdown', event => {
  if (!state.running) return;
  if (state.pilot) {
    if (event.pointerType === 'touch') {
      if (lookTouch) return;
      lookTouch = {id: event.pointerId, x: event.clientX, y: event.clientY};
      canvas.setPointerCapture(event.pointerId);
    } else if (event.button === 2 && !pilotLocked && state.pilot.camera !== 2) {
      lookDrag = {id: event.pointerId, x: event.clientX, y: event.clientY};
      if (state.pilot.camera === 1) {
        pilotFallbackUsed = true;
        usePilotPointerFallback();
      }
      canvas.setPointerCapture(event.pointerId);
    } else if (event.button === 0) {
      if (state.pilot.camera === 1 && !pilotLocked && !pilotPointerFallback) capturePilotPointer();
      else if (state.pilotMode === 'walking') {
        if (state.pilot.camera === 2) point(event);
        pilotShot = true;
      }
    }
    return;
  }
  if (event.button !== 0 || status !== 'playing' || (touchDevice.matches && event.pointerType === 'touch')) return;
  point(event);
  firing = true;
  canvas.setPointerCapture(event.pointerId);
});
window.addEventListener('pointerup', () => { firing = false; });
canvas.addEventListener('pointercancel', () => { firing = false; pointerInside = false; });
canvas.addEventListener('lostpointercapture', () => { firing = false; });
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  canvas.addEventListener(type, event => {
    if (lookTouch?.id === event.pointerId) lookTouch = null;
    if (lookDrag?.id === event.pointerId) {
      lookDrag = null;
      refreshPilotHud();
    }
  });
}
window.addEventListener('keydown', event => {
  if (event.code === 'Escape' && (status === 'playing' || status === 'paused')) {
    event.preventDefault();
    if (status === 'paused' && performance.now() - pointerPauseAt < 250) return;
    if (!event.repeat) setStatus(status === 'playing' ? 'paused' : 'playing');
    return;
  }
  if (status !== 'playing') return;
  if (state.pilotMode === 'falling' && event.code === 'KeyE') {
    event.preventDefault();
    if (!event.repeat) eject();
    return;
  }
  if (state.pilotMode && event.code.startsWith('Arrow')) event.preventDefault();
  if (state.pilotMode === 'walking' && event.code === 'KeyR' && !event.repeat) reloadPilot();
  keys.add(event.code);
  if (event.code === 'Space') {
    if (event.target instanceof HTMLButtonElement) return;
    event.preventDefault();
    if (!event.repeat) nextCamera();
  }
  if ((event.code === 'KeyQ' || event.code === 'KeyE') && !event.repeat) roll(event.code === 'KeyQ' ? -1 : 1);
});
window.addEventListener('keyup', event => keys.delete(event.code));
window.addEventListener('blur', () => { if (status === 'playing') setStatus('paused'); });
document.addEventListener('visibilitychange', () => { if (document.hidden && status === 'playing') setStatus('paused'); });

state = makeState();
refreshTouchControls();
state.camera = 1;
state.player.boost = true;
for (let i = 35; i > 0; i--) {
  const yaw = state.player.yaw + i * .015;
  state.trail.push({x: state.player.x - Math.sin(yaw) * i * 8, y: state.player.y + Math.cos(yaw) * i * 8,
    z: state.player.z - i * 1.5, yaw, roll: 0, time: -i * .04});
}
render(state);

let previous = 0, accumulator = 0;
requestAnimationFrame(function frame(now) {
  if (status === 'playing') {
    accumulator += Math.min((now - previous) / 1000, .083);
    while (accumulator >= FRAME && status === 'playing') {
      step(FRAME);
      accumulator -= FRAME;
    }
    render(state, accumulator / FRAME, FRAME);
    audio.flight(state.player);
  } else {
    accumulator = 0;
  }
  previous = now;
  requestAnimationFrame(frame);
});
