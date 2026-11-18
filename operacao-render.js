'use strict';

function createTacticalRenderer(canvas, radar) {
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const mapCtx = radar.getContext('2d');
  const {width, height} = canvas;
  const depthBuffer = new Float32Array(width);
  const focal = width / 1.52;
  const colors = {
    '#': [131, 147, 139], 'C': [164, 120, 78], 'R': [76, 130, 124],
    'W': [185, 166, 129], 'B': [97, 118, 134]
  };

  const combatants = [makeCharacterArt('allied'), makeCharacterArt('rival')];
  const handheld = Object.fromEntries(['pistol', 'smg', 'rifle'].map(id => [id, makeHeldWeaponArt(id)]));
  const floorTones = ['#2730272a', '#77765920', '#17232048', '#ae98703b'];
  function makeTerminal(active) {
    return pixelArt(34, 38, g => {
      g.fillStyle = '#23312c';
      g.fillRect(5, 14, 24, 22);
      g.fillRect(3, 5, 28, 12);
      g.fillStyle = '#5f7164';
      g.fillRect(4, 5, 26, 4);
      g.fillRect(5, 19, 24, 3);
      g.fillStyle = active ? '#ffc175' : '#a5f0cc';
      g.fillRect(7, 9, 20, 5);
      g.fillRect(10, 26, 14, 2);
      g.fillStyle = '#d4e9d9';
      g.fillRect(9, 10, 5, 1);
    });
  }
  const terminalIdle = makeTerminal(false);
  const terminalActive = makeTerminal(true);
  const droppedDevice = pixelArt(24, 15, g => {
    g.fillStyle = '#32291e';
    g.fillRect(1, 5, 22, 9);
    g.fillStyle = '#edb968';
    g.fillRect(2, 3, 20, 8);
    g.fillStyle = '#272c25';
    g.fillRect(6, 5, 12, 4);
    g.fillStyle = '#b9e8d2';
    g.fillRect(8, 6, 6, 1);
  });
  const smokeCloud = pixelArt(96, 58, g => {
    for (const [x, y, radius] of [[19, 38, 19], [23, 25, 19], [39, 19, 19], [54, 19, 17],
      [73, 27, 22], [73, 40, 19], [49, 35, 23], [31, 40, 18], [58, 39, 19]]) {
      const mist = g.createRadialGradient(x, y, radius * .44, x, y, radius);
      mist.addColorStop(0, '#aeb8b1');
      mist.addColorStop(1, '#78888300');
      g.fillStyle = mist;
      g.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
  });

  // Grid traversal returns perpendicular depth for camera rays.
  function cast(level, x, y, dx, dy) {
    let cellX = Math.floor(x), cellY = Math.floor(y);
    const invX = Math.abs(1 / dx), invY = Math.abs(1 / dy);
    const stepX = dx < 0 ? -1 : 1, stepY = dy < 0 ? -1 : 1;
    let nextX = (dx < 0 ? x - cellX : cellX + 1 - x) * invX;
    let nextY = (dy < 0 ? y - cellY : cellY + 1 - y) * invY;
    if (!dx) nextX = Infinity;
    if (!dy) nextY = Infinity;
    let side, distance, tile;
    do {
      side = nextY < nextX;
      if (side) {
        cellY += stepY;
        distance = nextY;
        nextY += invY;
      } else {
        cellX += stepX;
        distance = nextX;
        nextX += invX;
      }
      tile = level.tile(cellX, cellY);
    } while (tile === '.');
    const surface = side ? x + dx * distance : y + dy * distance;
    return {distance, side, tile, offset: surface - Math.floor(surface)};
  }

  function drawWorld(level, view, horizon) {
    const eye = view.eye ?? .54;
    const sky = ctx.createLinearGradient(0, 0, 0, Math.max(1, horizon));
    sky.addColorStop(0, '#405d66');
    sky.addColorStop(1, '#e3c49d');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, horizon);
    ctx.fillStyle = '#e1c6a1';
    const skylineShift = Math.sin(view.angle) * 80;
    for (let i = -2; i < 12; i++) {
      const y = horizon - 36 + Math.sin(i * 4.1) * 11;
      ctx.fillRect(i * 55 + skylineShift, y, 30, 2);
    }
    const floor = ctx.createLinearGradient(0, horizon, 0, height);
    floor.addColorStop(0, '#747e6b');
    floor.addColorStop(1, '#343e35');
    ctx.fillStyle = floor;
    ctx.fillRect(0, horizon, width, height - horizon);

    const forwardX = Math.cos(view.angle), forwardY = Math.sin(view.angle);
    for (let y = Math.max(0, horizon + 5); y < height; y += 2) {
      const distance = focal * eye / (y - horizon);
      const step = distance / focal;
      const left = (0.5 - width / 2) * step;
      for (let x = 0; x < width; x += 8) {
        const side = left + x * step;
        const wx = view.x + forwardX * distance - forwardY * side;
        const wy = view.y + forwardY * distance + forwardX * side;
        const ix = Math.floor(wx), iy = Math.floor(wy);
        const fx = wx - ix, fy = wy - iy;
        const seam = distance < 10 && (fx < .025 || fy < .025);
        const trim = (iy === 8 || iy === 10) && fy > .63 && fy < .68 && ix % 4 !== 0;
        ctx.fillStyle = floorTones[trim ? 3 : seam ? 2 : (ix * 13 + iy * 7) & 1];
        ctx.fillRect(x, y, 8, 2);
      }
    }
    for (let x = 0; x < width; x++) {
      const plane = (x + .5 - width / 2) / focal;
      const hit = cast(level, view.x, view.y, forwardX - forwardY * plane, forwardY + forwardX * plane);
      const {tile, offset, side} = hit;
      const d = Math.max(.025, hit.distance);
      depthBuffer[x] = d;
      const bottom = horizon + focal * eye / d;
      const wallHeight = focal * (tile === 'C' ? .96 : 1.18) / d;
      const top = bottom - wallHeight;
      const edge = offset < .035 || offset > .965;
      const metal = tile === 'C' || tile === 'R';
      const rib = metal ? Math.floor(offset * 16) % 2 * .09 : 0;
      const grain = d < 9 ? (Math.floor(offset * 48) % 4) * .013 : 0;
      const light = Math.max(.24, .98 - (side ? .17 : 0) - d * .027 - (edge ? .16 : rib) - grain);
      ctx.fillStyle = 'rgb(' + colors[tile].map(value => Math.round(value * light)).join(',') + ')';
      ctx.fillRect(x, top, 1, wallHeight + 1);
      ctx.fillStyle = '#101d203f';
      ctx.fillRect(x, top + wallHeight * .24, 1, Math.max(1, wallHeight * .014));
      ctx.fillRect(x, top + wallHeight * .89, 1, Math.max(1, wallHeight * .06));
      ctx.fillStyle = '#ddd8bc55';
      ctx.fillRect(x, top + wallHeight * .05, 1, Math.max(1, wallHeight * .018));
      if (metal) {
        ctx.fillStyle = tile === 'C' ? '#e3b77383' : '#b7d8ce85';
        ctx.fillRect(x, top + wallHeight * .36, 1, Math.max(1, wallHeight * .055));
        if (offset > .07 && offset < .14 && d < 9) {
          ctx.fillStyle = '#17282a99';
          ctx.fillRect(x, top + wallHeight * .12, 1, Math.max(1, wallHeight * .024));
          ctx.fillRect(x, top + wallHeight * .82, 1, Math.max(1, wallHeight * .024));
        }
      } else if (d < 9) {
        ctx.fillStyle = '#292f2a47';
        ctx.fillRect(x, top + wallHeight * .58, 1, Math.max(1, wallHeight * .025));
      }
    }
  }

  function drawSprites(level, view, actors, horizon, device, smokes) {
    const facingX = Math.cos(view.angle), facingY = Math.sin(view.angle);
    const sprites = actors.filter(actor => actor.hp > 0 && actor !== view).map(actor => {
      const towardCamera = Math.atan2(view.y - actor.y, view.x - actor.x);
      const sector = Math.round((towardCamera - actor.angle) / (Math.PI / 4));
      const direction = (sector + 16) % 8;
      const near = Math.hypot(view.x - actor.x, view.y - actor.y) < 12;
      const pose = near ? actor.artPose ?? 0 : 0;
      return {x: actor.x, y: actor.y, image: combatants[actor.team].poses[direction][pose],
        scale: .96, flash: actor.flash, flashOffset: (direction > 4 ? -.43 : .43)};
    });
    for (const site of level.sites) {
      const armed = site === device?.site;
      sprites.push({...site, image: armed ? terminalActive : terminalIdle, scale: .67, label: site.id, armed});
    }
    if (device?.dropped) {
      sprites.push({...device.dropped, image: droppedDevice, scale: .22});
    }
    for (const smoke of smokes) {
      sprites.push(smoke.fuse > 0 ? {...smoke, image: droppedDevice, scale: .13} :
        {...smoke, elevation: 0, image: smokeCloud, scale: 2, opacity: Math.min(1, smoke.time)});
    }
    for (const sprite of sprites) {
      const dx = sprite.x - view.x, dy = sprite.y - view.y;
      sprite.depth = dx * facingX + dy * facingY;
      sprite.side = dy * facingX - dx * facingY;
    }
    sprites.sort((a, b) => b.depth - a.depth);
    for (const sprite of sprites) {
      if (sprite.depth < .16) continue;
      const h = focal * sprite.scale / sprite.depth;
      const w = h * sprite.image.width / sprite.image.height;
      const center = width / 2 + focal * sprite.side / sprite.depth;
      const bottom = horizon + focal * ((view.eye ?? .54) - (sprite.elevation ?? 0)) / sprite.depth;
      const left = center - w / 2;
      ctx.globalAlpha = sprite.opacity ?? 1;
      for (let x = Math.max(0, Math.ceil(left)); x < Math.min(width, left + w); x++) {
        if (sprite.depth >= depthBuffer[x]) continue;
        const sx = Math.min(sprite.image.width - 1, Math.floor((x - left) * sprite.image.width / w));
        ctx.drawImage(sprite.image, sx, 0, 1, sprite.image.height, x, bottom - h, 1, h);
      }
      ctx.globalAlpha = 1;
      const screenX = Math.floor(center);
      if (sprite.depth >= depthBuffer[screenX]) continue;
      if (sprite.label && screenX >= 0 && screenX < width) {
        const top = Math.max(47, bottom - h - 17);
        ctx.fillStyle = '#141e1ce8';
        ctx.fillRect(center - 6, top - 8, 12, 12);
        ctx.fillStyle = sprite.armed ? '#ffc175' : '#a5f0cc';
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(sprite.label, center, top + 1);
      }
      if (sprite.flash > 0) {
        const start = Math.max(0, Math.round(center + w * sprite.flashOffset));
        const end = Math.min(width, start + Math.max(2, Math.round(w * .1)));
        ctx.fillStyle = '#eac085';
        for (let x = start; x < end; x++) {
          if (sprite.depth < depthBuffer[x]) ctx.fillRect(x, bottom - h * .55, 1, Math.max(2, w * .08));
        }
      }
    }
  }

  function drawWeapon(view) {
    const {weapon, flash, recoil, reload, stride, speed} = view;
    const motion = Math.min(1, speed / 2.5);
    const x = width * .5 + Math.sin(stride) * motion * 6;
    const y = height - 91 + Math.cos(stride * 2) * motion * 3;
    const loading = Math.sin(Math.PI * reload / weapons[weapon].reload);
    drawHeldWeaponArt(ctx, handheld[weapon], x, y, 1.26, recoil, loading, flash > 0);
  }

  function drawRadar(level, player, actors, device, visible) {
    const scale = Math.min((radar.width - 8) / level.width, (radar.height - 8) / level.height);
    const ox = (radar.width - level.width * scale) / 2;
    const oy = (radar.height - level.height * scale) / 2;
    mapCtx.fillStyle = '#111916';
    mapCtx.fillRect(0, 0, radar.width, radar.height);
    for (let y = 0; y < level.height; y++) {
      for (let x = 0; x < level.width; x++) {
        mapCtx.fillStyle = level.tile(x, y) === '.' ? '#34463e' : '#657571';
        mapCtx.fillRect(ox + x * scale, oy + y * scale, Math.ceil(scale), Math.ceil(scale));
      }
    }
    function dot(point, color, size) {
      mapCtx.fillStyle = color;
      mapCtx.beginPath();
      mapCtx.arc(ox + point.x * scale, oy + point.y * scale, size, 0, Math.PI * 2);
      mapCtx.fill();
    }
    for (const actor of actors) {
      if (actor !== player && actor.hp > 0 && (actor.team === 0 || visible(player, actor))) {
        dot(actor, actor.team === 0 ? '#95e2cc' : '#ec9b64', 2.5);
      }
    }
    if (player.hp > 0) {
      dot(player, '#fff', 2.8);
      mapCtx.strokeStyle = '#fff';
      mapCtx.beginPath();
      mapCtx.moveTo(ox + player.x * scale, oy + player.y * scale);
      mapCtx.lineTo(ox + player.x * scale + Math.cos(player.angle) * 7, oy + player.y * scale + Math.sin(player.angle) * 7);
      mapCtx.stroke();
    }
    for (const site of level.sites) {
      const armed = device.site === site;
      dot(site, armed ? '#efb569' : '#263831', 5.2);
      mapCtx.fillStyle = armed ? '#2d1b09' : '#fff0b2';
      mapCtx.font = 'bold 8px monospace';
      mapCtx.textAlign = 'center';
      mapCtx.fillText(site.id, ox + site.x * scale, oy + site.y * scale + 3);
    }
    if (device.dropped && (device.dropped.team === player.team || visible(player, device.dropped))) {
      dot(device.dropped, '#f6ab61', 3.2);
    }
    if (device.carrier?.team === player.team) {
      dot(device.carrier, '#f6ab61', 2);
    }
  }

  return {
    cast,
    draw(level, view, actors, device, smokes = [], showWeapon, hurt) {
      const horizon = Math.round(height / 2 + (view.pitch || 0) * focal + (view.recoil || 0) * 3);
      drawWorld(level, view, horizon);
      drawSprites(level, view, actors, horizon, device, smokes);
      const cloud = smokes.find(smoke => !smoke.fuse && Math.hypot(view.x - smoke.x, view.y - smoke.y) < smoke.radius);
      if (cloud) {
        ctx.fillStyle = '#a7b4abd9';
        ctx.fillRect(0, 0, width, height);
      }
      if (showWeapon) drawWeapon(view);
      if (hurt > 0) {
        ctx.fillStyle = 'rgba(177,44,26,' + (hurt * .42) + ')';
        ctx.fillRect(0, 0, width, height);
      }
    },
    drawRadar
  };
}
