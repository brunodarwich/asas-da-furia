'use strict';

const characterPalettes = {
  pilot: ['#394c43', '#788576', '#b2ad91', '#c47d44', '#edb577'],
  patrol: ['#4b453b', '#777461', '#a8a087', '#885941', '#bc8663'],
  allied: ['#30423e', '#586d61', '#899988', '#47796d', '#a2c2ad'],
  rival: ['#493c30', '#736654', '#a29979', '#895739', '#ca9b72']
};

function paintedShape(ctx, color, points) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(...points[0]);
  for (const point of points.slice(1)) ctx.lineTo(...point);
  ctx.closePath();
  ctx.fill();
}

function pixelArt(width, height, draw) {
  const image = document.createElement('canvas');
  image.width = width;
  image.height = height;
  draw(image.getContext('2d'));
  return image;
}

function makeCharacterArt(palette) {
  const [shade, cloth, light, accent, trim] = characterPalettes[palette];
  const ink = '#191f21';
  const poses = Array.from({length: 8}, (_, direction) => {
    const angle = direction * Math.PI / 4;
    const side = Math.round(Math.sin(angle) * 5);
    const front = Math.cos(angle) > .3;
    const back = Math.cos(angle) < -.3;
    const rifle = palette !== 'pilot';
    return [0, 1, 2, 3].map(pose => pixelArt(48, 64, ctx => {
      const shape = (color, points) => paintedShape(ctx, color, points);
      const rect = (color, x, y, w, h) => {
        ctx.fillStyle = color;
        ctx.fillRect(x, y, w, h);
      };
      const crouch = pose === 3;
      const stride = pose === 1 ? -5 : pose === 2 ? 5 : 0;
      const body = crouch ? 12 : Math.abs(stride) > 0 ? 1 : 0;
      const narrow = Math.abs(side) > 4 ? 3 : 0;
      const far = 15 + narrow;
      const near = 25 - narrow;
      for (const [hip, step, tone] of [[far, stride, shade], [near, -stride, cloth]]) {
        const knee = hip + Math.round(step * .65) + (crouch ? side : 0);
        const foot = hip + step + (crouch ? -side : 0);
        shape(ink, [[hip-2,36+body],[hip+8,36+body],[knee+7,51],[foot+7,62],
          [foot-3,62],[knee-3,53]]);
        shape(tone, [[hip,38+body],[hip+6,38+body],[knee+5,51],[foot+5,58],
          [foot,58],[knee-1,52]]);
        rect(shade, knee, 51, 4, 3);
        rect(ink, foot-2, 59, 10, 4);
        rect('#53534a', foot-1, 59, 6, 1);
      }
      ctx.save();
      ctx.translate(0, body);
      shape(ink, [[15+narrow,17],[31,17],[37-narrow,23],[36-narrow,34],[32,38],[31,41],
        [16,41],[14,36],[10+narrow,32],[10+narrow,24]]);
      shape(cloth, [[15+narrow,19],[30,19],[34-narrow,23],[32,30],[30,37],
        [17,37],[15,32],[12+narrow,29],[12+narrow,24]]);
      shape(shade, [[17,22],[30,21],[31,34],[29,38],[16,37],[16,29]]);
      rect(light, 15+narrow, 20, 13-narrow, 2);
      rect(accent, 12+narrow, 24, 5, 3);
      rect(trim, 13+narrow, 24, 3, 1);
      if (back) {
        rect(shade, 15, 19, 3, 15);
        rect(shade, 31, 19, 3, 15);
        shape(ink, [[19,21],[29,21],[33,24],[33,35],[30,38],[18,38],[16,35],[16,24]]);
        shape(cloth, [[19,23],[29,23],[31,25],[31,34],[29,36],[19,36],[18,34],[18,25]]);
        rect(light, 20, 23, 8, 1);
        rect(shade, 19, 29, 11, 2);
        rect(accent, 19, 32, 11, 3);
        rect(trim, 21, 32, 6, 1);
        rect(ink, 31, 19, 1, 11);
      } else {
        rect(ink, 18, 23, 2, 13);
        rect(ink, 27, 22, 2, 13);
        rect(light, 21, 24, 5, 2);
        rect(cloth, 20, 31, 9, 4);
        rect(ink, 24, 31, 1, 4);
      }
      rect(ink, 15, 37, 17, 3);
      rect('#908572', 23, 37, 3, 2);
      const head = 24 + Math.round(side * .55);
      shape(ink, [[head-8,8],[head-5,4],[head+4,4],[head+8,8],[head+8,13],
        [head+5,18],[head-4,18],[head-7,14]]);
      shape(shade, [[head-7,9],[head-4,5],[head+4,5],[head+7,9],[head+6,12],[head-7,12]]);
      rect(light, head-4, 6, 7, 1);
      rect(cloth, head-6, 8, 9, 2);
      if (back) {
        rect(cloth, head-5, 11, 10, 3);
        rect(shade, head-4, 14, 8, 2);
        rect(ink, head-2, 14, 4, 1);
      } else {
        const visor = front ? head-5 : side > 0 ? head : head-7;
        rect('#242c30', visor, 11, front ? 10 : 7, 3);
        rect('#738688', visor+1, 11, front ? 7 : 4, 1);
        rect('#a08067', visor+2, 14, 4, 2);
      }
      ctx.save();
      if (side < 0) {
        ctx.translate(48, 0);
        ctx.scale(-1, 1);
      }
      const muzzle = rifle ? 47 : 43;
      const reach = Math.abs(side) > 1 ? 0 : -5;
      const carry = back ? 7 : 0;
      ctx.translate(reach, carry);
      shape(ink, [[29,23],[36,23],[38,28],[35,34],[26,34],[25,30],[32,28]]);
      shape(cloth, [[30,24],[35,24],[36,28],[33,32],[27,32],[27,30],[33,28]]);
      rect('#464a40', 32, 27, 5, 4);
      rect(ink, 34, 24, muzzle-34, 4);
      rect('#677376', 35, 24, muzzle-36, 1);
      rect('#4b5453', 35, 26, rifle ? 8 : 5, 1);
      rect(ink, 36, 27, 3, 4);
      ctx.restore();
      ctx.restore();
    }));
  });

  const overhead = [0, -1, 1, 2].map(step => pixelArt(22, 24, ctx => {
    const shape = (color, points) => paintedShape(ctx, color, points);
    shape(ink, [[5,8],[16,8],[20,12],[17,18],[16,22-step],[12,22-step],
      [11,17],[10,22+step],[6,22+step],[5,16],[2,13]]);
    shape(cloth, [[5,9],[16,9],[18,13],[15,17],[7,17],[4,13]]);
    shape(shade, [[6,13],[15,13],[15,17],[7,17]]);
    shape(accent, [[6,13],[15,13],[14,15],[7,15]]);
    shape(ink, [[6,5],[9,2],[13,2],[16,5],[16,10],[13,12],[8,12],[6,9]]);
    shape(cloth, [[7,5],[9,3],[13,3],[15,5],[14,8],[8,8]]);
    shape(light, [[9,4],[13,4],[14,5],[8,5]]);
    shape(ink, [[16,10],[17,5],[19,5],[19,12],[17,13]]);
  }));

  return {poses, overhead};
}

