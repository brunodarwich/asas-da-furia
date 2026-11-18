'use strict';

const canvas = document.querySelector('#arena');
const arena = canvas.parentElement;
const renderer = createTacticalRenderer(canvas, document.querySelector('#radar'));
const audio = createFlightAudio();
const touchDevice = matchMedia('(pointer: coarse)');
const ui = Object.fromEntries([
  'hud', 'allies-score', 'allies-alive', 'rivals-score', 'rivals-alive', 'round-number', 'timer', 'role',
  'objective', 'feed', 'crosshair', 'feedback', 'health', 'armor', 'credits', 'weapon', 'magazine', 'reserve',
  'utility',
  'buy-hint', 'shop-button', 'overlay', 'eyebrow', 'operation-title', 'summary', 'play-operation',
  'pause-operation', 'sound-operation', 'shop', 'shop-credits', 'close-shop', 'touch'
].map(id => [id, document.getElementById(id)]));
const shopItems = [...ui.shop.querySelectorAll('[data-buy]')];
const touchSmoke = ui.touch.querySelector('[data-key="KeyQ"]');
const touchSwap = ui.touch.querySelector('[data-key="Swap"]');

const weapons = {
  pistol: {name: 'Pistola', capacity: 12, reserve: 36, damage: 27, cooldown: .28, reload: 1.15, spread: .012, price: 0},
  smg: {name: 'Submetralhadora', capacity: 24, reserve: 72, damage: 22, cooldown: .105, reload: 1.4, spread: .028, price: 1250},
  rifle: {name: 'Carabina', capacity: 20, reserve: 60, damage: 36, cooldown: .17, reload: 1.55, spread: .011, price: 2100}
};
const vestCost = 550;
const kitCost = 400;
const smokeCost = 300;
const smokeRadius = 1.65;
const roleSwapAfter = 12;
const winsToFinish = 13;
const buySeconds = 12;
const roundSeconds = 115;
const activeSeconds = 40;
const plantSeconds = 3.2;
const defuseSeconds = 10;
const startingCredits = 800;
const factions = ['Aliados', 'Rivais'];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const gap = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const wrapAngle = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
const direction = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
const formatCredits = amount => amount.toLocaleString('pt-BR');

function createLevel() {
  const width = 27, height = 19;
  const tiles = Array.from({length: height}, () => Array(width).fill('.'));
  function block(tile, x, y, w, h) {
    for (let row = y; row < y + h; row++) tiles[row].fill(tile, x, x + w);
  }
  block('#', 0, 0, width, 1);
  block('#', 0, height - 1, width, 1);
  block('#', 0, 0, 1, height);
  block('#', width - 1, 0, 1, height);
  block('W', 5, 3, 3, 5);
  block('B', 5, 11, 3, 5);
  block('R', 19, 3, 3, 5);
  block('W', 19, 11, 3, 5);
  block('C', 10, 6, 2, 3);
  block('R', 15, 6, 2, 3);
  block('C', 10, 10, 2, 3);
  block('R', 15, 10, 2, 3);
  block('B', 12, 3, 3, 1);
  block('B', 12, 15, 3, 1);
  block('C', 2, 4, 1, 2);
  block('R', 24, 13, 1, 2);
  const sites = [{id: 'A', x: 13.5, y: 9.5}, {id: 'B', x: 13.5, y: 4.5}];
  return {
    width, height, sites,
    tile(x, y) { return tiles[y]?.[x] ?? '#'; },
    open(x, y) { return tiles[Math.floor(y)]?.[Math.floor(x)] === '.'; }
  };
}

const level = createLevel();
const preview = {x: 8.3, y: 9.25, angle: .21, pitch: -.037};
const keys = new Set();
const routeDirections = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const teamSpawns = [[2.5, 0], [24.5, Math.PI]];
const spawnRows = [9.5, 8.2, 10.8, 6.7, 12.3];
const names = [
  ['Você', 'Brisa', 'Norte', 'Névoa', 'Lume'],
  ['Vigia', 'Sonda', 'Âmbar', 'Rastro', 'Ferro']
];
const coverOffsets = [[1.6, 0], [0, -1.25], [0, 1.25], [.95, -.75], [.95, .75]];
let match = null;
let paused = false;
let shopping = false;
let mouseFire = false;
let touchLook;
let pointerWasLocked = false;

function createActor(team, slot) {
  const [x, angle] = teamSpawns[team];
  return {
    team, slot, x, y: spawnRows[slot], angle, pitch: 0, eye: .54, speed: 0,
    name: names[team][slot],
    hp: 100, armor: 0, flash: 0, cooldown: .6, recoil: 0, reload: 0, stride: 0,
    primary: null, weapon: 'pistol', ammo: {pistol: ammunition('pistol')}, kit: false, smoke: false,
    path: [], routeKey: '', flank: null, target: null, aimTime: 0
  };
}

function ammunition(id) {
  return {magazine: weapons[id].capacity, reserve: weapons[id].reserve};
}

function selectWeapon(player, id) {
  if (player.hp <= 0 || !id || id === player.weapon) return;
  player.weapon = id;
  player.reload = 0;
  player.recoil = 0;
  player.cooldown = Math.max(player.cooldown, .23);
}

