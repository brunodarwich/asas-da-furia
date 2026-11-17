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
  return {map: map.canvas, height, pixels, ocean, index, clouds, cloudShade, spray};
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
function aircraftSlices(drone) {
  const layers = [];
  for (let z = 0; z <= 7; z++) {
    const slice = [];
    for (let y = -18; y <= 18; y++) {
      for (let x = -15; x <= 15; x++) {
        const ax = Math.abs(x);
        const body = y >= -15 && y <= 18 && ax <= Math.min(4, Math.floor((18 - y) * .39));
        const wing = z <= 2 && ax <= 15 && ax >= 3 && y >= -12 + ax * .36 && y <= 11 - ax * 1.06;
        const tail = y < -9 && y >= -17 && ax <= 9 + (y + 15) * .7 && ax <= 10 && z <= 1;
        const fin = z >= 3 && ax >= 4 && ax <= 5 && y < -9 - (z - 3) * .5 && y > -17;
        const cabin = y > 1 && y < 11 && ax <= 2 && z >= 3 && z <= 5;
        if (!(wing || tail || fin || cabin || (body && z <= (ax > 2 ? 2 : 4)))) continue;
        let color = ['#182835', '#314659', '#557185', '#91a8b3'][Math.min(z, 3)];
        if (cabin) color = z === 5 ? (x === -1 ? '#c1f2eb' : '#65aab8') : '#316b82';
        if ((wing && ax >= 11) || fin || (y < -11 && ax <= 3)) {
          color = drone ? (z < 2 ? '#9f2846' : '#fb6772') : (z < 2 ? '#a7472e' : '#ffab58');
        } else if (!cabin && (x + y + z) % 9 === 0) {
          color = '#6d8794';
        }
        const rgb = Number.parseInt(color.slice(1), 16);
        slice.push({x, y, z: z - 2, color: rgba(rgb >> 16, (rgb >> 8) & 255, rgb & 255)});
      }
    }
    layers.push(slice);
  }
  return layers;
}

function aircraftSprite(slices, yaw, pitch, roll, overhead) {
  const ctx = surface(54, 54);
  const image = ctx.createImageData(54, 54);
  const pixels = new Uint32Array(image.data.buffer);
  const points = new Uint32Array(pixels.length);
  const zBuffer = new Float32Array(pixels.length).fill(Infinity);
  const texelOffsets = [0, 1, 54, 55];
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const elevation = overhead ? Math.PI / 2 : .50;
  const ce = Math.cos(elevation), se = Math.sin(elevation);
  for (const slice of slices) {
    for (const p of slice) {
      const across = p.x * cr + p.z * sr;
      const up = p.z * cr - p.x * sr;
      const forward = p.y * cp - up * sp;
      const vertical = p.y * sp + up * cp;
      const depth = forward * cy - across * sy;
      const x = 27 + Math.round(across * cy + forward * sy);
      const y = 27 + Math.round(-depth * se - vertical * ce);
      const order = depth * ce - vertical * se;
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
