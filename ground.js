const PILOT_EYE_HEIGHT = 12;
const PILOT_MAP_ZOOM = 1.25;
const PILOT_CAMERAS = ['3ª PESSOA', '1ª PESSOA', 'VISTA SUPERIOR'];
const PISTOL_CAPACITY = 12;

function createPilotControls(yaw) {
  return {yaw, pitch: 0, camera: 1, dx: 0, dy: 0, eyeHeight: PILOT_EYE_HEIGHT,
    health: 100, magazine: PISTOL_CAPACITY, reserve: 36, reload: 0, cooldown: 0, recoil: 0,
    spread: .009, hit: 0};
}

function createGroundMission(world, player, controls) {
  const cellCount = world.ocean.length;
  const queue = new Int32Array(cellCount);
  const rescueRoute = new Int32Array(cellCount);
  const pursuitRoute = new Int32Array(cellCount);
  const directions = [-1, 1, -MAP_SIZE, MAP_SIZE];
  const start = world.index(player.x, player.y);

  function neighbor(cell, direction) {
    if (direction === -1 && cell % MAP_SIZE === 0) return cell + MAP_SIZE - 1;
    if (direction === 1 && cell % MAP_SIZE === MAP_SIZE - 1) return cell - MAP_SIZE + 1;
    return (cell + direction + cellCount) % cellCount;
  }

  function position(cell) {
    return {x: (cell % MAP_SIZE + .5) * MAP_SCALE,
      y: (Math.floor(cell / MAP_SIZE) + .5) * MAP_SCALE, z: world.height[cell]};
  }

  function flood(origin, route, blocked) {
    route.fill(-1);
    route[origin] = 0;
    queue[0] = origin;
    let count = 1;
    for (let read = 0; read < count; read++) {
      const cell = queue[read];
      for (const direction of directions) {
        const next = neighbor(cell, direction);
        if (world.ocean[next] || blocked?.has(next) || route[next] !== -1) continue;
        route[next] = route[cell] + 1;
        queue[count++] = next;
      }
    }
    return count;
  }

  const islandSize = flood(start, rescueRoute);
  const coast = [];
  let landingCell = start, landingScore = Infinity;
  for (let i = 0; i < islandSize; i++) {
    const cell = queue[i];
    const adjacent = directions.map(direction => neighbor(cell, direction));
    const relief = Math.max(...adjacent.map(next => Math.abs(world.height[next] - world.height[cell])));
    const shore = adjacent.some(next => world.ocean[next]);
    if (shore) coast.push(cell);
    const score = Math.abs(rescueRoute[cell] * MAP_SCALE - 460) + relief * 25 + (shore ? 90 : 0);
    if (score >= landingScore) continue;
    landingCell = cell;
    landingScore = score;
  }

  // Choose a coastal landing with a clear approach from the sea.
  let patrol, patrolScore = Infinity;
  for (const cell of coast) {
    const landing = position(cell);
    for (const direction of directions) {
      const sea = neighbor(cell, direction);
      if (!world.ocean[sea]) continue;
      const near = position(sea);
      const dx = delta(near.x, landing.x), dy = delta(near.y, landing.y);
      const score = Math.abs(rescueRoute[cell] * MAP_SCALE - 210);
      if (score >= patrolScore) continue;
      let length = 1;
      while (length < 30 && world.ocean[world.index(near.x + dx * length, near.y + dy * length)]) length++;
      if (length < 15) continue;
      patrolScore = score;
      patrol = {landing, dock: {...near}, x: wrap(near.x + dx * (length - 1)),
        y: wrap(near.y + dy * (length - 1)), z: 0, landed: false};
    }
  }
  if (!patrol && coast.length) {
    const cell = coast[0];
    const landing = position(cell);
    const sea = directions.map(direction => neighbor(cell, direction)).find(next => world.ocean[next]);
    const dock = position(sea);
    patrol = {landing, dock, ...dock, landed: false};
  }

  flood(landingCell, rescueRoute);
  const distance = (a, b) => Math.hypot(delta(a.x, b.x), delta(a.y, b.y));
  let pursuitTarget = -1;
  let pursuitIn = 0;

  function coastNear(point) {
    let best = Infinity, closest = landingCell;
    for (const cell of coast) {
      const gap = distance(position(cell), point);
      if (gap >= best) continue;
      best = gap;
      closest = cell;
    }
    return closest;
  }

  function nextCell(cell, route) {
    let best = cell;
    for (const direction of directions) {
      const next = neighbor(cell, direction);
      if (route[next] >= 0 && route[next] < route[best]) best = next;
    }
    return best;
  }

  function rescueWaypoint(cell) {
    const next = nextCell(cell, rescueRoute);
    const direction = directions.find(offset => neighbor(cell, offset) === next);
    if (!direction) return position(cell);
    let waypoint = next;
    for (let i = 0; i < 4; i++) {
      const further = neighbor(waypoint, direction);
      if (rescueRoute[further] !== rescueRoute[waypoint] - 1 || rescueRoute[further] < 0) break;
      waypoint = further;
    }
    return position(waypoint);
  }

  const corridor = [];
  for (let cell = start; cell !== landingCell; cell = nextCell(cell, rescueRoute)) corridor.push(position(cell));
  corridor.push(position(landingCell));
  const rocks = [];
  for (const [i, fraction] of [.22, .37, .54, .7, .83].entries()) {
    const index = Math.floor((corridor.length - 1) * fraction);
    const point = corridor[index];
    const ahead = corridor[Math.min(index + 3, corridor.length - 1)];
    const yaw = Math.atan2(delta(ahead.x, point.x), -delta(ahead.y, point.y));
    const first = yaw + (i % 2 ? Math.PI : 0);
    const radius = 7 + i % 3;
    let best = null;
    let bestScore = Infinity;
    for (const offset of [18, 25, 34]) {
      for (let turn = 0; turn < 8; turn++) {
        const angle = first + turn * Math.PI / 4;
        const x = wrap(point.x + Math.cos(angle) * offset);
        const y = wrap(point.y + Math.sin(angle) * offset);
        const z = world.groundHeight(x, y);
        const rock = {x, y, z, radius, height: 16 + i % 3 * 2};
        if (rescueRoute[world.index(x, y)] < 0 || corridor.some(step => distance(step, rock) < radius + 6) ||
            rocks.some(other => distance(other, rock) < 26)) continue;
        const relief = Math.max(...directions.map((_, side) => Math.abs(z -
          world.groundHeight(x + Math.cos(side * Math.PI / 2) * radius, y + Math.sin(side * Math.PI / 2) * radius))));
        const score = offset + relief * 2 + turn * .7;
        if (score >= bestScore) continue;
        best = rock;
        bestScore = score;
      }
    }
    if (best) rocks.push(best);
  }
  const blocked = new Set();
  for (const rock of rocks) {
    const extent = Math.ceil((rock.radius + 3) / MAP_SCALE);
    for (let dy = -extent; dy <= extent; dy++) {
      for (let dx = -extent; dx <= extent; dx++) {
        const cell = world.index(rock.x + dx * MAP_SCALE, rock.y + dy * MAP_SCALE);
        if (distance(position(cell), rock) < rock.radius + 2) blocked.add(cell);
      }
    }
  }

  function takeCover(soldier, pilot) {
    let nearest = 58;
    let shelter = null;
    for (const rock of rocks) {
      const gap = distance(rock, pilot);
      if (gap < 1) continue;
      const offset = rock.radius + 4;
      const x = wrap(rock.x + delta(rock.x, pilot.x) * offset / gap);
      const y = wrap(rock.y + delta(rock.y, pilot.y) * offset / gap);
      const range = distance(soldier, {x, y});
      if (range >= nearest || rescueRoute[world.index(x, y)] < 0) continue;
      const z = world.groundHeight(x, y);
      if (trace({...soldier, z: soldier.z + 5}, {x, y, z: z + 5})) continue;
      nearest = range;
      shelter = {x, y, z};
    }
    return shelter;
  }

  function trace(from, to, targets = []) {
    const dx = delta(to.x, from.x), dy = delta(to.y, from.y), dz = to.z - from.z;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy, dz) / 2));
    for (let i = 1; i <= steps; i++) {
      const x = wrap(from.x + dx * i / steps), y = wrap(from.y + dy * i / steps);
      const z = from.z + dz * i / steps;
      const impact = {x, y, z};
      const height = world.groundHeight(x, y);
      if (z <= height || rocks.some(rock => z >= rock.z - 3 && z <= rock.z + rock.height &&
          distance(rock, impact) < rock.radius)) {
        return {point: impact};
      }
      const hit = targets.find(soldier => soldier.delay <= 0 && soldier.hp > 0 &&
        z >= soldier.z && z <= soldier.z + 18 && distance(soldier, impact) < (z > soldier.z + 13 ? 3 : 5));
      if (hit) return {point: impact, hit};
    }
    return null;
  }

  const mission = {
    elapsed: 0, rocks, tracers: [],
    rescue: position(landingCell), ship: null, soldiers: [], bearing: 0, distance: 0,
    get rescueIn() { return Math.max(0, 40 - this.elapsed); },
    blocks(point, radius = 2) {
      return rocks.some(rock => distance(point, rock) < rock.radius + radius);
    },
    update(dt, pilot, walking) {
      this.elapsed += dt;
      this.tracers = this.tracers.filter(shot => (shot.life -= dt) > 0);
      const cell = world.index(pilot.x, pilot.y);
      const onIsland = rescueRoute[cell] >= 0;
      const entry = onIsland ? cell : coastNear(pilot);
      const waypoint = onIsland ? rescueWaypoint(entry) : position(entry);
      this.shore = walking ? null : position(entry);
      this.distance = rescueRoute[entry] * MAP_SCALE +
        (onIsland && entry !== landingCell ? 0 : distance(pilot, position(entry)));
      this.bearing = Math.atan2(delta(waypoint.x, pilot.x), -delta(waypoint.y, pilot.y));
      if (!this.rescueIn && walking && onIsland && distance(pilot, this.rescue) <= 13) return 'rescued';

      if (this.elapsed >= 20 && patrol) {
        this.ship = patrol;
        if (!patrol.landed) {
          const dx = delta(patrol.dock.x, patrol.x), dy = delta(patrol.dock.y, patrol.y);
          const gap = Math.hypot(dx, dy);
          const step = 48 * dt;
          if (gap > step) {
            patrol.x = wrap(patrol.x + dx / gap * step);
            patrol.y = wrap(patrol.y + dy / gap * step);
          } else {
            patrol.landed = true;
            Object.assign(patrol, patrol.dock);
            this.soldiers = [0, 1, 2].map(i => ({...patrol.landing, delay: i * .85, speed: 44 + i * 3,
              hp: 100, aimTime: 0, cooldown: .5, flash: 0, shelter: null, retreat: 0}));
          }
        }
      }
      if (!this.soldiers.length) return;
      pursuitIn -= dt;
      if (entry !== pursuitTarget && pursuitIn <= 0) {
        flood(entry, pursuitRoute, blocked);
        pursuitTarget = entry;
        pursuitIn = .2;
      }
      for (const soldier of this.soldiers) {
        if (soldier.hp <= 0) continue;
        soldier.delay -= dt;
        if (soldier.delay > 0) continue;
        soldier.cooldown = Math.max(0, soldier.cooldown - dt);
        soldier.flash = Math.max(0, soldier.flash - dt);
        soldier.retreat = Math.max(0, soldier.retreat - dt);
        if (!soldier.retreat) soldier.shelter = null;
        const muzzle = {x: soldier.x, y: soldier.y, z: soldier.z + 11};
        const targetBody = {x: pilot.x, y: pilot.y, z: pilot.z + controls.eyeHeight * .72};
        const range = distance(soldier, pilot);
        if (walking && onIsland && !soldier.shelter && range < 140 && !trace(muzzle, targetBody)) {
          soldier.artYaw = Math.atan2(delta(pilot.x, soldier.x), -delta(pilot.y, soldier.y));
          soldier.artPose = 0;
          soldier.aimTime += dt;
          if (soldier.aimTime >= .46 && !soldier.cooldown) {
            const accurate = Math.random() < clamp(.74 - range / 350 - pilot.speed / 330, .2, .73);
            const angle = Math.atan2(delta(targetBody.y, muzzle.y), delta(targetBody.x, muzzle.x));
            if (!accurate) {
              const miss = (Math.random() < .5 ? -1 : 1) * (6 + Math.random() * 9);
              targetBody.x = wrap(targetBody.x - Math.sin(angle) * miss);
              targetBody.y = wrap(targetBody.y + Math.cos(angle) * miss);
            }
            this.tracers.push({from: muzzle, to: trace(muzzle, targetBody)?.point ?? targetBody, life: .105});
            soldier.flash = .095;
            soldier.cooldown = .72 + Math.random() * .4;
            if (accurate) {
              controls.health = Math.max(0, controls.health - 18);
              controls.hit = .36;
              if (!controls.health) return 'pilotLost';
            }
            if (range < 65) {
              soldier.shelter = takeCover(soldier, pilot);
              soldier.retreat = 1.1;
            }
          }
          continue;
        }
        soldier.aimTime = 0;
        const current = world.index(soldier.x, soldier.y);
        const next = nextCell(current, pursuitRoute);
        const target = soldier.shelter ?? (next === current && walking && onIsland && current === cell ? pilot : position(next));
        const dx = delta(target.x, soldier.x), dy = delta(target.y, soldier.y);
        const gap = Math.hypot(dx, dy);
        const step = Math.min(gap, soldier.speed * dt);
        soldier.artPose = 0;
        if (gap > 0) {
          const x = wrap(soldier.x + dx / gap * step), y = wrap(soldier.y + dy / gap * step);
          if (!this.blocks({x, y}, 1) && !world.ocean[world.index(x, y)]) {
            soldier.x = x;
            soldier.y = y;
            soldier.artYaw = Math.atan2(dx, -dy);
            soldier.artStride = (soldier.artStride ?? 0) + step * .27;
            soldier.artPose = Math.sin(soldier.artStride) > 0 ? 1 : 2;
          }
          soldier.z = world.groundHeight(soldier.x, soldier.y);
        }
      }
    },
    aim(pilot, yaw = controls.yaw, pitch = controls.pitch) {
      const eye = {...pilot, z: pilot.z + controls.eyeHeight};
      const end = {x: wrap(eye.x + Math.sin(yaw) * 260), y: wrap(eye.y - Math.cos(yaw) * 260),
        z: eye.z + Math.tan(pitch) * 260};
      return trace(eye, end, this.soldiers) ?? {point: end};
    },
    fire(pilot) {
      const spread = controls.spread;
      const yaw = controls.yaw + (Math.random() - .5) * spread;
      const pitch = controls.pitch + controls.recoil * .021 + (Math.random() - .5) * spread;
      const {hit, point} = this.aim(pilot, yaw, pitch);
      if (!hit) return null;
      hit.hp = Math.max(0, hit.hp - (point.z - hit.z > 13 ? 100 : 37));
      hit.shelter = takeCover(hit, pilot);
      hit.retreat = 1.4;
      return point;
    }
  };
  return mission;
}