function arm(actor, id) {
  if (actor.primary) delete actor.ammo[actor.primary];
  actor.primary = id;
  actor.ammo[id] = ammunition(id);
  selectWeapon(actor, id);
}

function prepareActor(team, slot, previous) {
  const actor = createActor(team, slot);
  actor.credits = previous?.credits ?? startingCredits;
  if (previous?.hp > 0) {
    actor.armor = previous.armor;
    actor.kit = previous.kit;
    actor.smoke = previous.smoke;
    if (previous.primary) arm(actor, previous.primary);
  }
  if (team === 0 && slot === 0) return actor;
  if (!actor.primary) {
    const id = actor.credits >= weapons.rifle.price ? 'rifle' : 'smg';
    if (actor.credits >= weapons[id].price) {
      arm(actor, id);
      actor.credits -= weapons[id].price;
    }
  }
  if (team === match.attacker && slot === 2 && !actor.smoke && actor.credits >= smokeCost) {
    actor.smoke = true;
    actor.credits -= smokeCost;
  }
  if (!actor.armor && actor.credits >= vestCost) {
    actor.armor = 100;
    actor.credits -= vestCost;
  }
  if (team !== match.attacker && slot % 2 === 0 && !actor.kit && actor.credits >= kitCost) {
    actor.kit = true;
    actor.credits -= kitCost;
  }
  return actor;
}

function beginRound() {
  match.round++;
  match.attacker = match.round <= roleSwapAfter ? 0 : 1;
  const sideSwitch = match.round === roleSwapAfter + 1;
  const previous = sideSwitch ? [] : (match.actors ?? []);
  if (sideSwitch) match.losses = [0, 0];
  match.actors = names.flatMap((team, index) => team.map((_, slot) =>
    prepareActor(index, slot, previous[index * team.length + slot])));
  [match.player, ...match.bots] = match.actors;
  match.device = {
    carrier: match.actors.find(actor => actor.team === match.attacker && actor.slot === (match.round % 2 ? 0 : 3)),
    dropped: null, site: null, plannedSite: level.sites[match.round % 2]
  };
  match.phase = 'buy';
  match.time = buySeconds;
  match.action = null;
  match.progress = 0;
  match.pulse = 0;
  match.spectator = 0;
  match.smokes = [];
  match.combatFx = {traces: [], particles: []};
  match.result = '';
  match.hit = 0;
  match.hurt = 0;
  ui.feed.replaceChildren();
}

function startMatch() {
  match = {scores: [0, 0], losses: [0, 0], round: 0};
  paused = false;
  beginRound();
  ui.overlay.hidden = true;
  ui.hud.hidden = false;
  ui['pause-operation'].hidden = false;
  arena.classList.add('active');
  audio.activate();
  updateHud();
  capturePointer();
}

function finishRound(winner, reason) {
  if (match.phase !== 'live') return;
  match.scores[winner]++;
  const loser = 1 - winner;
  match.losses[winner] = 0;
  match.losses[loser]++;
  const winnerReward = match.device.site ? 3250 : 3000;
  const loserReward = 1400 + 500 * Math.min(4, match.losses[loser] - 1);
  for (const actor of match.actors) {
    const reward = actor.team === winner ? winnerReward : loserReward;
    const plantReward = actor.team === loser && actor.team === match.attacker && match.device.site ? 800 : 0;
    actor.credits = Math.min(16000, actor.credits + reward + plantReward);
  }
  match.result = factions[winner] + ' vencem · ' + reason;
  match.phase = 'result';
  match.time = 3.3;
}

function finishMatch() {
  match.phase = 'done';
  clearInput();
  releasePointer();
  arena.classList.remove('active');
  ui.hud.hidden = true;
  ui['pause-operation'].hidden = true;
  ui.touch.hidden = true;
  const [allies, rivals] = match.scores;
  const title = allies === rivals ? 'Empate' : allies > rivals ? 'Vitória' : 'Derrota';
  showOverlay('FIM DA PARTIDA', title,
    'Aliados ' + allies + ' × ' + rivals + ' Rivais', 'Jogar novamente');
}

function showOverlay(eyebrow, title, summary, action) {
  ui.eyebrow.textContent = eyebrow;
  ui['operation-title'].textContent = title;
  ui.summary.textContent = summary;
  ui['play-operation'].textContent = action + ' →';
  ui.overlay.hidden = false;
  ui['play-operation'].focus();
}

function walk(actor, dx, dy) {
  function fits(x, y) {
    const radius = .19;
    return level.open(x - radius, y - radius) && level.open(x + radius, y - radius)
      && level.open(x - radius, y + radius) && level.open(x + radius, y + radius);
  }
  const previousX = actor.x, previousY = actor.y;
  if (fits(actor.x + dx, actor.y)) actor.x += dx;
  if (fits(actor.x, actor.y + dy)) actor.y += dy;
  const distance = Math.hypot(actor.x - previousX, actor.y - previousY);
  if (distance > .001) {
    actor.artStride = (actor.artStride ?? 0) + distance * 11;
    actor.artPose = Math.sin(actor.artStride) > 0 ? 1 : 2;
  }
}

function canSee(from, to) {
  const dx = to.x - from.x, dy = to.y - from.y;
  if (dx === 0 && dy === 0) return true;
  return renderer.cast(level, from.x, from.y, dx, dy).distance >= 1;
}

