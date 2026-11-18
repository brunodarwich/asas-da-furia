const WIDTH = 640;
const HEIGHT = 360;
const MID_X = WIDTH / 2;
const MID_Y = HEIGHT / 2;
const FOCAL = 297;
const PILOT_FOCAL = 368;

function createRenderer(canvas, world) {
  const ctx = canvas.getContext('2d', {alpha: false});
  ctx.imageSmoothingEnabled = false;
  const scene = surface(768, 480);
  const terrain = surface(384, 480);
  const terrainFrame = terrain.createImageData(384, 480);
  const terrainPixels = new Uint32Array(terrainFrame.data.buffer);
  const terrainDepth = new Float32Array(terrainPixels.length);
  const bottom = new Int16Array(384);
  // Índices do mapa para toda a faixa de amostragem, incluindo as bordas.
  const mapCoordinate = Uint16Array.from({length: 4096}, (_, i) => ((i - 2048) % MAP_SIZE + MAP_SIZE) % MAP_SIZE);
  const distances = [];
  for (let d = 16; d < 2150; d += 3 + d * .034) {
    distances.push({d, scale: FOCAL / d, clear: 1 - clamp((d - 210) / 1880, 0, .92)});
  }
  const pilotDistances = [];
  for (let d = 2; d < 160; d += .75 + d * .034) {
    pilotDistances.push({d, scale: FOCAL / d, clear: 1});
  }
  for (const sample of distances) {
    if (sample.d >= 160) pilotDistances.push(sample);
  }
  const layers = Object.fromEntries(Object.keys(AIRCRAFT_MODELS).map(model => [model, aircraftSlices(model)]));
  const sprites = new Map();
  const pilotArt = makeCharacterArt('pilot');
  const patrolArt = makeCharacterArt('patrol');
  const pilotPistol = makeHeldWeaponArt('pistol', true);
  const splash = pixelArt(72, 18, g => {
    paintedShape(g, '#274f5e', [[0,9],[14,4],[28,2],[64,4],[71,9],[57,14],[16,16]]);
    paintedShape(g, '#85b7b5', [[2,9],[14,6],[26,5],[23,7],[12,9],[23,12],[18,13],[8,12]]);
    paintedShape(g, '#c6d9cb', [[44,4],[59,5],[68,9],[57,12],[51,12],[61,9],[55,7]]);
    g.fillStyle = '#84b5ba';
    g.fillRect(28, 15, 18, 1);
  });

  function interpolate(ship, weight) {
    const before = ship.previousPose;
    if (!before) return ship;
    return {...ship,
      x: wrap(before.x + delta(ship.x, before.x) * weight),
      y: wrap(before.y + delta(ship.y, before.y) * weight),
      z: lerp(before.z, ship.z, weight),
      yaw: before.yaw + angleDelta(ship.yaw, before.yaw) * weight,
      pitch: lerp(before.pitch, ship.pitch, weight),
      roll: before.roll + angleDelta(ship.roll, before.roll) * weight
    };
  }

  function drawAircraft(target, ship, view, p) {
    const yaw = Math.round(angleDelta(ship.yaw, view.yaw) * 32 / Math.PI);
    const pitch = Math.round(ship.pitch * 9);
    const roll = Math.round(angleDelta(ship.roll, 0) * 9);
    const key = [ship.model, view.top, yaw, pitch, roll].join('/');
    if (!sprites.has(key)) {
      if (sprites.size >= 360) sprites.delete(sprites.keys().next().value);
      sprites.set(key, aircraftSprite(layers[ship.model], yaw * Math.PI / 32, pitch / 9, roll / 9, view.top));
    }
    const size = clamp(p.scale * (ship.model === 'falcao' ? 82 : 63), 7, 150);
    const left = Math.round(p.x - size / 2);
    const top = Math.round(p.y - size / 2);
    const width = Math.round(size);
    if (ship.boost) {
      const project = aircraftProjection(yaw * Math.PI / 32, pitch / 9, roll / 9, view.top);
      const scale = width / 54;
      for (const nozzle of [-5, 5]) {
        const start = project(nozzle, -18, 0, {});
        const end = project(nozzle, -27, 0, {});
        const length = Math.hypot(end.x - start.x, end.y - start.y) * scale;
        const glow = Math.max(1, 1.6 * scale);
        target.save();
        target.translate(left + (27.5 + start.x) * scale, top + (27.5 + start.y) * scale);
        target.rotate(Math.atan2(start.x - end.x, end.y - start.y));
        target.fillStyle = '#d15447';
        target.fillRect(-glow, -glow, glow * 2, glow + length);
        target.fillStyle = '#ffab52';
        target.fillRect(-glow * .65, 0, glow * 1.3, length * .78);
        target.fillStyle = '#fff4ca';
        target.fillRect(-glow * .35, 0, glow * .7, length * .48);
        target.restore();
      }
    }
    target.drawImage(sprites.get(key), left, top, width, width);
  }

  function camera(state) {
    const p = state.player;
    const pilot = state.pilot;
    const firstPerson = pilot?.camera === 1;
    const focal = firstPerson ? PILOT_FOCAL : FOCAL;
    const top = pilot ? pilot.camera === 2 : state.camera === 0;
    const chase = pilot ? pilot.camera === 0 : state.camera === 1;
    const yaw = top ? 0 : (pilot?.yaw ?? p.yaw);
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    const zoom = state.pilotMode ? PILOT_MAP_ZOOM : clamp(.79 - (p.z - 230) * .00045, .48, .89);
    const fallOffset = state.pilotMode === 'falling' ? 93 / zoom : 0;
    const setback = pilot ? (chase ? 58 : 0) : chase ? 124 : -8;
    const shake = state.shake > 0 && !reducedCombatMotion.matches ? state.shake / .18 * 3 : 0;
    const shakeX = Math.round(Math.sin(state.time * 150) * shake);
    const shakeY = Math.round(Math.cos(state.time * 119) * shake);
    const x = top ? p.x - shakeX / zoom : p.x - sin * setback;
    const y = top ? p.y - fallOffset - shakeY / zoom : p.y + cos * setback;
    let z = p.z + (chase ? 36 : 5);
    if (firstPerson) z = p.z + (state.pilotMode === 'swimming' ? 5 + Math.sin(state.time * 4) * .6 : pilot.eyeHeight);
    else if (pilot) z = Math.max(p.z + 29, world.groundHeight(x, y) + 12);
    const pitch = pilot ? pilot.pitch - (chase ? .10 : 0) : chase ? p.pitch * .63 - .22 : p.pitch;
    const horizon = 240 + Math.tan(pitch) * focal;
    const tilt = top ? 0 : -Math.sin(p.roll) * (chase ? .12 : .19);
    return {
      top, firstPerson, groundPerspective: Boolean(pilot) && !top, yaw, sin, cos, x, y, z, horizon, zoom, tilt,
      shakeX, shakeY,
      project(point) {
        const dx = delta(point.x, x), dy = delta(point.y, y);
        if (top) return {x: MID_X + dx * zoom, y: MID_Y + dy * zoom, scale: zoom, depth: -point.z};
        const depth = dx * sin - dy * cos;
        if (depth < 12) return null;
        const scale = focal / depth;
        return {x: 384 + (dx * cos + dy * sin) * scale, y: horizon + (z - point.z) * scale, scale, depth};
      }
    };
  }

  function drawTop(view, time) {
    const span = WORLD_SIZE * view.zoom;
    const left = MID_X - view.x * view.zoom;
    const top = MID_Y - view.y * view.zoom;
    for (let row = -1; row <= 1; row++) {
      for (let col = -1; col <= 1; col++) {
        const x = Math.round(left + col * span);
        const y = Math.round(top + row * span);
        if (x + span < 0 || x > WIDTH || y + span < 0 || y > HEIGHT) continue;
        ctx.drawImage(world.map, x, y, Math.ceil(span), Math.ceil(span));
      }
    }
    for (const cloud of world.clouds) {
      const w = cloud.size * view.zoom * 1.6;
      const p = view.project({x: cloud.x + cloud.z * .2 + time * CLOUD_WIND_X,
        y: cloud.y + cloud.z * .17 + time * CLOUD_WIND_Y, z: 0});
      if (p.x < -w || p.y < -w || p.x > WIDTH + w || p.y > HEIGHT + w) continue;
      ctx.globalAlpha = .48;
      ctx.drawImage(cloud.shadow, Math.round(p.x - w / 2), Math.round(p.y - w / 3), Math.round(w), Math.round(w * .68));
      ctx.globalAlpha = 1;
    }
    const drift = time * 4;
    for (const [x, y, phase] of world.spray) {
      const px = MID_X + delta(x + drift, view.x) * view.zoom;
      if (px < 0 || px > WIDTH) continue;
      const py = MID_Y + delta(y, view.y) * view.zoom;
      if (py < 0 || py > HEIGHT || !world.ocean[world.index(x + drift, y)]) continue;
      const light = Math.sin(time * 2.1 + phase * TAU + Math.sin(y * .028) * 2);
      ctx.fillStyle = light > .76 ? '#b5e4ec' : light > .1 ? '#75bcd9' : '#519ac5';
      ctx.fillRect(Math.round(px), Math.round(py), phase > .52 ? 3 : 1, 1);
      if (phase > .83) ctx.fillRect(Math.round(px + 1), Math.round(py - 1), 2, 1);
    }
  }

  function nearTerrainColor(wx, wy, index, shade, wave) {
    const {pixels, ocean, height} = world;
    const left = Math.floor(wx - .5), top = Math.floor(wy - .5);
    const fx = wx - .5 - left, fy = wy - .5 - top;
    const row = mapCoordinate[top] * MAP_SIZE;
    const nextRow = mapCoordinate[top + 1] * MAP_SIZE;
    const col = mapCoordinate[left], nextCol = mapCoordinate[left + 1];
    const sameSurface = cell => (ocean[cell] === ocean[index] ? cell : index) * 4;
    const a = sameSurface(row + col), b = sameSurface(row + nextCol);
    const c = sameSurface(nextRow + col), d = sameSurface(nextRow + nextCol);
    const channel = offset => lerp(lerp(pixels[a + offset], pixels[b + offset], fx),
      lerp(pixels[c + offset], pixels[d + offset], fx), fy);
    const dryLand = !ocean[index] && height[index] > 4;
    const grain = dryLand ? ((Math.imul(wx * 4 | 0, 16381) ^ Math.imul(wy * 4 | 0, 12853)) >>> 4 & 15) - 7 : 0;
    const red = channel(0), green = channel(1), blue = channel(2);
    const vegetation = dryLand ? Math.max(0, green - red) * .24 : 0;
    return rgba(clamp(red + wave - shade * 14 + grain + vegetation * .33, 0, 255),
      clamp(green + wave - shade * 25 + grain - vegetation, 0, 255),
      clamp(blue + wave - shade * 18 + grain, 0, 255));
  }

  function drawTerrain(view, time) {
    const {height, pixels, ocean, cloudShade} = world;
    bottom.fill(480);
    const occlude = view.groundPerspective;
    const focalRatio = view.firstPerson ? PILOT_FOCAL / FOCAL : 1;
    if (occlude) terrainDepth.fill(Infinity);
    for (let y = 0; y < 480; y++) {
      const band = clamp(Math.floor((y - view.horizon) / 9), -39, 0);
      const farSea = clamp(Math.floor((y - view.horizon) / 3), 0, 13);
      terrainPixels.fill(rgba(193 + band * 2 - farSea, 225 + band - farSea, 236 + band * .49 - farSea * .55),
        y * 384, (y + 1) * 384);
    }
    const shimmer = Math.floor(time * 9);
    const windX = Math.floor(wrap(time * CLOUD_WIND_X) / MAP_SCALE);
    const windY = Math.floor(wrap(time * CLOUD_WIND_Y) / MAP_SCALE);
    for (const sample of occlude ? pilotDistances : distances) {
      const {d, clear} = sample;
      const scale = sample.scale * focalRatio;
      const smoothing = occlude ? clamp((160 - d) / 48, 0, 1) : 0;
      const step = 2 / scale;
      const dx = view.cos * step / MAP_SCALE;
      const dy = view.sin * step / MAP_SCALE;
      let wx = 2048 + (view.x + view.sin * d) / MAP_SCALE - dx * 192;
      let wy = 2048 + (view.y - view.cos * d) / MAP_SCALE - dy * 192;
      const baseline = view.horizon + view.z * scale;
      if (baseline - 166 * scale >= 480) continue;
      for (let x = 0; x < 384; x++, wx += dx, wy += dy) {
        const end = bottom[x];
        if (!end) continue;
        const mx = wx | 0, my = wy | 0;
        const i = mapCoordinate[my] * MAP_SIZE + mapCoordinate[mx];
        const elevation = smoothing ? lerp(height[i],
          world.groundHeight((wx - 2048) * MAP_SCALE, (wy - 2048) * MAP_SCALE), smoothing) : height[i];
        const row = Math.max(0, (baseline - elevation * scale) | 0);
        if (row >= end) continue;
        const shade = cloudShade[mapCoordinate[my - windY] * MAP_SIZE + mapCoordinate[mx - windX]];
        const wave = ocean[i] && ((i * 11 - shimmer) & 255) < 5 ? 26 : 0;
        const p = i * 4;
        let color = rgba(
          182 + (pixels[p] + wave - shade * 14 - 182) * clear,
          Math.min(255, 212 + (pixels[p + 1] + wave - shade * 25 - 212) * clear),
          229 + (pixels[p + 2] + wave - shade * 18 - 229) * clear);
        if (smoothing) {
          const smooth = nearTerrainColor(wx, wy, i, shade, wave * .5);
          const mix = shift => lerp((color >>> shift) & 255, (smooth >>> shift) & 255, smoothing);
          color = rgba(mix(0), mix(8), mix(16));
        }
        for (let pixel = row * 384 + x, stop = end * 384 + x; pixel < stop; pixel += 384) {
          terrainPixels[pixel] = color;
          if (occlude) terrainDepth[pixel] = d;
        }
        bottom[x] = row;
      }
    }
    terrain.putImageData(terrainFrame, 0, 0);
    scene.drawImage(terrain.canvas, 0, 0, 768, 480);
  }

  function clipBehindTerrain(target, p, left, top, right, bottomEdge) {
    const start = Math.max(0, top), end = Math.min(480, bottomEdge);
    const nearDepth = p.depth - 2;
    target.beginPath();
    for (let col = Math.max(0, left >> 1); start < end && col < Math.min(384, Math.ceil(right / 2)); col++) {
      if (terrainDepth[start * 384 + col] < nearDepth) continue;
      let low = start, high = end;
      while (low < high) {
        const mid = (low + high) >> 1;
        if (terrainDepth[mid * 384 + col] >= nearDepth) low = mid + 1;
        else high = mid;
      }
      target.rect(col * 2, start, 2, low - start);
    }
    target.clip();
  }

  function drawTree(target, tree, p, x, y, occlude) {
    const h = Math.round(clamp(tree.size * p.scale, 2, 105));
    const w = Math.max(2, Math.round(h * .78));
    const left = x - Math.round(w / 2), top = y - h + 2;
    if (occlude) {
      target.save();
      clipBehindTerrain(target, p, left, top, left + w, top + h);
    }
    target.drawImage(tree.art, left, top, w, h);
    if (occlude) target.restore();
  }

  function drawTrails(target, state, view) {
    target.lineWidth = 1;
    target.strokeStyle = '#edfbff';
    const nodes = [...state.trail, {...state.player, time: state.time}];
    for (const side of [-1, 1]) {
      let previous = null;
      let opacity = -1;
      target.beginPath();
      for (const node of nodes) {
        const p = view.project({x: node.x + Math.cos(node.yaw) * 12 * side,
          y: node.y + Math.sin(node.yaw) * 12 * side, z: node.z - Math.sin(node.roll) * 12 * side});
        const fade = clamp(Math.ceil((1 - (state.time - node.time) / 2.05) * 9), 0, 9) / 10;
        if (fade !== opacity) {
          if (opacity > 0) {
            target.globalAlpha = opacity;
            target.stroke();
          }
          target.beginPath();
          opacity = fade;
        }
        if (previous && p && p.depth < 1600 && Math.hypot(p.x - previous.x, p.y - previous.y) < 120) {
          target.moveTo(Math.round(previous.x) + .5, Math.round(previous.y) + .5);
          target.lineTo(Math.round(p.x) + .5, Math.round(p.y) + .5);
        }
        previous = p;
      }
      if (opacity > 0) {
        target.globalAlpha = opacity;
        target.stroke();
      }
    }
    target.globalAlpha = 1;
  }

  function drawObjects(target, state, view) {
    const visible = [];
    const add = (item, kind, point = item) => {
      const p = view.project(point);
      if (p && p.x > -160 && p.x < target.canvas.width + 160 &&
        p.y > -160 && p.y < target.canvas.height + 160 && p.depth < 2200) visible.push({item, kind, p});
    };
    if (!state.pilotMode) {
      for (const cloud of world.clouds) add({...cloud,
        x: cloud.x + state.time * CLOUD_WIND_X, y: cloud.y + state.time * CLOUD_WIND_Y}, 'cloud');
    }
    for (const tree of world.trees) {
      if (!view.groundPerspective) {
        add(tree, 'tree');
        continue;
      }
      const depth = delta(tree.x, view.x) * view.sin - delta(tree.y, view.y) * view.cos;
      const smoothing = clamp((160 - depth) / 48, 0, 1);
      add(tree, 'tree', smoothing ? {...tree, z: lerp(tree.z, world.groundHeight(tree.x, tree.y), smoothing)} : tree);
    }
    for (const enemy of state.enemies) add(enemy, 'ship');
    if (state.camera !== 2 && state.player.hp > 0) add(state.player, 'ship');
    if (state.wreck) add(state.wreck, 'wreck');
    for (const shot of state.shots) add(shot, 'shot');
    for (const particle of state.particles) add(particle, 'particle');
    if (state.ground) {
      const ground = state.ground;
      add(ground.rescue, 'landing');
      if (ground.rescueIn <= 6) {
        add({...ground.rescue, z: ground.rescue.z + 13 + ground.rescueIn * 30}, 'helicopter');
      }
      if (ground.ship) add(ground.ship, 'patrol');
      for (const rock of ground.rocks) add(rock, 'rock');
      for (const soldier of ground.soldiers) {
        if (soldier.delay <= 0 && soldier.hp > 0) add(soldier, 'soldier');
      }
    }
    if (state.pilot && !view.firstPerson && !view.top) add(state.player, 'groundPilot');
    visible.sort((a, b) => view.top && a.kind === 'tree' && b.kind === 'tree'
      ? a.p.y - b.p.y
      : (b.kind === 'tree' && view.top ? Infinity : b.p.depth) -
        (a.kind === 'tree' && view.top ? Infinity : a.p.depth));
    for (const {item, kind, p} of visible) {
      const x = Math.round(p.x), y = Math.round(p.y);
      const occlude = view.groundPerspective && kind !== 'tree';
      if (occlude) {
        const size = kind === 'particle' ? Math.min(82, Math.ceil(p.scale * item.size * 2.7) + 8) :
          kind === 'wreck' || kind === 'shot' ? 150 : Math.ceil(Math.min(p.scale, 14) * 35);
        target.save();
        clipBehindTerrain(target, p, x - size, y - size, x + size, y + size);
      }
      if (kind === 'cloud') {
        const w = clamp(item.size * p.scale * 1.6, 3, 460);
        if (view.top && Math.abs(item.z - state.player.z) < 40) target.globalAlpha = .57;
        target.drawImage(item.art, Math.round(x - w / 2), Math.round(y - w / 3), Math.round(w), Math.round(w * .68));
        target.globalAlpha = 1;
      } else if (kind === 'tree') {
        drawTree(target, item, p, x, y, view.groundPerspective);
      } else if (kind === 'ship') {
        drawAircraft(target, item, view, p);
      } else if (kind === 'wreck') {
        const ground = world.height[world.index(item.x, item.y)];
        const lift = clamp((item.z - ground) * .12, 0, 29);
        drawAircraft(target, item, view, {...p, y: p.y - lift, scale: p.scale * .8});
      } else if (kind === 'shot') {
        const duration = Math.min(.058, (item.hostile ? 1.85 : .92) - item.life);
        const tail = view.project({x: item.x - item.dx * duration, y: item.y - item.dy * duration, z: item.z - item.dz * duration});
        const size = clamp(Math.round(p.scale * 2), 1, 4);
        if (tail && Math.hypot(tail.x - x, tail.y - y) < 100) {
          target.strokeStyle = item.hostile ? '#ed666586' : '#f9a75091';
          target.lineWidth = size + 2;
          target.beginPath();
          target.moveTo(Math.round(tail.x), Math.round(tail.y));
          target.lineTo(x, y);
          target.stroke();
          target.strokeStyle = item.hostile ? '#ffc4b3' : '#fff2bb';
          target.lineWidth = Math.max(1, size - 1);
          target.stroke();
        }
        target.fillStyle = item.hostile ? '#ffccc1' : '#fff9cc';
        target.fillRect(x, y, size, size);
      } else if (kind === 'particle') {
        drawParticle(target, item, p, x, y);
      } else {
        drawGroundObject(target, state, kind, p, x, y, item, view);
      }
      if (occlude) target.restore();
    }
    for (const shot of state.ground?.tracers ?? []) drawGroundTracer(target, view, shot);
  }

  function drawGroundTracer(target, view, shot) {
    let {from} = shot;
    const {to} = shot;
    if (view.firstPerson && !shot.hostile && Math.hypot(delta(from.x, view.x), delta(from.y, view.y)) < 5) {
      const startDepth = delta(from.x, view.x) * view.sin - delta(from.y, view.y) * view.cos;
      const endDepth = delta(to.x, view.x) * view.sin - delta(to.y, view.y) * view.cos;
      if (endDepth <= 14) return;
      const t = (14 - startDepth) / (endDepth - startDepth);
      from = {x: from.x + delta(to.x, from.x) * t + view.cos * 3,
        y: from.y + delta(to.y, from.y) * t + view.sin * 3, z: lerp(from.z, to.z, t) - 3.4};
    }
    const dx = delta(to.x, from.x), dy = delta(to.y, from.y);
    const segments = Math.ceil(clamp(Math.hypot(dx, dy) / 3, 1, 88));
    let previous = null;
    target.beginPath();
    for (let step = 0; step <= segments; step++) {
      const t = step / segments;
      const p = view.project({x: from.x + dx*t, y: from.y + dy*t, z: lerp(from.z, to.z, t)});
      if (!p) { previous = null; continue; }
      const x = Math.round(p.x), y = Math.round(p.y);
      if (view.groundPerspective &&
          (x < 0 || x >= 768 || y < 0 || y >= 480 || terrainDepth[y * 384 + (x >> 1)] < p.depth - 2)) {
        previous = null;
        continue;
      }
      if (previous) {
        target.moveTo(previous.x, previous.y);
        target.lineTo(x, y);
      }
      previous = {x, y};
    }
    target.globalAlpha = shot.life / .105 * (reducedCombatMotion.matches ? .52 : .85);
    target.strokeStyle = shot.hostile ? '#ffad84' : '#fce1a0';
    target.lineWidth = 1.5;
    target.stroke();
    target.globalAlpha = 1;
  }

  function drawGroundObject(target, state, kind, projected, x, y, item, view) {
    const {top} = view;
    const scale = Math.min(projected.scale, 14);
    const rect = (color, left, top, width, height) => {
      target.fillStyle = color;
      target.fillRect(x + Math.round(left * scale), y + Math.round(top * scale),
        Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
    };
    if (kind === 'rock') {
      const radius = item.radius;
      const height = top ? radius : item.height;
      target.fillStyle = '#344754';
      target.beginPath();
      target.moveTo(x - radius * scale, y);
      target.lineTo(x - radius * scale * .78, y - height * scale * .66);
      target.lineTo(x - radius * scale * .28, y - height * scale);
      target.lineTo(x + radius * scale * .57, y - height * scale * .86);
      target.lineTo(x + radius * scale, y - height * scale * .35);
      target.lineTo(x + radius * scale * .86, y + (top ? radius * scale : 0));
      target.closePath();
      target.fill();
      const face = (color, points) => paintedShape(target, color,
        points.map(([a, b]) => [Math.round(x + a * radius * scale), Math.round(y + b * height * scale)]));
      face('#7d8472', [[-.78,-.66],[-.28,-1],[.57,-.86],[.16,-.67],[-.31,-.54]]);
      face('#636c61', [[-.78,-.66],[-.31,-.54],[.16,-.67],[.07,-.34],[-.47,-.13],[-1,0]]);
      face('#535c53', [[.16,-.67],[.57,-.86],[1,-.35],[.75,-.17],[.07,-.34]]);
      if (scale > 1) {
        face('#969681', [[-.65,-.68],[-.25,-.89],[.16,-.83],[-.17,-.77],[-.28,-.66]]);
        face('#414d4a', [[-.34,-.55],[-.19,-.55],[-.2,-.38],[-.46,-.18],[-.36,-.35]]);
        face('#747c59', [[.04,-.18],[.55,-.28],[.7,-.18],[.31,-.07]]);
      }
    } else if (kind === 'landing') {
      rect('#363e38', -13, -3, 26, 5);
      rect('#c5b783', -12, -3, 4, 1);
      rect('#c5b783', 8, -3, 4, 1);
      rect('#d8dbc4', -6, -2, 2, 3);
      rect('#d8dbc4', 4, -2, 2, 3);
      rect('#d8dbc4', -4, -1, 8, 1);
      rect('#434b43', -1, -12, 2, 10);
      rect('#e4b967', -1.5, -13, 3, 2);
      const glow = .45 + Math.sin(state.time * 6) * .2;
      rect(`rgba(255,198,112,${glow})`, -2, -13.5, 4, 3);
    } else if (kind === 'helicopter') {
      rect('#213e43', -16, -14, 31, 12);
      rect('#72b48b', -14, -14, 27, 7);
      rect('#c1ebea', -14, -13, 9, 5);
      rect('#527b6c', 13, -11, 20, 3);
      rect('#527b6c', 29, -17, 4, 8);
      rect('#213e43', -13, 0, 24, 2);
      rect('#213e43', -6, -3, 2, 4);
      rect('#213e43', 6, -3, 2, 4);
      rect('#213e43', -1, -18, 2, 4);
      const blade = 8 + Math.abs(Math.cos(state.time * 41)) * 22;
      rect('#d0e7dc', -blade, -19, blade * 2, 1);
    } else if (kind === 'patrol') {
      rect('#173244', -24, -7, 48, 8);
      rect('#a19a88', -20, -10, 39, 5);
      rect('#536068', -13, -20, 21, 11);
      rect('#314353', -13, -19, 20, 3);
      rect('#536068', -1, -29, 2, 10);
      rect('#ff754d', 1, -28, 7, 4);
    } else {
      drawGroundCharacter(target, state, kind === 'groundPilot', scale, x, y, item, view);
    }
  }

  function pilotPose(state) {
    if (state.pilot?.eyeHeight < 9) return 3;
    if (state.player.speed < 4) return 0;
    return Math.sin(state.time * (10 + state.player.speed * .12)) > 0 ? 1 : 2;
  }

  function drawGroundCharacter(target, state, pilot, scale, x, y, item, view) {
    const art = pilot ? pilotArt : patrolArt;
    const yaw = pilot ? state.pilot.yaw : item.artYaw ?? 0;
    const pose = pilot ? pilotPose(state) : item.artPose ?? 0;
    if (view.top) {
      target.save();
      target.translate(x, y);
      target.rotate(yaw);
      target.drawImage(art.overhead[pose], -9, -10, 18, 20);
      target.restore();
      return;
    }
    const towardCamera = Math.atan2(delta(view.x, item.x), -delta(view.y, item.y));
    const direction = (Math.round(angleDelta(towardCamera, yaw) / (Math.PI / 4)) + 8) % 8;
    const image = art.poses[direction][scale < .85 ? 0 : pose];
    const h = Math.max(2, Math.round(scale * 18));
    const w = Math.max(2, Math.round(h * .75));
    if (pilot && state.pilotMode === 'swimming') {
      const bob = Math.round(Math.sin(state.time * 5) * scale * .5);
      target.drawImage(splash, x - w / 2, y - 5, w, Math.max(2, h / 7));
      target.drawImage(image, 0, 0, 48, 25, x - w / 2, y - h * .33 + bob, w, Math.max(2, h * .34));
      return;
    }
    if (scale > 1) {
      target.fillStyle = '#1e28243b';
      target.fillRect(x - Math.round(w * .25), y - 2, Math.round(w * .5), 3);
    }
    target.drawImage(image, Math.round(x - w / 2), y - h, w, h);
    if (item.flash > 0) {
      const hand = direction > 4 ? -1 : 1;
      const reach = direction % 4 === 0 ? .36 : .47;
      rectFlash(target, x + w * reach * hand, y - h * .54, Math.max(2, scale * 1.2));
    }
  }

  function rectFlash(target, x, y, size) {
    drawCombatFlash(target, x, y, size * 2, 1, '#dd9f64');
  }

  function drawGroundHud(state, view) {
    const ground = state.ground;
    const pilot = state.pilot;
    const swimming = state.pilotMode === 'swimming';
    const shore = state.shore ?? ground?.shore;
    const dx = shore ? delta(shore.x, state.player.x) : 0;
    const dy = shore ? delta(shore.y, state.player.y) : 0;
    const bearing = angleDelta(swimming ? Math.atan2(dx, -dy) : ground.bearing, view.yaw);
    ctx.fillStyle = '#071522e8';
    const compact = view.firstPerson;
    ctx.fillRect(compact ? 244 : 231, 8, compact ? 152 : 178, compact ? 32 : 40);
    ctx.save();
    ctx.translate(compact ? 258 : 249, compact ? 24 : 28);
    ctx.rotate(bearing);
    if (compact) ctx.scale(.75, .75);
    polygon('#a3ffbf', [[0,-11],[-7,7],[0,3],[7,7]]);
    ctx.restore();
    ctx.font = compact ? 'bold 10px monospace' : 'bold 11px monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#a3ffbf';
    const destination = swimming ? 'COSTA · ' + Math.ceil(Math.hypot(dx, dy)) : 'RESGATE · ' + Math.ceil(ground.distance);
    ctx.fillText(destination + ' m', compact ? 271 : 264, compact ? 21 : 24);
    ctx.fillStyle = '#e9faff';
    const remaining = Math.ceil(ground?.rescueIn ?? 0);
    ctx.fillText(swimming ? 'NADE ATÉ A PRAIA' : remaining > 0 ? `HELICÓPTERO EM ${remaining}s` : 'HELICÓPTERO NO LOCAL',
      compact ? 271 : 264, compact ? 33 : 38);

    if (swimming && compact) drawSwimmingArms(state);
    if (state.pilotMode !== 'walking') return;
    let aim = null;
    if (!view.firstPerson) {
      const impact = ground.aim(state.player).point;
      if (view.top) {
        const dx = delta(impact.x, state.player.x), dy = delta(impact.y, state.player.y);
        const scale = Math.min(1, (MID_Y - 28) / (view.zoom * Math.hypot(dx, dy)));
        aim = {x: MID_X + dx * view.zoom * scale, y: MID_Y + dy * view.zoom * scale};
      } else {
        aim = view.project(impact);
      }
    }
    if (aim || view.firstPerson) {
      const x = aim ? Math.round(aim.x - (view.top ? 0 : 64)) : MID_X;
      const y = aim ? Math.round(aim.y - (view.top ? 0 : 60)) : MID_Y;
      const gap = 2 + Math.round(pilot.spread * 80);
      ctx.fillStyle = pilot.confirm ? '#ffae57' : '#fff9db';
      ctx.fillRect(x - gap - 4, y, 4, 1);
      ctx.fillRect(x + gap + 1, y, 4, 1);
      ctx.fillRect(x, y - gap - 4, 1, 4);
      ctx.fillRect(x, y + gap + 1, 1, 4);
    }
    if (compact) drawPistol(state);
    else if (state.muzzle > 0) {
      const fade = state.muzzle / .09;
      if (view.top) drawCombatFlash(ctx, MID_X + Math.sin(pilot.yaw) * 14, MID_Y - Math.cos(pilot.yaw) * 14, 12, fade, '#ffbd58');
      else drawCombatFlash(ctx, 359, 263, 12, fade, '#ffbd58');
    }
  }

  function drawSwimmingArms(state) {
    const reach = Math.min(1, state.player.speed / 40);
    for (const side of [-1, 1]) {
      const stroke = Math.sin(state.time * 8 + (side === 1 ? Math.PI : 0));
      ctx.save();
      ctx.translate(MID_X + 122 * side, HEIGHT - 15 - Math.round(reach * (stroke + 1) * 17));
      ctx.scale(side, 1);
      polygon('#263a38', [[-9,38],[-37,17],[-29,0],[-16,-10],[-6,-7],[14,27],[16,38]]);
      polygon('#52635a', [[-30,17],[-23,3],[-17,-3],[-10,2],[9,29],[-7,31]]);
      polygon('#7e7764', [[-29,0],[-30,-7],[-22,-18],[-11,-19],[-4,-13],[-8,-7],[-17,-4],[-23,4]]);
      polygon('#a49b82', [[-27,-8],[-21,-15],[-13,-16],[-15,-11],[-24,-5]]);
      ctx.restore();
    }
  }

  function drawPistol(state) {
    const stride = Math.min(1, state.player.speed / 57);
    const x = 351 + Math.sin(state.time * 12) * stride * 5;
    const y = 254 + Math.cos(state.time * 24) * stride * 3;
    const reload = Math.sin(Math.PI * state.pilot.reload / 1.08);
    drawHeldWeaponArt(ctx, pilotPistol, x, y, 1.4, state.pilot.recoil, reload, state.muzzle / .09,
      state.muzzle / .09);
  }

  function drawPilot(state, view) {
    const pilot = state.player;
    const p = view.project(pilot);
    const swimming = state.pilotMode === 'swimming';
    const parachute = state.pilotMode === 'parachute';
    const yaw = state.pilot?.yaw ?? pilot.yaw;
    ctx.save();
    ctx.translate(Math.round(p.x), Math.round(p.y));
    if (swimming) {
      ctx.rotate(yaw);
      ctx.drawImage(splash, -14, -2 + Math.round(Math.sin(state.time * 8)), 28, 10);
      ctx.drawImage(pilotArt.overhead[0], 0, 0, 22, 16, -8, -9, 16, 12);
    } else if (parachute) {
      const ground = world.height[world.index(pilot.x, pilot.y)];
      const lift = Math.min(54, Math.round((pilot.z - ground) * .24));
      ctx.fillStyle = '#10273777';
      ctx.fillRect(-7, 1, 14, 5);
      ctx.translate(0, -lift);
      ctx.rotate(Math.sin(state.time * 4) * .10);
      polygon('#182f3c', [[-27,-28],[-22,-37],[-12,-43],[12,-43],[22,-37],[27,-28],[14,-21],[-14,-21]]);
      polygon('#ba7845', [[-24,-29],[-20,-35],[-10,-41],[10,-41],[20,-35],[24,-29],[13,-24],[-13,-24]]);
      polygon('#d7bf91', [[-9,-41],[9,-41],[13,-24],[-13,-24]]);
      polygon('#a3a08a', [[-14,-28],[14,-28],[13,-24],[-13,-24]]);
      polygon('#ca9363', [[-22,-34],[-12,-38],[-15,-27],[-20,-29]]);
      polygon('#8e5d3e', [[15,-38],[20,-35],[24,-29],[15,-26]]);
      ctx.strokeStyle = '#c9c5aa';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-23, -28);
      ctx.lineTo(-4, -2);
      ctx.moveTo(23, -28);
      ctx.lineTo(4, -2);
      ctx.moveTo(-13, -24);
      ctx.lineTo(-4, -2);
      ctx.moveTo(13, -24);
      ctx.lineTo(4, -2);
      ctx.stroke();
      ctx.drawImage(pilotArt.poses[0][0], -7, -4, 14, 19);
    } else {
      ctx.rotate(yaw);
      ctx.drawImage(pilotArt.overhead[pilotPose(state)], -10, -12, 20, 22);
    }
    ctx.restore();
  }

  function drawParticle(target, item, p, x, y) {
    const fade = clamp(item.life / item.lifetime, 0, 1);
    const size = clamp(Math.round(p.scale * item.size), 1, 48);
    target.fillStyle = item.color;
    target.globalAlpha = fade;
    if (item.type === 'flash') {
      drawCombatFlash(target, x, y, size * (1.1 - fade * .3), 1, item.color);
    } else if (item.type === 'ring') {
      drawCombatRing(target, x, y, size * (.32 + (1 - fade) * 1.45), 1, item.color);
    } else if (item.type === 'dust') {
      const width = Math.max(2, Math.round(size * (1.25 - fade * .7)));
      target.globalAlpha = fade * .33;
      target.fillRect(x - width / 2, y - width / 3, width, Math.max(1, width / 2));
      target.fillRect(x - width / 3, y - width / 2, width * .55, Math.max(1, width / 3));
    } else if (item.type === 'smoke') {
      const width = Math.max(3, Math.round(size * (1.2 + (1 - fade) * 2)));
      target.globalAlpha *= .55;
      target.fillRect(x - width / 2, y - width / 4, width, width / 2);
      target.fillRect(x - width / 3, y - width / 2, width * .72, width);
    } else if (item.type === 'spray') {
      const width = Math.max(2, Math.round(size * (1.4 + (1 - fade) * 2)));
      target.globalAlpha *= .75;
      target.fillRect(x - width / 2, y, width, Math.max(1, size >> 2));
      if (item.z > 2) target.fillRect(x + 1, y - 2, Math.max(1, size >> 1), 1);
    } else {
      const width = Math.min(size, 12);
      target.fillRect(x, y, width, item.type === 'spark' ? Math.max(1, width >> 1) : width);
      if (item.type === 'spark' && width > 1) {
        target.strokeStyle = item.color;
        target.lineWidth = 1;
        target.beginPath();
        target.moveTo(x, y);
        target.lineTo(x - clamp(item.dx * .12, -8, 8), y + clamp(item.dz * .13, -8, 8));
        target.stroke();
      }
    }
    target.globalAlpha = 1;
  }

  function polygon(color, points) {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (const [i, [x, y]] of points.entries()) {
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  }

  function cockpit(state) {
    for (const side of [0, 1]) {
      const panel = (color, points) => polygon(color, points.map(([x, y]) => [side ? WIDTH - x : x, y]));
      panel('#151b32', [[0,0],[96,0],[85,10],[53,10],[0,47]]);
      panel('#515e83', [[0,0],[48,0],[0,34]]);
      panel('rgba(112,240,255,.12)', [[74,0],[99,0],[29,110],[14,113]]);
      panel('#141a31', [[0,91],[16,114],[85,285],[64,309],[0,125]]);
      panel('#58648f', [[0,102],[9,117],[77,288],[68,298],[0,122]]);
      panel('#ff8c23', [[0,101],[12,128],[23,156],[15,161],[0,125]]);
      panel('#ff8c23', [[47,233],[58,226],[81,281],[72,293]]);
      panel('#29344f', [[0,323],[75,274],[128,274],[147,360],[0,360]]);
      panel('#fd8b23', [[0,337],[79,284],[116,284],[108,298],[0,354]]);
    }
    const dash = [[101,360],[111,299],[140,270],[268,270],[286,253],[354,253],
      [372,270],[500,270],[529,299],[539,360]];
    polygon('#101626', dash);
    polygon('#737fa7', [[111,300],[142,272],[270,272],[288,255],[352,255],[370,272],[498,272],
      [529,300],[511,298],[494,281],[367,281],[349,264],[291,264],[273,281],[146,281],[129,298]]);
    polygon('#343e5c', [[115,360],[128,301],[151,282],[276,282],[293,266],[347,266],
      [364,282],[489,282],[512,301],[525,360]]);
    ctx.fillStyle = '#1a2238';
    ctx.fillRect(151, 290, 124, 50);
    ctx.fillRect(365, 290, 124, 50);
    ctx.fillStyle = '#0e201b';
    ctx.fillRect(156, 295, 114, 40);
    ctx.fillRect(370, 295, 114, 40);
    ctx.font = 'bold 9px monospace';
    ctx.fillStyle = '#a5f5ab';
    ctx.fillText('VEL', 164, 307);
    ctx.fillText('ALT', 378, 307);
    ctx.font = 'bold 20px monospace';
    ctx.fillText(String(Math.round(state.player.speed)).padStart(3, '0'), 164, 329);
    ctx.fillText(String(Math.round(state.player.z)).padStart(3, '0'), 378, 329);
    for (let i = 0; i < 13; i++) {
      ctx.fillStyle = i < state.player.hp / 8 ? '#53b97d' : '#29443d';
      ctx.fillRect(424 + (i % 7) * 7, 325 - Math.floor(i / 7) * 9, 5, 5);
      ctx.fillStyle = i < state.player.speed / 23 ? '#53b97d' : '#29443d';
      ctx.fillRect(210 + (i % 7) * 7, 325 - Math.floor(i / 7) * 9, 5, 5);
    }
    ctx.save();
    ctx.translate(320, 312);
    ctx.fillStyle = '#141a2e';
    ctx.fillRect(-34, -34, 68, 68);
    ctx.beginPath();
    ctx.arc(0, 0, 24, 0, TAU);
    ctx.clip();
    ctx.rotate(-state.player.roll);
    const horizon = state.player.pitch * 28;
    ctx.fillStyle = '#5f9bcc';
    ctx.fillRect(-50, -50, 100, 50 + horizon);
    ctx.fillStyle = '#a26b42';
    ctx.fillRect(-50, horizon, 100, 60);
    ctx.fillStyle = '#f7f4d9';
    ctx.fillRect(-50, horizon, 100, 1);
    for (let y = -16; y <= 16; y += 8) ctx.fillRect(-7, y + horizon, 14, 1);
    ctx.restore();
    ctx.strokeStyle = '#a1afb8';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(320, 312, 25, 0, TAU);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.fillStyle = '#f4a363';
    for (const bank of [250, 373]) {
      for (let i = 0; i < 3; i++) ctx.fillRect(bank + i * 8, 347, 5, 5);
    }

    ctx.fillStyle = '#b4ffa5';
    const center = MID_Y + state.player.pitch * 82;
    for (let i = -4; i <= 4; i++) {
      const y = Math.round(center + i * 12);
      if (y < 88 || y > 227) continue;
      if (Math.abs(y - MID_Y) < 15) continue;
      const length = i % 2 === 0 ? 16 : 8;
      ctx.fillRect(MID_X - length / 2, y, length, 1);
    }
    ctx.strokeStyle = '#b4ffa5';
    ctx.strokeRect(MID_X - 8.5, MID_Y - 8.5, 17, 17);
    ctx.fillRect(MID_X - 25, MID_Y, 11, 1);
    ctx.fillRect(MID_X + 15, MID_Y, 11, 1);
    ctx.fillRect(MID_X - 3, MID_Y, 7, 1);
    ctx.fillRect(MID_X, MID_Y - 3, 1, 7);
  }

  function screenPoint(p, view) {
    if (!p || view.top) return p;
    const x = p.x - 384, y = p.y - 240;
    return {x: MID_X + x * Math.cos(view.tilt) - y * Math.sin(view.tilt),
      y: MID_Y + x * Math.sin(view.tilt) + y * Math.cos(view.tilt)};
  }

  function drawMarkers(state, view) {
    const lower = state.camera === 2 ? 244 : 321;
    for (const enemy of state.enemies) {
      const p = screenPoint(view.project(enemy), view);
      if (p && p.x > 17 && p.x < 623 && p.y > 37 && p.y < lower) {
        const x = Math.round(p.x), y = Math.round(p.y);
        ctx.strokeStyle = '#ff9389';
        ctx.strokeRect(x - 9.5, y - 9.5, 19, 19);
        ctx.fillStyle = '#301f31';
        ctx.fillRect(x - 9, y - 14, 19, 2);
        ctx.fillStyle = '#ff9389';
        ctx.fillRect(x - 9, y - 14, Math.ceil(19 * enemy.hp / enemy.maxHp), 2);
        continue;
      }
      const bearing = angleDelta(Math.atan2(delta(enemy.x, view.x), -delta(enemy.y, view.y)), view.yaw);
      const x = clamp(MID_X + Math.sin(bearing) * 360, 14, WIDTH - 14);
      const y = clamp(MID_Y - Math.cos(bearing) * 180, 43, lower - 5);
      ctx.save();
      ctx.translate(Math.round(x), Math.round(y));
      ctx.rotate(bearing);
      polygon('#ff9389', [[0,-6],[-4,2],[4,2]]);
      ctx.restore();
    }
    const x = Math.round(state.pointer.x), y = Math.round(state.pointer.y);
    ctx.fillStyle = '#102432';
    ctx.fillRect(x - 7, y - 1, 15, 3);
    ctx.fillRect(x - 1, y - 7, 3, 15);
    ctx.fillStyle = '#d3ffbc';
    ctx.fillRect(x - 7, y, 5, 1);
    ctx.fillRect(x + 3, y, 5, 1);
    ctx.fillRect(x, y - 7, 1, 5);
    ctx.fillRect(x, y + 3, 1, 5);
  }

  return (state, weight = 1, tick = 0) => {
    if (weight < 1 && state.player.previousPose) {
      const lag = tick * (1 - weight);
      const rewind = point => ({...point, x: point.x - point.dx * lag, y: point.y - point.dy * lag, z: point.z - point.dz * lag});
      state = {...state, time: Math.max(0, state.time - lag),
        player: interpolate(state.player, weight),
        wreck: state.wreck && interpolate(state.wreck, weight),
        enemies: state.enemies.map(enemy => interpolate(enemy, weight)),
        shots: state.shots.map(rewind), particles: state.particles.map(rewind)
      };
    }
    const view = camera(state);
    if (view.top) {
      drawTop(view, state.time);
      if (!state.pilotMode) drawTrails(ctx, state, view);
      drawObjects(ctx, state, view);
      if (state.pilotMode && state.pilotMode !== 'falling') drawPilot(state, view);
    } else {
      drawTerrain(view, state.time);
      drawTrails(scene, state, view);
      drawObjects(scene, state, view);
      ctx.save();
      ctx.translate(MID_X + view.shakeX, MID_Y + view.shakeY);
      ctx.rotate(view.tilt);
      ctx.drawImage(scene.canvas, -384, -240);
      ctx.restore();
    }
    if (!state.pilotMode && state.camera === 2) {
      cockpit(state);
      if (state.muzzle > 0) {
        ctx.fillStyle = `rgba(255,191,101,${state.muzzle * (reducedCombatMotion.matches ? .7 : 2.3)})`;
        ctx.fillRect(166, 239, 308, 22);
      }
    }
    if (state.running) {
      if (!state.pilotMode) drawMarkers(state, view);
      if (state.pilot) drawGroundHud(state, view);
      const hit = state.pilot?.hit ?? state.hit;
      if (hit > 0) {
        ctx.fillStyle = `rgba(234,63,58,${hit * (reducedCombatMotion.matches ? .26 : .55)})`;
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
      }
      if (state.banner > 0) {
        ctx.textAlign = 'center';
        ctx.font = 'bold 14px monospace';
        ctx.fillStyle = '#0d2537';
        ctx.fillRect(264, 40, 112, 22);
        ctx.fillStyle = '#ffe1a1';
        ctx.fillText(`ONDA ${state.wave + 1} / 3`, MID_X, 56);
        ctx.textAlign = 'start';
      }
    }
  };
}
