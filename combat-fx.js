'use strict';

const reducedCombatMotion = matchMedia('(prefers-reduced-motion: reduce)');

const impactColors = {
  metal: ['#fff1b3', '#efa65c', '#e56e4c'],
  stone: ['#d6c7ab', '#a99881', '#736d63'],
  dirt: ['#e1c293', '#b49a6c', '#85714f'],
  water: ['#e2f5ef', '#a3d6de', '#619eb6'],
  actor: ['#ffdb93', '#ca9b64', '#766b58'],
  signal: ['#efffdf', '#b5efd4', '#78b8aa']
};

// Keep cosmetic randomness independent of projectile spread and bot decisions.
let combatFxSeed = 397035;
function combatFxRandom() {
  combatFxSeed = (Math.imul(combatFxSeed, 1664525) + 1013904223) >>> 0;
  return combatFxSeed / 4294967296;
}

function drawCombatFlash(ctx, x, y, radius, fade, color) {
  const r = Math.max(1, Math.round(radius));
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  ctx.globalAlpha *= fade * (reducedCombatMotion.matches ? .4 : .78);
  paintedShape(ctx, color, [[-r,0],[-r*.36,-r*.22],[-r*.28,-r*.72],[0,-r*.35],
    [r*.57,-r*.53],[r*.34,-r*.12],[r,0],[r*.36,r*.18],[r*.28,r*.62],[0,r*.28],[-r*.55,r*.45]]);
  ctx.fillStyle = '#fff7d2';
  ctx.fillRect(-r*.26, -r*.16, Math.max(1,r*.52), Math.max(1,r*.32));
  ctx.restore();
}

function drawCombatRing(ctx, x, y, radius, fade, color, flat = .64) {
  ctx.save();
  ctx.globalAlpha *= fade * (reducedCombatMotion.matches ? .33 : .68);
  ctx.strokeStyle = color;
  ctx.lineWidth = radius > 16 ? 2 : 1;
  ctx.beginPath();
  ctx.ellipse(Math.round(x), Math.round(y), Math.max(1,radius), Math.max(1,radius*flat), 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