function combatSight(from, to) {
  if (!canSee(from, to)) return false;
  const dx = to.x - from.x, dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  return !match.smokes.some(smoke => {
    if (smoke.fuse > 0) return false;
    const t = lengthSquared ?
      clamp(((smoke.x - from.x) * dx + (smoke.y - from.y) * dy) / lengthSquared, 0, 1) : 0;
    return Math.hypot(from.x + t * dx - smoke.x, from.y + t * dy - smoke.y) < smokeRadius;
  });
}

function throwSmoke(player) {
  if (!player.smoke || player.hp <= 0 || match.phase !== 'live') return;
  player.smoke = false;
  const dx = Math.cos(player.angle), dy = Math.sin(player.angle);
  const wall = renderer.cast(level, player.x, player.y, dx, dy).distance;
  const range = Math.max(0, Math.min(wall - .22, 5.7 + player.pitch * 5));
  const fuse = .72;
  match.smokes.push({x: player.x, y: player.y, vx: dx * range / fuse, vy: dy * range / fuse,
    fuse, elevation: .55, time: 13, radius: smokeRadius});
}

function updateSmokes(dt) {
  for (const smoke of match.smokes) {
    if (smoke.fuse <= 0) {
      smoke.time -= dt;
      continue;
    }
    const step = Math.min(dt, smoke.fuse);
    smoke.x += smoke.vx * step;
    smoke.y += smoke.vy * step;
    smoke.fuse -= step;
    const flight = 1 - smoke.fuse / .72;
    smoke.elevation = .55 * (1 - flight) + Math.sin(Math.PI * flight) * .7;
    if (!smoke.fuse) audio.play('scrape', .32);
  }
  match.smokes = match.smokes.filter(smoke => smoke.time > 0);
}

function findPath(from, to) {
  const {width, height} = level;
  const toIndex = (x, y) => Math.floor(y) * width + Math.floor(x);
  const start = toIndex(from.x, from.y);
  const end = toIndex(to.x, to.y);
  if (start === end) return [];
  const parents = new Int16Array(width * height).fill(-1);
  const queue = [start];
  parents[start] = start;
  for (let i = 0; i < queue.length && parents[end] === -1; i++) {
    const cell = queue[i];
    const x = cell % width, y = Math.floor(cell / width);
    for (const [dx, dy] of routeDirections) {
      if (!level.open(x + dx, y + dy)) continue;
      const next = toIndex(x + dx, y + dy);
      if (parents[next] !== -1) continue;
      parents[next] = cell;
      queue.push(next);
    }
  }
  if (parents[end] === -1) return [];
  const path = [];
  for (let cell = end; cell !== start; cell = parents[cell]) {
    path.push({x: cell % width + .5, y: Math.floor(cell / width) + .5});
  }
  return path.reverse();
}

function navigate(bot, goal, speed, dt) {
  const key = goal.x + ',' + goal.y;
  if (bot.routeKey !== key) {
    bot.routeKey = key;
    bot.path = findPath(bot, goal);
    if (bot.path.length) {
      bot.path.unshift({x: Math.floor(bot.x) + .5, y: Math.floor(bot.y) + .5});
    }
  }
  while (bot.path.length && gap(bot, bot.path[0]) < .075) bot.path.shift();
  const waypoint = bot.path[0] ?? goal;
  const distance = gap(bot, waypoint);
  if (distance < .03) return;
  bot.angle = direction(bot, waypoint);
  const step = Math.min(distance, speed * dt);
  walk(bot, Math.cos(bot.angle) * step, Math.sin(bot.angle) * step);
}

function damage(target, amount, source) {
  if (target.armor > 0) {
    const absorbed = Math.min(target.armor, Math.floor(amount * .45));
    target.armor -= absorbed;
    amount -= absorbed;
  }
  target.hp = Math.max(0, target.hp - amount);
  if (target === match.player) match.hurt = .8;
  else if (!target.target) target.angle = direction(target, source);
  if (target.hp > 0) return;
  if (match.device.carrier === target) dropDevice(target);
  const line = document.createElement('p');
  line.textContent = source.name + ' ▸ ' + target.name;
  ui.feed.prepend(line);
  if (ui.feed.children.length > 3) ui.feed.lastElementChild.remove();
  source.credits = Math.min(16000, source.credits + 300);
}

function reload(player) {
  const weapon = weapons[player.weapon];
  const ammo = player.ammo[player.weapon];
  if (!player.reload && ammo.magazine < weapon.capacity && ammo.reserve > 0) {
    player.reload = weapon.reload;
  }
}

function updateWeapon(actor, dt) {
  actor.cooldown = Math.max(0, actor.cooldown - dt);
  actor.flash = Math.max(0, actor.flash - dt);
  actor.artSmoke = Math.max(0, (actor.artSmoke ?? 0) - dt);
  actor.recoil = Math.max(0, actor.recoil - 1.7 * dt);
  if (actor.reload <= 0) return;
  actor.reload = Math.max(0, actor.reload - dt);
  if (actor.reload === 0) {
    const ammo = actor.ammo[actor.weapon];
    const added = Math.min(weapons[actor.weapon].capacity - ammo.magazine, ammo.reserve);
    ammo.magazine += added;
    ammo.reserve -= added;
  }
}

