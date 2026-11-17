const canvas = document.querySelector('#flight');
const game = document.querySelector('.game');
const hud = document.querySelector('.hud');
const integrity = document.querySelector('#integrity');
const waveLabel = document.querySelector('#wave');
const scoreLabel = document.querySelector('#score');
const cameraLabel = document.querySelector('#camera');
const overlay = document.querySelector('.overlay');
const guide = document.querySelector('#guide');
const title = document.querySelector('#title');
const eyebrow = document.querySelector('#eyebrow');
const description = document.querySelector('#description');
const action = document.querySelector('#action');
const sound = document.querySelector('#sound');
const altitudeKeys = document.querySelector('#altitude-keys');
const touchControls = document.querySelector('.touch-controls');
const touchAltitude = document.querySelector('.touch-altitude');
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
let state;
let status = 'intro';
let firing = false;
let pointerInside = false;
let muted = false;
let stickPointer = null;
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
    waveDelay: 0, hit: 0, muzzle: 0, pointer: {x: MID_X, y: MID_Y}, messageDelay: 0};
}

function refreshHud() {
  integrity.value = Math.ceil(state.player.hp);
  waveLabel.textContent = `${state.wave + 1} / ${WAVE_SIZES.length}`;
  scoreLabel.textContent = String(state.score).padStart(4, '0');
  cameraLabel.textContent = cameraNames[state.camera];
  altitudeKeys.hidden = state.camera !== 0;
  touchAltitude.hidden = state.camera !== 0;
}

function releaseInput() {
  keys.clear();
  touchKeys.clear();
  for (const button of touchControls.querySelectorAll('.is-held')) button.classList.remove('is-held');
  stickPointer = null;
  steerTouch(0, 0);
  firing = false;
  pointerInside = false;
}

function setStatus(next) {
  status = next;
  state.running = next === 'playing';
  game.classList.toggle('playing', state.running);
  hud.hidden = !state.running;
  overlay.hidden = state.running;
  refreshTouchControls();
  audio.setPlaying(state.running);
  if (state.running) {
    action.blur();
    refreshHud();
    return;
  }
  releaseInput();
  guide.hidden = next !== 'intro';
  const screens = {
    paused: ['MISSÃO EM CURSO', 'PAUSA', 'Pressione Esc ou retome o voo.', 'Retomar missão'],
    won: ['ARQUIPÉLAGO SEGURO', 'MISSÃO<br><em>CUMPRIDA</em>', `Três ondas derrubadas · ${state.score} pontos`, 'Jogar novamente'],
    lost: ['CAÇA FORA DE COMBATE', 'MISSÃO<br><em>ENCERRADA</em>', `Onda ${state.wave + 1} de 3 · ${state.score} pontos`, 'Tentar novamente']
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
  if (!p.hp) burst(p, true);
  refreshHud();
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
  if (state.player.hp === 0) {
    state.messageDelay += dt;
    if (state.messageDelay > .72) setStatus('lost');
    return;
  }
  updatePlayer(dt);
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
  if (state.player.rollTime) return;
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
document.querySelector('#touch-camera').addEventListener('click', nextCamera);
document.querySelector('#touch-roll').addEventListener('click', () => roll(1));

action.addEventListener('click', () => {
  audio.activate();
  if (status === 'paused') setStatus('playing');
  else start();
});
sound.addEventListener('click', () => {
  muted = !muted;
  sound.setAttribute('aria-pressed', String(muted));
  sound.setAttribute('aria-label', muted ? 'Ativar som' : 'Silenciar');
  sound.textContent = muted ? '×♪' : '♪';
  audio.setMuted(muted);
});
document.querySelector('#pause').addEventListener('click', () => setStatus('paused'));
canvas.addEventListener('pointermove', point);
canvas.addEventListener('pointerleave', () => { pointerInside = false; });
canvas.addEventListener('pointerdown', event => {
  if (event.button !== 0 || status !== 'playing' || (touchDevice.matches && event.pointerType === 'touch')) return;
  point(event);
  firing = true;
  canvas.setPointerCapture(event.pointerId);
});
window.addEventListener('pointerup', () => { firing = false; });
canvas.addEventListener('pointercancel', () => { firing = false; pointerInside = false; });
canvas.addEventListener('lostpointercapture', () => { firing = false; });
window.addEventListener('keydown', event => {
  if (event.code === 'Escape' && (status === 'playing' || status === 'paused')) {
    if (!event.repeat) setStatus(status === 'playing' ? 'paused' : 'playing');
    return;
  }
  if (status !== 'playing') return;
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
