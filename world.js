/* O relevo e os sprites são desenhados em Canvas 2D. */
const WORLD_SIZE = 3072;
const MAP_SIZE = 768;
const MAP_SCALE = WORLD_SIZE / MAP_SIZE;
const TAU = Math.PI * 2;
const CLOUD_WIND_X = 5.2;
const CLOUD_WIND_Y = 2.7;
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const lerp = (a, b, t) => a + (b - a) * t;
const wrap = n => (n % WORLD_SIZE + WORLD_SIZE) % WORLD_SIZE;
const delta = (a, b) => {
  const d = a - b;
  return d - WORLD_SIZE * Math.round(d / WORLD_SIZE);
};
const angleDelta = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const rgba = (r, g, b) => 0xff000000 | (b << 16) | (g << 8) | r;

function surface(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  return ctx;
}

function randomSeed(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function createWorld() {
  const rng = randomSeed(10322);
  const islands = [
    [95, 102, 124, 65, -.6], [218, 140, 53, 32, .3], [346, 84, 71, 48, .8],
    [642, 134, 100, 51, -.45], [467, 256, 123, 66, -.45], [581, 210, 40, 26, .8],
    [253, 299, 67, 39, .6], [77, 394, 121, 57, -.85], [150, 491, 53, 68, -.65],
    [494, 472, 64, 53, .7], [606, 480, 35, 17, .6], [672, 433, 67, 45, -.7],
    [309, 605, 131, 65, -.37], [439, 565, 52, 24, -.6], [573, 657, 101, 62, .29],
    [44, 683, 67, 37, .6], [711, 673, 31, 24, -.4], [313, 167, 26, 15, .2]
  ].map(([x, y, rx, ry, a]) => ({x, y, rx, ry, c: Math.cos(a), s: Math.sin(a)}));
  const height = new Uint8Array(MAP_SIZE * MAP_SIZE);
  const map = surface(MAP_SIZE, MAP_SIZE);
  const art = map.createImageData(MAP_SIZE, MAP_SIZE);
  const pixels = art.data;
  const ocean = new Uint8Array(height.length);
  const palette = {
    sea: [23, 100, 164], deep: [23, 83, 151], shelf: [29, 129, 176],
    shoal: [53, 175, 195], foam: [157, 226, 220], sand: [242, 215, 151],
    grass: [[105, 167, 67], [119, 177, 73], [130, 185, 80], [137, 190, 86]],
    woods: [[26, 101, 70], [38, 121, 70], [58, 141, 75]],
    rock: [[110, 117, 109], [132, 135, 120], [161, 155, 134]]
  };
  for (let y = 0; y < MAP_SIZE; y++) {
    for (let x = 0; x < MAP_SIZE; x++) {
      let ridge = -2;
      for (const i of islands) {
        let dx = x - i.x;
        let dy = y - i.y;
        dx -= MAP_SIZE * Math.round(dx / MAP_SIZE);
        dy -= MAP_SIZE * Math.round(dy / MAP_SIZE);
        if (Math.abs(dx) > 160 || Math.abs(dy) > 160) continue;
        const u = (dx * i.c + dy * i.s) / i.rx;
        const v = (dy * i.c - dx * i.s) / i.ry;
        ridge = Math.max(ridge, 1 - u * u - v * v);
      }
      const coast = Math.sin(x * .062 + Math.cos(y * .09)) * .12 + Math.sin(y * .086 + x * .043) * .09;
      const hill = Math.sin(x * .044 - y * .031) * .34 + Math.cos(y * .059 + x * .046) * .34;
      const detail = Math.sin(x * .22 + y * .33) * Math.cos(y * .13 - x * .27);
      const land = ridge + coast + detail * .022;
      const z = Math.max(0, Math.min(166, Math.floor(Math.pow(Math.max(0, land), 1.38) * (104 + hill * 75))));
      const at = y * MAP_SIZE + x;
      height[at] = z;
      const grain = (rng() - .5) * 10;
      let color;
      if (land < 0) {
        ocean[at] = 1;
        const swell = Math.sin(x * .042 + y * .014) * Math.cos(y * .027);
        color = land > -.025 ? palette.foam : land > -.1 ? palette.shoal :
          land > -.24 ? palette.shelf : swell > .53 ? palette.deep : palette.sea;
        if (rng() > .982 && swell > -.66) color = [81, 153, 194];
      } else if (land < .062) {
        color = palette.sand;
      } else if (z > 101) {
        color = palette.rock[clamp(Math.floor((z - 101) / 12), 0, 2)];
      } else if (hill + detail * .25 < -.15 && land > .19) {
        color = palette.woods[clamp(Math.floor((detail + 1) * 1.5), 0, 2)];
      } else {
        color = palette.grass[clamp(Math.floor(z / 28), 0, 3)];
      }
      const offset = at * 4;
      const shade = z > 9 && z % 13 === 0 ? grain - 11 : grain;
      pixels[offset] = color[0] + shade;
      pixels[offset + 1] = color[1] + shade;
      pixels[offset + 2] = color[2] + shade;
      pixels[offset + 3] = 255;
    }
  }
  // Luz do noroeste. Amostrar alguns texels à frente preserva as curvas do relevo.
  for (let y = 0; y < MAP_SIZE; y++) {
    for (let x = 0; x < MAP_SIZE; x++) {
      const i = y * MAP_SIZE + x;
      if (ocean[i] || height[i] < 5) continue;
      const nw = ((y + MAP_SIZE - 3) % MAP_SIZE) * MAP_SIZE + (x + MAP_SIZE - 3) % MAP_SIZE;
      const se = ((y + 3) % MAP_SIZE) * MAP_SIZE + (x + 3) % MAP_SIZE;
      const light = clamp((height[se] - height[nw]) * 2.1, -35, 33);
      pixels[i * 4] += light * 1.14;
      pixels[i * 4 + 1] += light;
      pixels[i * 4 + 2] += light * .64;
    }
  }
  map.putImageData(art, 0, 0);
  const index = (x, y) => Math.floor(wrap(y) / MAP_SCALE) * MAP_SIZE + Math.floor(wrap(x) / MAP_SCALE);
  function groundHeight(x, y) {
    const mx = wrap(x - MAP_SCALE / 2) / MAP_SCALE;
    const my = wrap(y - MAP_SCALE / 2) / MAP_SCALE;
    const col = Math.floor(mx), row = Math.floor(my);
    const nextCol = (col + 1) % MAP_SIZE;
    const top = row * MAP_SIZE;
    const bottom = ((row + 1) % MAP_SIZE) * MAP_SIZE;
    return lerp(
      lerp(height[top + col], height[top + nextCol], mx - col),
      lerp(height[bottom + col], height[bottom + nextCol], mx - col),
      my - row);
  }
  const clouds = Array.from({length: 110}, () => {
    const seed = Math.floor(rng() * 2 ** 32);
    const size = 29 + rng() * 67;
    return {
      x: rng() * WORLD_SIZE, y: rng() * WORLD_SIZE, z: 135 + rng() * 245,
      size, art: cloudSprite(seed), shadow: cloudSprite(seed, true)
    };
  });
  const shadows = surface(MAP_SIZE, MAP_SIZE);
  for (const cloud of clouds) {
    const w = Math.round(cloud.size * 1.6 / MAP_SCALE);
    const x = Math.round(wrap(cloud.x + cloud.z * .2) / MAP_SCALE - w / 2);
    const y = Math.round(wrap(cloud.y + cloud.z * .17) / MAP_SCALE - w / 3);
    const h = Math.round(w * .68);
    const xs = [x];
    const ys = [y];
    if (x < 0 || x + w > MAP_SIZE) xs.push(x < 0 ? x + MAP_SIZE : x - MAP_SIZE);
    if (y < 0 || y + h > MAP_SIZE) ys.push(y < 0 ? y + MAP_SIZE : y - MAP_SIZE);
    for (const sx of xs) for (const sy of ys) shadows.drawImage(cloud.shadow, sx, sy, w, h);
  }
  const shadowPixels = shadows.getImageData(0, 0, MAP_SIZE, MAP_SIZE).data;
  const cloudShade = Uint8Array.from(height, (_, i) => shadowPixels[i * 4 + 3] ? 1 : 0);
  const spray = Array.from({length: 1950}, () => [rng() * WORLD_SIZE, rng() * WORLD_SIZE, rng()]);
  const treeRng = randomSeed(31429);
  const trees = [];
  const treeArt = ['#277047', '#387f41', '#326742'].map(treeSprite);
  for (let y = 4; y < MAP_SIZE; y += 8) {
    for (let x = 4; x < MAP_SIZE; x += 8) {
      const tx = (x + treeRng() * 8 - 4) * MAP_SCALE;
      const ty = (y + treeRng() * 8 - 4) * MAP_SCALE;
      const at = index(tx, ty);
      if (ocean[at] || height[at] < 6 || height[at] > 105 || treeRng() < .32) continue;
      trees.push({x: tx, y: ty, z: height[at], size: 13 + treeRng() * 12,
        art: treeArt[Math.floor(treeRng() * treeArt.length)]});
    }
  }
  return {map: map.canvas, height, pixels, ocean, index, groundHeight, clouds, cloudShade, spray, trees};
}

function treeSprite(green) {
  const ctx = surface(28, 36);
  const rng = randomSeed(121);
  ctx.fillStyle = '#674831';
  ctx.fillRect(12, 18, 5, 17);
  ctx.fillStyle = '#9d8056';
  ctx.fillRect(12, 23, 2, 10);
  const foliage = [[13, 7, 7, 7], [19, 12, 8, 8], [7, 14, 7, 9], [14, 20, 9, 10]];
  for (let y = 0; y < 31; y++) {
    for (let x = 0; x < 28; x++) {
      const density = Math.max(...foliage.map(([cx, cy, rx, ry]) =>
        1 - ((x - cx) / rx) ** 2 - ((y - cy) / ry) ** 2));
      if (density < rng() * .28) continue;
      const tone = density + (15 - y) * .045 - x * .022 + rng() * .43;
      ctx.fillStyle = tone > .97 ? '#829557' : tone > .62 ? '#5a7e46' :
        tone > .26 ? green : tone > -.15 ? '#305740' : '#264737';
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return ctx.canvas;
}

function cloudSprite(seed, shadow = false) {
  const rng = randomSeed(seed);
  const ctx = surface(66, 45);
  const puff = Array.from({length: 12}, (_, i) => ({
    x: 10 + i * 4 + rng() * 4, y: 27 - Math.sin(i * .31) * 11 + rng() * 10,
    r: 5 + rng() * 8
  }));
  const colors = ['#819cba', '#a4bbd2', '#c4d8e8', '#edf6fa', '#fffdf4'];
  const grain = randomSeed(seed ^ 313);
  for (let y = 0; y < 45; y++) {
    for (let x = 0; x < 66; x++) {
      let density = 0;
      for (const p of puff) {
        const d = Math.hypot(x - p.x, (y - p.y) * 1.16) / p.r;
        if (d < 1) density = Math.max(density, (1 - d) * .52 + (p.y - y) * .063 + .4);
      }
      if (density <= 0) continue;
      const bands = (y % 3 === 0 ? .036 : 0) + grain() * .095;
      ctx.fillStyle = shadow ? '#123d79' : colors[clamp(Math.floor((density + bands) * 5), 0, 4)];
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return ctx.canvas;
}

// Cada entrada representa uma fatia horizontal na altura z.
const AIRCRAFT_MODELS = {
  falcao(x, y, z) {
    const bodyWidth = Math.min((18 - y) * .39, 5 - Math.max(0, -y - 5) * .35);
    const body = y >= -15 && x <= bodyWidth && z <= (x <= 2 && y < 12 ? 4 : 2);
    const leadingEdge = 13 - x * 1.36;
    const trailingEdge = x < 10 ? -5 - x * .51 : -10 - (x - 10) * .66;
    const wing = x >= 3 && y >= trailingEdge && y <= leadingEdge && z <= (x <= 6 ? 3 : 2);
    const engine = y >= -18 && y <= -4 && Math.abs(x - 5) <= (y < -14 ? 1 : 2) && z <= 4;
    const stabilizer = x >= 5 && x <= 9 && y >= -18 && y <= -12 - (x - 5) * .7 && z <= 1;
    const fin = x >= 6 && x <= 7 && y >= -17 && y <= -9 - z * .7 && z >= 3 && z <= 7;
    const canopyWidth = Math.min(2, (13 - y) * .63, (y - 1) * .8);
    if (x <= canopyWidth && z >= 4 && z <= (y >= 4 && y <= 10 ? 6 : 5)) {
      if (z >= 5 && x === 0 && y >= 6) return '#b5f7ff';
      return z >= 5 ? '#58c9e6' : '#24738f';
    }
    if (y === -18 && engine) return z >= 1 && z <= 3 ? '#111726' : '#536687';
    if ((wing && x >= 12) || (fin && (z === 7 || y <= -16)) || (stabilizer && x >= 8)) {
      return ['#9d442c', '#db672d', '#ff9e38', '#ffc064'][Math.min(z, 3)];
    }
    if (engine && z === 4 && y === -13) return '#334568';
    if (wing && z === 3 && x >= 5 && y >= -5 && y <= leadingEdge - 1) return '#536b9c';
    if (wing && z === 2 && y > leadingEdge - 1 && x > 6) return '#7f95bf';
    if (wing || stabilizer || fin || engine || body) return 'hull';
  },
  droneA(x, y, z) {
    const core = x <= 7 - Math.abs(y) * .39 && z <= (x <= 3 && Math.abs(y) <= 8 ? 5 : 3);
    const shoulders = x >= 4 && x <= 14 && y >= -7 && y <= 10 - x * .75 && z <= 2;
    if (core && z === 5 && x * x + (y - 1) ** 2 <= 11) {
      return x <= 1 && Math.abs(y - 1) <= 1 ? '#ffc1eb' : '#f83d93';
    }
    if (shoulders && z === 2 && x >= 8 && y >= -5 && y <= -2) return '#d92a79';
    if (core || shoulders) return 'hull';
  },
  droneB(x, y, z) {
    const core = x <= 4 && y >= -15 && y <= 2 && z <= (x < 3 ? 5 : 3);
    const inner = y < -3 ? 3 : 9 + y * .23;
    const outer = y < 3 ? 15 : 15 - (y - 3) * .29;
    const arm = y >= -10 && y <= 17 && x >= inner && x <= outer && z <= 2;
    if (core && z === 5 && x <= 1 && y >= -3 && y <= 0) return '#ff77b6';
    if (arm && z === 2 && x < inner + 2 && y <= 10) return '#e93687';
    if (core || arm) return 'hull';
  },
  droneC(x, y, z) {
    const core = x <= Math.min(7, 11 - Math.abs(y) * .37) && z <= (x < 5 ? 5 : 4);
    const pod = x >= 6 && x <= 15 && y >= -6 && y <= 7 && z <= (x >= 14 ? 2 : 3);
    if (core && x >= 2 && x <= 4 && y >= 5 && y <= 7 && z === 5) return '#ff6ba9';
    if (pod && x >= 10 && x <= 13 && y >= 4 && y <= 5 && z === 3) return '#df367c';
    if (core || pod) return 'hull';
  }
};

function aircraftSlices(model) {
  const layers = [];
  const shape = AIRCRAFT_MODELS[model];
  const palette = model === 'falcao'
    ? ['#18243c', '#2c3c60', '#485e8a', '#637baa', '#8b9fc6']
    : ['#211a33', '#36294b', '#524066', '#6c5483', '#8e72a2'];
  for (let z = 0; z <= 7; z++) {
    const slice = [];
    for (let y = -18; y <= 18; y++) {
      for (let x = -15; x <= 15; x++) {
        const material = shape(Math.abs(x), y, z);
        if (!material) continue;
        const color = material === 'hull' ? palette[Math.min(z, palette.length - 1)] : material;
        const rgb = Number.parseInt(color.slice(1), 16);
        slice.push({x, y, z: z - 2, color: rgba(rgb >> 16, (rgb >> 8) & 255, rgb & 255)});
      }
    }
    layers.push(slice);
  }
  return layers;
}

function aircraftProjection(yaw, pitch, roll, overhead) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const elevation = overhead ? Math.PI / 2 : .50;
  const ce = Math.cos(elevation), se = Math.sin(elevation);
  return (x, y, z, point) => {
    const across = x * cr + z * sr;
    const up = z * cr - x * sr;
    const forward = y * cp - up * sp;
    const vertical = y * sp + up * cp;
    const depth = forward * cy - across * sy;
    point.x = across * cy + forward * sy;
    point.y = -depth * se - vertical * ce;
    point.depth = depth * ce - vertical * se;
    return point;
  };
}

function aircraftSprite(slices, yaw, pitch, roll, overhead) {
  const ctx = surface(54, 54);
  const image = ctx.createImageData(54, 54);
  const pixels = new Uint32Array(image.data.buffer);
  const points = new Uint32Array(pixels.length);
  const zBuffer = new Float32Array(pixels.length).fill(Infinity);
  const texelOffsets = [0, 1, 54, 55];
  const project = aircraftProjection(yaw, pitch, roll, overhead);
  const point = {};
  for (const slice of slices) {
    for (const p of slice) {
      project(p.x, p.y, p.z, point);
      const x = 27 + Math.round(point.x);
      const y = 27 + Math.round(point.y);
      const order = point.depth;
      for (const offset of texelOffsets) {
        const i = y * 54 + x + offset;
        if (order >= zBuffer[i]) continue;
        zBuffer[i] = order;
        points[i] = p.color;
      }
    }
  }
  const outline = rgba(16, 31, 45);
  for (let i = 55; i < points.length - 55; i++) {
    if (!points[i]) continue;
    pixels[i] = points[i];
    if (!points[i - 1]) pixels[i - 1] = outline;
    if (!points[i + 1]) pixels[i + 1] = outline;
    if (!points[i - 54]) pixels[i - 54] = outline;
    if (!points[i + 54]) pixels[i + 54] = outline;
  }
  ctx.putImageData(image, 0, 0);
  return ctx.canvas;
}