function operationImpact(point, material, volume) {
  const particles = match.combatFx.particles;
  const palette = impactColors[material];
  const ring = material === 'signal';
  particles.push({...point, life: ring ? .54 : .14, duration: ring ? .54 : .14,
    type: ring ? 'ring' : 'flash', size: ring ? .64 : .14, color: palette[0], dx: 0, dy: 0, dz: 0});
  for (let i = 0; i < (ring ? 16 : 8); i++) {
    const angle = combatFxRandom() * Math.PI * 2;
    const speed = .18 + combatFxRandom() * (material === 'metal' ? 1.7 : .85);
    const smoke = material !== 'metal' && !ring && i < 5;
    const duration = .14 + combatFxRandom() * .27;
    particles.push({...point, dx: Math.cos(angle) * speed, dy: Math.sin(angle) * speed,
      dz: .25 + combatFxRandom() * .7, life: duration, duration,
      type: smoke ? 'smoke' : 'spark', size: smoke ? .075 : .026, color: palette[i % palette.length]});
  }
  if (particles.length > 120) particles.splice(0, particles.length - 120);
  if (volume > 0) audio.play(ring ? 'complete' : material, volume);
}

function operationTrace(from, to, weapon, team, slot) {
  const traces = match.combatFx.traces;
  traces.push({from, to, weapon, team, slot, life: .09});
  if (traces.length > 20) traces.shift();
}

function updateCombatFx(dt) {
  const fx = match.combatFx;
  fx.traces = fx.traces.filter(trace => (trace.life -= dt) > 0);
  fx.particles = fx.particles.filter(particle => {
    const x = particle.x + particle.dx * dt, y = particle.y + particle.dy * dt;
    if (level.open(x, y)) {
      particle.x = x;
      particle.y = y;
    }
    particle.z = Math.max(.02, particle.z + particle.dz * dt);
    if (particle.type === 'spark') particle.dz -= 3 * dt;
    return (particle.life -= dt) > 0;
  });
}

function shoot(player) {
  if (player.cooldown || player.reload) return;
  const ammo = player.ammo[player.weapon];
  if (!ammo.magazine) {
    reload(player);
    return;
  }
  const weapon = weapons[player.weapon];
  ammo.magazine--;
  player.cooldown = weapon.cooldown;
  player.flash = .055;
  player.artSmoke = .17;
  const spread = weapon.spread + player.recoil * .068 + player.speed ** 2 * .009;
  const yaw = player.angle + (Math.random() - .5) * spread;
  const pitch = player.pitch + player.recoil * .034 + (Math.random() - .5) * spread;
  player.recoil = Math.min(1, player.recoil + .33);
  const dx = Math.cos(yaw), dy = Math.sin(yaw);
  const wall = renderer.cast(level, player.x, player.y, dx, dy);
  let nearest = wall.distance;
  let struck, headshot;
  for (const actor of match.bots) {
    if (actor.hp <= 0) continue;
    const x = actor.x - player.x, y = actor.y - player.y;
    const depth = x * dx + y * dy;
    const across = y * dx - x * dy;
    const height = player.eye + pitch * depth;
    const head = height > .79;
    if (depth <= .05 || depth >= nearest || height < .04 || height > .93 ||
        Math.abs(across) > (head ? .125 : .22)) continue;
    nearest = depth;
    struck = actor;
    headshot = head;
  }
  audio.play(player.weapon, .73);
  const floor = pitch < 0 ? -player.eye / pitch : Infinity;
  const depth = struck ? nearest : Math.max(.05, Math.min(floor, nearest) - .026);
  const point = {x: player.x + dx * depth, y: player.y + dy * depth, z: Math.max(.02, player.eye + pitch * depth)};
  operationTrace({x: player.x, y: player.y, z: player.eye - .07}, point, player.weapon, player.team, player.slot);
  if (struck) operationImpact(point, 'actor', .42);
  else if (floor < nearest) operationImpact(point, 'dirt', .34);
  else if (point.z < (wall.tile === 'C' ? .96 : 1.18)) {
    operationImpact(point, 'CRB'.includes(wall.tile) ? 'metal' : 'stone', .42);
  }
  if (struck && struck.team !== player.team) {
    damage(struck, Math.round(weapon.damage * (headshot ? 2.4 : 1)), player);
    match.hit = .16;
  }
}

function updatePlayer(dt, live) {
  const player = match.player;
  if (player.hp <= 0) return;
  updateWeapon(player, dt);
  look((Number(keys.has('ArrowRight')) - Number(keys.has('ArrowLeft'))) * dt * 1.8,
    (Number(keys.has('ArrowUp')) - Number(keys.has('ArrowDown'))) * dt * 1.15);
  if (!live) return;
  const forward = Number(keys.has('KeyW')) - Number(keys.has('KeyS'));
  const side = Number(keys.has('KeyD')) - Number(keys.has('KeyA'));
  const length = Math.hypot(forward, side);
  const slow = keys.has('ShiftLeft') || keys.has('ShiftRight');
  const crouching = keys.has('KeyC');
  const eye = crouching ? .36 : .54;
  player.eye += (eye - player.eye) * Math.min(1, dt * 14);
  const topSpeed = crouching ? 1.15 : slow ? 1.68 : player.weapon === 'rifle' ? 3.15 : 3.55;
  const targetSpeed = length ? topSpeed : 0;
  player.speed += clamp(targetSpeed - player.speed, -dt * 25, dt * 15);
  if (length) player.moveAngle = player.angle + Math.atan2(side, forward);
  if (player.speed > 0) {
    walk(player, Math.cos(player.moveAngle) * player.speed * dt, Math.sin(player.moveAngle) * player.speed * dt);
    player.stride += player.speed * dt * 3;
  }
  if ((mouseFire || keys.has('Fire')) && !(keys.has('KeyE') && actionAt(player))) shoot(player);
}

