const WIDTH = 640;
const HEIGHT = 360;
const MID_X = WIDTH / 2;
const MID_Y = HEIGHT / 2;
const FOCAL = 297;

function createRenderer(canvas, world) {
  const ctx = canvas.getContext('2d', {alpha: false});
  ctx.imageSmoothingEnabled = false;
  const scene = surface(768, 480);
  const terrain = surface(384, 480);
  const terrainFrame = terrain.createImageData(384, 480);
  const terrainPixels = new Uint32Array(terrainFrame.data.buffer);
  const bottom = new Int16Array(384);
  // Índices do mapa para toda a faixa de amostragem, incluindo as bordas.
  const mapCoordinate = Uint16Array.from({length: 4096}, (_, i) => ((i - 2048) % MAP_SIZE + MAP_SIZE) % MAP_SIZE);
  const distances = [];
  for (let d = 16; d < 2150; d += 3 + d * .034) {
    distances.push({d, scale: FOCAL / d, clear: 1 - clamp((d - 210) / 1880, 0, .92)});
  }
  const layers = Object.fromEntries(Object.keys(AIRCRAFT_MODELS).map(model => [model, aircraftSlices(model)]));
  const sprites = new Map();

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
    if (ship.boost) {
      const direction = angleDelta(ship.yaw, view.yaw);
      const x = p.x - Math.sin(direction) * size * .27;
      const y = p.y + Math.cos(direction) * size * (view.top ? .27 : .13);
      const glow = Math.max(2, Math.round(size * .048));
      target.save();
      target.translate(Math.round(x), Math.round(y));
      target.rotate(direction);
      for (const side of [-1, 1]) {
        const nozzle = side * glow * 1.2;
        target.fillStyle = '#d15447';
        target.fillRect(nozzle - glow, -glow, glow * 2, glow * 4);
        target.fillStyle = '#ffab52';
        target.fillRect(nozzle - glow * .65, 0, glow * 1.3, glow * 2.8);
        target.fillStyle = '#fff4ca';
        target.fillRect(nozzle - glow * .35, 0, glow * .7, glow * 1.5);
      }
      target.restore();
    }
    target.drawImage(sprites.get(key), Math.round(p.x - size / 2), Math.round(p.y - size / 2), Math.round(size), Math.round(size));
  }

  function camera(state) {
    const p = state.player;
    const top = state.camera === 0;
    const chase = state.camera === 1;
    const yaw = top ? 0 : p.yaw;
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    const x = top ? p.x : p.x - sin * (chase ? 124 : -8);
    const y = top ? p.y : p.y + cos * (chase ? 124 : -8);
    const z = p.z + (chase ? 36 : 5);
    const pitch = chase ? p.pitch * .63 - .22 : p.pitch;
    const horizon = 240 + Math.tan(pitch) * FOCAL;
    const zoom = clamp(.79 - (p.z - 230) * .00045, .48, .89);
    const tilt = top ? 0 : -Math.sin(p.roll) * (chase ? .12 : .19);
    return {
      top, yaw, sin, cos, x, y, z, horizon, zoom, tilt,
      project(point) {
        const dx = delta(point.x, x), dy = delta(point.y, y);
        if (top) return {x: MID_X + dx * zoom, y: MID_Y + dy * zoom, scale: zoom, depth: -point.z};
        const depth = dx * sin - dy * cos;
        if (depth < 12) return null;
        const scale = FOCAL / depth;
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

  function drawTerrain(view, time) {
    const {height, pixels, ocean, cloudShade} = world;
    bottom.fill(480);
    for (let y = 0; y < 480; y++) {
      const band = clamp(Math.floor((y - view.horizon) / 9), -39, 0);
      const farSea = clamp(Math.floor((y - view.horizon) / 3), 0, 13);
      terrainPixels.fill(rgba(193 + band * 2 - farSea, 225 + band - farSea, 236 + band * .49 - farSea * .55),
        y * 384, (y + 1) * 384);
    }
    const shimmer = Math.floor(time * 9);
    const windX = Math.floor(wrap(time * CLOUD_WIND_X) / MAP_SCALE);
    const windY = Math.floor(wrap(time * CLOUD_WIND_Y) / MAP_SCALE);
    for (const {d, scale, clear} of distances) {
      const step = 2 / scale;
      const dx = view.cos * step / MAP_SCALE;
      const dy = view.sin * step / MAP_SCALE;
      let wx = 2048 + (view.x + view.sin * d) / MAP_SCALE - dx * 192;
      let wy = 2048 + (view.y - view.cos * d) / MAP_SCALE - dy * 192;
      const baseline = view.horizon + view.z * scale;
      if (baseline - 166 * scale >= 480) continue;
      for (let x = 0; x < 384; x++, wx += dx, wy += dy) {
        const mx = wx | 0, my = wy | 0;
        const i = mapCoordinate[my] * MAP_SIZE + mapCoordinate[mx];
        const row = Math.max(0, (baseline - height[i] * scale) | 0);
        const end = bottom[x];
        if (row >= end) continue;
        const shade = cloudShade[mapCoordinate[my - windY] * MAP_SIZE + mapCoordinate[mx - windX]];
        const wave = ocean[i] && ((i * 11 - shimmer) & 255) < 5 ? 26 : 0;
        const p = i * 4;
        const color = rgba(
          182 + (pixels[p] + wave - shade * 14 - 182) * clear,
          Math.min(255, 212 + (pixels[p + 1] + wave - shade * 25 - 212) * clear),
          229 + (pixels[p + 2] + wave - shade * 18 - 229) * clear);
        for (let pixel = row * 384 + x, stop = end * 384 + x; pixel < stop; pixel += 384) {
          terrainPixels[pixel] = color;
        }
        bottom[x] = row;
      }
    }
    terrain.putImageData(terrainFrame, 0, 0);
    scene.drawImage(terrain.canvas, 0, 0, 768, 480);
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
    const add = (item, kind) => {
      const p = view.project(item);
      if (p && p.x > -160 && p.x < target.canvas.width + 160 &&
        p.y > -160 && p.y < target.canvas.height + 160 && p.depth < 2200) visible.push({item, kind, p});
    };
    for (const cloud of world.clouds) add({...cloud,
      x: cloud.x + state.time * CLOUD_WIND_X, y: cloud.y + state.time * CLOUD_WIND_Y}, 'cloud');
    for (const enemy of state.enemies) add(enemy, 'ship');
    if (state.camera !== 2 && state.player.hp > 0) add(state.player, 'ship');
    for (const shot of state.shots) add(shot, 'shot');
    for (const particle of state.particles) add(particle, 'particle');
    visible.sort((a, b) => b.p.depth - a.p.depth);
    for (const {item, kind, p} of visible) {
      const x = Math.round(p.x), y = Math.round(p.y);
      if (kind === 'cloud') {
        const w = clamp(item.size * p.scale * 1.6, 3, 460);
        if (view.top && Math.abs(item.z - state.player.z) < 40) target.globalAlpha = .57;
        target.drawImage(item.art, Math.round(x - w / 2), Math.round(y - w / 3), Math.round(w), Math.round(w * .68));
        target.globalAlpha = 1;
      } else if (kind === 'ship') {
        drawAircraft(target, item, view, p);
      } else if (kind === 'shot') {
        const duration = Math.min(.03, (item.hostile ? 1.85 : .92) - item.life);
        const tail = view.project({x: item.x - item.dx * duration, y: item.y - item.dy * duration, z: item.z - item.dz * duration});
        const size = clamp(Math.round(p.scale * 2), 1, 4);
        if (tail && Math.hypot(tail.x - x, tail.y - y) < 100) {
          target.strokeStyle = item.hostile ? '#ff615f' : '#ffc65a';
          target.lineWidth = size + 1;
          target.beginPath();
          target.moveTo(Math.round(tail.x), Math.round(tail.y));
          target.lineTo(x, y);
          target.stroke();
        }
        target.fillStyle = item.hostile ? '#ffccc1' : '#fff9cc';
        target.fillRect(x, y, size, size);
      } else {
        drawParticle(target, item, p, x, y);
      }
    }
  }

  function drawParticle(target, item, p, x, y) {
    const fade = clamp(item.life / item.lifetime, 0, 1);
    const size = clamp(Math.round(p.scale * item.size), 1, 48);
    target.fillStyle = item.color;
    target.globalAlpha = fade;
    if (item.type === 'flash') {
      const radius = Math.max(2, Math.round(size * (1.1 - fade * .3)));
      target.globalAlpha *= .45;
      target.fillRect(x - radius, y - radius / 3, radius * 2, radius * .66);
      target.fillRect(x - radius / 3, y - radius, radius * .66, radius * 2);
      target.globalAlpha = fade;
      target.fillStyle = '#fff2b0';
      target.fillRect(x - radius * .25, y - radius * .25, radius * .5, radius * .5);
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
        enemies: state.enemies.map(enemy => interpolate(enemy, weight)),
        shots: state.shots.map(rewind), particles: state.particles.map(rewind)
      };
    }
    const view = camera(state);
    if (view.top) {
      drawTop(view, state.time);
      drawTrails(ctx, state, view);
      drawObjects(ctx, state, view);
    } else {
      drawTerrain(view, state.time);
      drawTrails(scene, state, view);
      drawObjects(scene, state, view);
      ctx.save();
      ctx.translate(MID_X, MID_Y);
      ctx.rotate(view.tilt);
      ctx.drawImage(scene.canvas, -384, -240);
      ctx.restore();
    }
    if (state.camera === 2) {
      cockpit(state);
      if (state.muzzle > 0) {
        ctx.fillStyle = `rgba(255,191,101,${state.muzzle * 2.3})`;
        ctx.fillRect(166, 239, 308, 22);
      }
    }
    if (state.running) {
      drawMarkers(state, view);
      if (state.hit > 0) {
        ctx.fillStyle = `rgba(234,63,58,${state.hit * .4})`;
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