function makeHeldWeaponArt(weapon, pilot = false) {
  const compact = weapon === 'pistol';
  const rifle = weapon === 'rifle';
  const muzzle = compact ? [34, 15] : rifle ? [10, 6] : [20, 10];
  const [mx, my] = muzzle;
  const glove = pilot ? '#61594b' : '#474d42';
  const sleeve = pilot ? '#4b5b50' : '#3e5249';
  const image = pixelArt(115, 88, ctx => {
    const shape = (color, points) => paintedShape(ctx, color, points);
    shape('#192222', [[40,88],[26,65],[28,56],[49,47],[64,53],[79,71],[115,85],[115,88]]);
    shape(sleeve, [[41,88],[30,65],[35,59],[47,61],[53,68],[71,88]]);
    shape('#252e2b', [[33,66],[51,64],[57,71],[38,75]]);
    shape('#798175', [[36,61],[48,59],[52,63],[38,65]]);
    shape(glove, [[31,58],[36,49],[47,43],[59,49],[60,56],[49,63],[41,60]]);
    shape('#827b69', [[35,55],[39,50],[48,47],[52,49],[45,53],[42,57]]);
    shape('#151c20', [[mx-2,my+1],[mx+13,my-3],[77,37],[89,50],[85,60],
      [76,61],[70,54],[67,70],[56,65],[55,49],[mx-2,my+12]]);
    shape('#667479', [[mx,my+1],[mx+13,my-1],[79,40],[74,45],[mx,my+7]]);
    shape('#373f40', [[mx,my+7],[74,45],[79,42],[85,49],[74,54],[mx,my+12]]);
    shape('#899795', [[mx+3,my+2],[mx+12,my+1],[67,36],[69,38],[mx+5,my+4]]);
    shape('#222c2c', [[59,39],[78,47],[80,53],[74,55],[65,49],[62,63],[57,61]]);
    for (let i = 0; i < (compact ? 4 : 6); i++) {
      const x = 57 + i * 3;
      const y = 38 + Math.round(i * 1.8);
      shape('#1d272a', [[x,y],[x+2,y+1],[x+1,y+5],[x-1,y+4]]);
    }
    if (!compact) {
      shape('#2c3332', [[mx+14,my+5],[mx+37,my+17],[mx+34,my+24],[mx+12,my+12]]);
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = '#6e7872';
        ctx.fillRect(mx+15+i*4, my+8+i*2, 4, 1);
      }
      shape('#303b3b', [[53,45],[65,50],[60,67],[rifle ? 48 : 53,65]]);
      if (rifle) shape('#1b2527', [[44,20],[48,16],[57,21],[57,27],[52,27]]);
    }
    shape('#211f1c', [[61,55],[69,51],[77,55],[81,64],[105,88],[76,88],[64,72]]);
    shape(glove, [[62,57],[69,53],[76,57],[77,64],[70,71],[65,68]]);
    shape('#a0967c', [[63,58],[69,54],[73,56],[68,61],[64,62]]);
    shape('#242d29', [[70,72],[79,65],[85,72],[77,80]]);
    shape(sleeve, [[77,80],[86,73],[103,88],[84,88]]);
    ctx.fillStyle = '#b8c2ad';
    ctx.fillRect(mx+4, my-1, 3, 2);
  });
  const loadingHand = pixelArt(47, 52, ctx => {
    paintedShape(ctx, '#222c28', [[0,51],[8,30],[15,24],[24,26],[28,37],[23,51]]);
    paintedShape(ctx, sleeve, [[2,51],[11,31],[17,28],[24,29],[24,40],[19,51]]);
    paintedShape(ctx, '#272f30', [[22,25],[24,12],[35,13],[35,31],[33,35],[24,31]]);
    paintedShape(ctx, '#596262', [[25,14],[33,15],[32,27],[26,28]]);
    paintedShape(ctx, glove, [[14,24],[18,18],[24,18],[25,23],[31,22],[36,24],[35,29],
      [29,32],[23,32],[19,36],[13,32]]);
    paintedShape(ctx, '#918573', [[17,25],[19,21],[24,21],[23,25],[19,28]]);
  });
  return {image, muzzle, loadingHand};
}

function drawHeldWeaponArt(ctx, art, x, y, scale, recoil, reload, flash) {
  ctx.save();
  ctx.translate(Math.round(x + recoil * 6), Math.round(y - recoil * 8 + reload * 28));
  ctx.rotate(reload * .23 - recoil * .035);
  ctx.scale(scale, scale);
  ctx.drawImage(art.image, 0, 0);
  if (reload > .15) {
    ctx.drawImage(art.loadingHand, Math.round(6 + reload * 28), Math.round(88 - reload * 57));
  }
  if (flash) {
    const [mx, my] = art.muzzle;
    ctx.translate(mx, my + 5);
    paintedShape(ctx, '#e7a45b', [[2,0],[-3,5],[-13,3],[-9,0],[-19,-7],[-8,-5],[-9,-12],[-2,-6]]);
    paintedShape(ctx, '#fff0c3', [[1,1],[-4,2],[-11,-4],[-4,-3],[-6,-8]]);
  }
  ctx.restore();
}