function nearbyCover(site, team, slot) {
  const [dx, dy] = coverOffsets[slot];
  const x = site.x + (team === 0 ? -dx : dx);
  const y = site.y + dy;
  return level.open(x, y) ? {x, y} : {x, y: site.y};
}

function nearestActor(actors, point) {
  return actors.reduce((nearest, actor) => !nearest || gap(actor, point) < gap(nearest, point) ? actor : nearest, null);
}

function botGoal(bot) {
  const device = match.device;
  const attacking = bot.team === match.attacker;
  if (device.site) {
    return attacking ? nearbyCover(device.site, 1 - bot.team, bot.slot) : device.site;
  }
  if (attacking) {
    if (device.dropped && nearestActor(match.bots.filter(actor => actor.hp > 0 && actor.team === bot.team), device.dropped) === bot) {
      return device.dropped;
    }
    if (bot === device.carrier) return device.plannedSite;
    const site = device.plannedSite;
    if ((bot.slot === 2 || bot.slot === 4) && bot.flank !== site.id) {
      const flank = {x: bot.team === 0 ? 9.5 : 17.5, y: site.id === 'B' ? 2.5 : bot.slot === 2 ? 13.5 : 15.5};
      if (gap(bot, flank) > .5) return flank;
      bot.flank = site.id;
    }
    return nearbyCover(site, bot.team, bot.slot);
  }
  const site = level.sites[(bot.slot + match.round) % level.sites.length];
  return nearbyCover(site, bot.team, bot.slot);
}

function updateBot(bot, dt) {
  if (bot.hp <= 0) return;
  bot.artPose = 0;
  updateWeapon(bot, dt);
  let target = null;
  let distance = 10.5;
  for (const actor of match.actors) {
    if (actor.hp <= 0 || actor.team === bot.team) continue;
    const range = gap(bot, actor);
    if (range >= distance || !combatSight(bot, actor)) continue;
    if (actor !== bot.target && range > 2.4 && Math.abs(wrapAngle(direction(bot, actor) - bot.angle)) > 1.65) continue;
    target = actor;
    distance = range;
  }
  if (bot.target !== target) {
    bot.target = target;
    bot.aimTime = .24 + Math.random() * .32;
  }
  const goal = botGoal(bot);
  if (match.action?.actor === bot && botCanOperate(bot)) return;
  if (!target) {
    navigate(bot, goal, 2.15 + bot.slot * .14, dt);
    if (gap(bot, goal) < .13) {
      bot.angle = direction(bot, {x: teamSpawns[1 - bot.team][0], y: goal.y});
    }
    return;
  }
  bot.aimTime -= dt;
  const advancing = match.device.site ? bot.team !== match.attacker : bot.team === match.attacker;
  if (advancing && distance > 5.5) navigate(bot, goal, 1.55, dt);
  bot.angle = direction(bot, target);
  if (bot.smoke && advancing && distance > 4 && distance < 8 && combatSight(bot, target)) {
    throwSmoke(bot);
    bot.cooldown = .45;
    return;
  }
  if (bot.aimTime > 0 || bot.cooldown > 0 || bot.reload > 0 || !combatSight(bot, target)) return;
  const weapon = weapons[bot.weapon];
  const ammo = bot.ammo[bot.weapon];
  if (!ammo.magazine) {
    if (ammo.reserve > 0) reload(bot);
    else selectWeapon(bot, 'pistol');
    return;
  }
  ammo.magazine--;
  bot.flash = .055;
  bot.cooldown = .32 + Math.random() * .3;
  const towardPlayer = gap(bot, match.player);
  if (towardPlayer < 15) audio.play(bot.weapon, clamp(1 - towardPlayer / 17, .08, .48));
  const running = target.speed > 2;
  const hit = Math.random() < .68 - distance * .033 - (running ? .12 : 0);
  if (hit) {
    damage(target, Math.round(weapon.damage * (.46 + Math.random() * .4)), bot);
  }
  const from = {x: bot.x, y: bot.y, z: bot.eye};
  if (hit) {
    const point = {x: target.x, y: target.y, z: target.eye * .78};
    operationTrace(from, point, bot.weapon, bot.team, bot.slot);
    if (target !== match.player) operationImpact(point, 'actor', towardPlayer < 8 ? .21 : 0);
  } else {
    const angle = bot.angle + (combatFxRandom() < .5 ? -.08 : .08);
    const dx = Math.cos(angle), dy = Math.sin(angle);
    const wall = renderer.cast(level, bot.x, bot.y, dx, dy);
    const range = Math.min(wall.distance - .026, distance + 1.4);
    const point = {x: bot.x + dx * range, y: bot.y + dy * range, z: target.eye};
    operationTrace(from, point, bot.weapon, bot.team, bot.slot);
    if (range < distance + 1.4) {
      operationImpact(point, 'CRB'.includes(wall.tile) ? 'metal' : 'stone', towardPlayer < 8 ? .17 : 0);
    }
  }
}

function dropDevice(actor, byChoice = false) {
  match.device.carrier = null;
  match.device.dropped = {x: actor.x, y: actor.y, team: actor.team, ignore: byChoice ? actor : null, delay: .8};
}

function actionAt(actor) {
  const {carrier, site} = match.device;
  if (actor.hp <= 0) return null;
  const near = point => gap(actor, point) <= 1.05 && canSee(actor, point);
  if (site) return actor.team !== match.attacker && near(site) ? site : null;
  return actor === carrier ? level.sites.find(near) ?? null : null;
}

function botCanOperate(bot) {
  if (!actionAt(bot)) return false;
  if (!bot.target || match.time < 12 || (match.action?.actor === bot && match.progress > .65)) return true;
  return gap(bot, bot.target) > 3.5 && match.actors.some(ally =>
    ally !== bot && ally.team === bot.team && ally.hp > 0 && gap(bot, ally) < 4);
}

function updateDevice(dt) {
  const {device, player} = match;
  if (device.dropped) {
    const drop = device.dropped;
    drop.delay -= dt;
    const eligible = match.actors.filter(actor => actor.team === match.attacker && actor.hp > 0 &&
      (actor !== drop.ignore || drop.delay <= 0) && gap(actor, drop) < .65 && canSee(actor, drop));
    const carrier = nearestActor(eligible, drop);
    if (carrier) {
      device.carrier = carrier;
      device.dropped = null;
    }
  }

  const playerSite = keys.has('KeyE') && actionAt(player);
  const current = match.action?.actor;
  const actor = playerSite ? player :
    current && current !== player && botCanOperate(current) ? current : match.bots.find(botCanOperate);
  const site = actor && actionAt(actor);
  if (current !== actor || match.action?.site !== site) match.progress = 0;
  match.action = actor ? {actor, site} : null;
  if (!actor) return;
  const duration = device.site ? defuseSeconds / (actor.kit ? 2 : 1) : plantSeconds;
  match.progress += dt / duration;
  if (match.progress < 1) return;
  match.progress = 0;
  audio.play('boost', .5);
  if (device.site) {
    finishRound(1 - match.attacker, 'dispositivo desarmado em ' + site.id);
  } else {
    device.site = site;
    device.carrier = null;
    match.time = activeSeconds;
    match.action = null;
  }
}

const living = team => match.actors.filter(actor => actor.team === team && actor.hp > 0).length;

function update(dt) {
  if (!match || paused || shopping || match.phase === 'done') return;
  updateCombatFx(dt);
  if (match.phase === 'result') {
    match.time -= dt;
    if (match.time > 0) return;
    if (match.scores.includes(winsToFinish) || match.round === roleSwapAfter * 2) finishMatch();
    else beginRound();
    return;
  }
  match.time = Math.max(0, match.time - dt);
  if (match.phase === 'buy') {
    updatePlayer(dt, false);
    if (match.time === 0) {
      match.phase = 'live';
      match.time = roundSeconds;
    }
    return;
  }
  match.hit = Math.max(0, match.hit - dt);
  match.hurt = Math.max(0, match.hurt - dt * 2.8);
  if (match.smokes.length) updateSmokes(dt);
  if (match.device.carrier === match.player) {
    const site = match.player.y < 7 ? level.sites[1] : level.sites[0];
    if (match.player.x > 4.3) match.device.plannedSite = site;
  }
  updatePlayer(dt, true);
  for (const bot of match.bots) updateBot(bot, dt);

  const defenders = 1 - match.attacker;
  if (!living(defenders)) {
    finishRound(match.attacker, 'defesa eliminada');
    return;
  }
  const site = match.device.site;
  if (!site && !living(match.attacker)) {
    finishRound(defenders, 'ataque eliminado');
    return;
  }
  if (match.time <= 0) {
    if (site) operationImpact({...site, z: .53}, 'signal', .68);
    finishRound(site ? match.attacker : defenders, site ? 'transmissão concluída em ' + site.id : 'tempo esgotado');
    return;
  }
  if (site) {
    match.pulse -= dt;
    if (match.pulse <= 0) {
      match.pulse = clamp(match.time / 18, .16, 1.5);
      audio.play('signal', clamp(1 - gap(match.player, site) / 30, .22, .85));
    }
  }
  updateDevice(dt);
}

function setText(id, value) {
  const text = String(value);
  if (ui[id].textContent !== text) ui[id].textContent = text;
}

function updateHud() {
  if (!match || match.phase === 'done') return;
  const {player, phase, time, attacker, device} = match;
  const attacking = attacker === 0;
  setText('allies-score', match.scores[0]);
  setText('rivals-score', match.scores[1]);
  setText('allies-alive', living(0) + ' em campo');
  setText('rivals-alive', living(1) + ' em campo');
  setText('round-number', 'RODADA ' + match.round);
  const seconds = Math.ceil(Math.max(0, time));
  setText('timer', phase === 'result' ? '—' : Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0'));
  setText('role', attacking ? 'ATAQUE' : 'DEFESA');
  let objective = 'Defenda os pontos A e B';
  if (attacking) {
    objective = device.carrier === player ? 'Você leva o dispositivo · Instale em A ou B'
      : device.dropped ? 'Recupere o dispositivo no radar' : 'Escolte ' + device.carrier?.name;
  }
  if (device.site) objective = (attacking ? 'Proteja o dispositivo em ' : 'Desarme o dispositivo em ') + device.site.id;
  if (phase === 'buy') objective = match.round === roleSwapAfter + 1 ? 'Troca de lados · Equipamento' : 'Fase de compra';
  if (phase === 'result') objective = match.result;
  setText('objective', objective);
  ui.objective.classList.toggle('armed', Boolean(device.site) && phase === 'live');
  setText('health', player.hp);
  setText('armor', player.armor);
  setText('credits', formatCredits(player.credits));
  setText('weapon', weapons[player.weapon].name.toUpperCase());
  ui.utility.hidden = !player.smoke;
  touchSmoke.hidden = !player.smoke;
  touchSwap.disabled = !player.primary;
  const ammo = player.ammo[player.weapon];
  setText('magazine', ammo.magazine);
  setText('reserve', '/ ' + ammo.reserve);
  ui['buy-hint'].hidden = phase !== 'buy' || shopping || paused;
  ui.crosshair.hidden = player.hp <= 0;
  ui.crosshair.classList.toggle('hit', match.hit > 0);
  ui.crosshair.style.setProperty('--crosshair-span', 17 + Math.round(player.speed * 3.1 + player.recoil * 9) + 'px');
  ui.touch.hidden = paused || shopping || phase !== 'live' || player.hp <= 0;

  let feedback = '';
  if (phase === 'live') {
    if (player.hp <= 0) feedback = 'Eliminado · acompanhando a rodada';
    else if (match.action?.actor === player) feedback = (device.site ? 'Desarmando' : 'Instalando') + ' · ' + Math.floor(match.progress * 100) + '%';
    else if (actionAt(player)) feedback = (touchDevice.matches ? 'Segure Operar' : 'Segure E') + (device.site ? ' para desarmar' : ' para instalar');
    else if (player.reload > 0) feedback = 'Recarregando…';
  }
  ui.feedback.hidden = !feedback;
  setText('feedback', feedback);
}

function updateShop() {
  const player = match.player;
  setText('shop-credits', formatCredits(player.credits) + ' créditos');
  for (const button of shopItems) {
    const id = button.dataset.buy;
    const price = id === 'vest' ? vestCost : id === 'kit' ? kitCost : id === 'smoke' ? smokeCost : weapons[id].price;
    const unavailable = id === 'vest' ? player.armor === 100 :
      id === 'kit' ? player.kit || player.team === match.attacker :
      id === 'smoke' ? player.smoke : player.primary === id;
    button.disabled = player.credits < price || unavailable;
  }
}

function buy(id) {
  if (!shopping || match.phase !== 'buy') return;
  const button = shopItems.find(item => item.dataset.buy === id);
  if (!button || button.disabled) return;
  if (id === 'vest') {
    match.player.armor = 100;
    match.player.credits -= vestCost;
  } else if (id === 'kit') {
    match.player.kit = true;
    match.player.credits -= kitCost;
  } else if (id === 'smoke') {
    match.player.smoke = true;
    match.player.credits -= smokeCost;
  } else {
    arm(match.player, id);
    match.player.credits -= weapons[id].price;
  }
  updateShop();
  updateHud();
}

function toggleShop() {
  if (!match || match.phase !== 'buy' || paused) return;
  shopping = !shopping;
  ui.shop.hidden = !shopping;
  clearInput();
  if (shopping) {
    releasePointer();
    updateShop();
    ui['close-shop'].focus();
  } else {
    capturePointer();
  }
  updateHud();
}

function clearInput() {
  keys.clear();
  mouseFire = false;
  touchLook = null;
}

function capturePointer() {
  canvas.focus({preventScroll: true});
  if (touchDevice.matches || document.pointerLockElement === canvas) return;
  try {
    canvas.requestPointerLock?.()?.catch(() => {});
  } catch {
    // Dragging the mouse and the arrow keys also control the camera.
  }
}

function releasePointer() {
  pointerWasLocked = false;
  if (document.pointerLockElement === canvas) document.exitPointerLock();
}

function setPaused(value) {
  if (!match || match.phase === 'done' || shopping || paused === value) return;
  paused = value;
  clearInput();
  ui['pause-operation'].textContent = paused ? 'Retomar' : 'Pausar';
  if (paused) {
    releasePointer();
    audio.setPlaying(false);
    showOverlay('OPERAÇÃO FAROL', 'Pausa', 'A rodada continua quando você voltar.', 'Continuar');
  } else {
    ui.overlay.hidden = true;
    audio.setPlaying(true);
    capturePointer();
  }
  updateHud();
}

function look(yaw, pitch) {
  if (!match || paused || shopping || match.player.hp <= 0 || !['buy', 'live'].includes(match.phase)) return;
  match.player.angle = wrapAngle(match.player.angle + yaw);
  match.player.pitch = clamp(match.player.pitch + pitch, -.35, .35);
}

ui['play-operation'].addEventListener('click', () => paused ? setPaused(false) : startMatch());
ui['pause-operation'].addEventListener('click', () => setPaused(!paused));
function toggleOperationSound() {
  const button = ui['sound-operation'];
  const muted = button.getAttribute('aria-pressed') !== 'true';
  button.setAttribute('aria-pressed', String(muted));
  button.setAttribute('aria-label', muted ? 'Ativar som' : 'Silenciar');
  button.textContent = muted ? '×♪' : '♪';
  audio.setMuted(muted);
}
ui['sound-operation'].addEventListener('click', toggleOperationSound);
ui['shop-button'].addEventListener('click', toggleShop);
ui['close-shop'].addEventListener('click', toggleShop);
for (const button of shopItems) button.addEventListener('click', () => buy(button.dataset.buy));

const buyShortcuts = {'Digit1': 'smg', 'Digit2': 'rifle', 'Digit3': 'vest', 'Digit4': 'kit', 'Digit5': 'smoke'};
const controls = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyB', 'KeyR', 'KeyE', 'KeyC', 'KeyG', 'KeyQ', 'KeyM',
  'ShiftLeft', 'ShiftRight', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Escape', 'Space',
  ...Object.keys(buyShortcuts)]);
document.addEventListener('keydown', event => {
  if (!match || match.phase === 'done' || !controls.has(event.code) || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.code === 'Space' && (shopping || paused || event.target.matches('button, a'))) return;
  event.preventDefault();
  if (event.code === 'KeyM') {
    if (!event.repeat) toggleOperationSound();
    return;
  }
  if (event.code === 'Escape' && !event.repeat) {
    if (shopping) toggleShop();
    else setPaused(!paused);
    return;
  }
  if (event.code === 'KeyB' && !event.repeat) toggleShop();
  if (shopping) {
    const item = buyShortcuts[event.code];
    if (item && !event.repeat) buy(item);
    return;
  }
  if (paused) return;
  const player = match.player;
  if (!event.repeat && player.hp > 0) {
    if (event.code === 'KeyR') reload(player);
    if (event.code === 'KeyQ') throwSmoke(player);
    if (event.code === 'Digit1') selectWeapon(player, player.primary);
    if (event.code === 'Digit2') selectWeapon(player, 'pistol');
    if (event.code === 'KeyG' && match.phase === 'live' && match.device.carrier === player) dropDevice(player, true);
  }
  if (!event.repeat && event.code === 'Space' && player.hp <= 0) match.spectator++;
  keys.add(event.code === 'Space' ? 'Fire' : event.code);
});
document.addEventListener('keyup', event => keys.delete(event.code === 'Space' ? 'Fire' : event.code));
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === canvas) {
    if (!match || paused || shopping || match.phase === 'done') releasePointer();
    else pointerWasLocked = true;
  } else if (pointerWasLocked) {
    setPaused(true);
  }
});
document.addEventListener('visibilitychange', () => { if (document.hidden) setPaused(true); });
window.addEventListener('blur', clearInput);

canvas.addEventListener('pointerdown', event => {
  if (!match || paused || shopping || match.phase === 'done') return;
  if (event.pointerType === 'touch') {
    if (touchLook) return;
    touchLook = {id: event.pointerId, x: event.clientX, y: event.clientY};
    canvas.setPointerCapture(event.pointerId);
  } else if (event.button === 0) {
    if (match.player.hp <= 0) match.spectator++;
    else mouseFire = true;
    capturePointer();
  }
});
document.addEventListener('pointerup', event => {
  if (event.pointerType !== 'touch' && event.button === 0) mouseFire = false;
});
canvas.addEventListener('lostpointercapture', event => {
  if (touchLook?.id === event.pointerId) touchLook = null;
});
document.addEventListener('pointermove', event => {
  if (event.pointerType === 'touch') {
    if (touchLook?.id !== event.pointerId) return;
    look((event.clientX - touchLook.x) * .009, (touchLook.y - event.clientY) * .006);
    touchLook.x = event.clientX;
    touchLook.y = event.clientY;
  } else if (document.pointerLockElement === canvas || mouseFire) {
    look(event.movementX * .0027, -event.movementY * .0023);
  }
});

for (const button of ui.touch.querySelectorAll('[data-key]')) {
  const code = button.dataset.key;
  button.addEventListener('pointerdown', event => {
    if (code === 'KeyR') reload(match.player);
    else if (code === 'KeyQ') throwSmoke(match.player);
    else if (code === 'Swap') {
      const player = match.player;
      selectWeapon(player, player.weapon === 'pistol' ? player.primary : 'pistol');
    }
    else keys.add(code);
    button.setPointerCapture(event.pointerId);
  });
  button.addEventListener('lostpointercapture', () => keys.delete(code));
}

let previousTime = 0;
let nextHud = 0;
function frame(now) {
  const dt = Math.min(.045, (now - (previousTime || now)) / 1000);
  previousTime = now;
  update(dt);
  const actors = match?.actors ?? [];
  const player = match?.player;
  const teammates = player?.hp <= 0 ? actors.filter(actor => actor.team === 0 && actor.hp > 0) : [];
  const spectator = teammates[match?.spectator % teammates.length];
  const view = spectator || player || preview;
  renderer.draw(level, view, actors, match?.device, match?.smokes, view === player && player.hp > 0,
    match?.hurt, match?.combatFx);
  if (match && now >= nextHud) {
    updateHud();
    renderer.drawRadar(level, view, actors, match.device, combatSight);
    nextHud = now + 75;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
