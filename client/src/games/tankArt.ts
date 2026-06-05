/**
 * tankArt.ts — Tank sprite generation for terminal-based tank game
 *
 * Exports:
 *  - getTankSprite(angle, facingRight)  → sprite cells for rendering a tank
 *  - getTrajectoryPreview(...)          → dotted trajectory points
 *  - getAngleIndicator(angle)           → text string with arrow + angle
 *
 * No external dependencies — pure TypeScript.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

interface SpriteCell {
  dx: number;
  dy: number;
  char: string;
}

// ─── Barrel angle configurations (right-facing baseline) ─────────────────────
//
// Coordinates are relative to tank centre (0, 0).
//   dy = -2  → turret dome row
//   dy =  0  → hull-body / viewport row (centre)
//   dy =  2  → treads
//
// Barrel segments extend above / beside the turret.
// For low angles the barrel exits the SIDE of the turret dome (dy = -2).
// For steep angles it exits the TOP (dy = -3 and above).

type Seg = [number, number, string]; // [dx, dy, char]

interface BarrelConfig {
  min: number;
  max: number;
  cells: Seg[];
}

const BARREL_RIGHT: BarrelConfig[] = [
  //  0°  – horizontal right (barrel exits turret right edge)
  { min: 0,   max: 8,   cells: [[3,-2,'━'],[4,-2,'━'],[5,-2,'━'],[6,-2,'━']] },
  // ~15° – slight upward-right
  { min: 9,   max: 20,  cells: [[3,-2,'━'],[4,-2,'━'],[5,-3,'╱']] },
  // ~30° – moderate upward-right
  { min: 21,  max: 34,  cells: [[3,-2,'━'],[4,-3,'╱'],[5,-4,'╱']] },
  // ~45° – diagonal up-right
  { min: 35,  max: 52,  cells: [[2,-3,'╱'],[3,-4,'╱'],[4,-5,'╱']] },
  // ~60° – steep upward-right
  { min: 53,  max: 67,  cells: [[2,-3,'╱'],[2,-4,'┃'],[2,-5,'┃']] },
  // ~75° – near-vertical, slight right lean
  { min: 68,  max: 78,  cells: [[1,-3,'┃'],[1,-4,'┃'],[2,-5,'╱']] },
  //  90° – vertical
  { min: 79,  max: 101, cells: [[0,-3,'┃'],[0,-4,'┃'],[0,-5,'┃']] },
  // ~105° – near-vertical, slight left lean
  { min: 102, max: 112, cells: [[-1,-3,'┃'],[-1,-4,'┃'],[-2,-5,'╲']] },
  // ~120° – steep upward-left
  { min: 113, max: 127, cells: [[-2,-3,'╲'],[-2,-4,'┃'],[-2,-5,'┃']] },
  // ~135° – diagonal up-left
  { min: 128, max: 145, cells: [[-2,-3,'╲'],[-3,-4,'╲'],[-4,-5,'╲']] },
  // ~150° – moderate upward-left
  { min: 146, max: 159, cells: [[-3,-2,'━'],[-4,-3,'╲'],[-5,-4,'╲']] },
  // ~165° – slight upward-left
  { min: 160, max: 171, cells: [[-3,-2,'━'],[-4,-2,'━'],[-5,-3,'╲']] },
  // 180° – horizontal left
  { min: 172, max: 180, cells: [[-3,-2,'━'],[-4,-2,'━'],[-5,-2,'━'],[-6,-2,'━']] },
];

// ─── Internal helpers ────────────────────────────────────────────────────────

function getBarrelCells(angle: number, facingRight: boolean): SpriteCell[] {
  const a = Math.max(0, Math.min(180, Math.round(angle)));

  // Find the barrel configuration that matches the angle
  let matched: Seg[] = BARREL_RIGHT[6].cells; // fallback → vertical
  for (const cfg of BARREL_RIGHT) {
    if (a >= cfg.min && a <= cfg.max) {
      matched = cfg.cells;
      break;
    }
  }

  if (facingRight) {
    return matched.map(([dx, dy, ch]) => ({ dx, dy, char: ch }));
  }

  // Mirror for left-facing tank: negate dx, swap diagonal characters
  return matched.map(([dx, dy, ch]) => {
    let mc = ch;
    if (ch === '╱') mc = '╲';
    else if (ch === '╲') mc = '╱';
    return { dx: -dx, dy, char: mc };
  });
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Generate a tank sprite as an array of character cells.
 *
 * The tank body is 7 characters wide (dx -3 … +3) and 5 rows tall
 * (dy -2 … +2), plus barrel segments that extend above/beside the turret.
 *
 * Layout (facing right, 45° barrel):
 * ```
 *         ╱        barrel tip   (dy -5)
 *        ╱         barrel mid   (dy -4)
 *       ╱          barrel base  (dy -3)
 *  ▄███▄           turret dome  (dy -2)
 * ▟█████▙          sloped armour(dy -1)
 * ████◉██          hull body    (dy  0)  ← centre
 * ▐▄▄▄▄▄▌         hull bottom  (dy  1)
 * ●═●═●═●          treads       (dy  2)
 * ```
 *
 * @param angle       Barrel elevation 0-180° (0 = forward-horizontal, 90 = up)
 * @param facingRight true → tank faces right; false → mirrored to face left
 * @returns Array of { dx, dy, char } relative to tank centre (0, 0)
 */
export function getTankSprite(
  angle: number,
  facingRight: boolean,
): { dx: number; dy: number; char: string }[] {
  const sprites: SpriteCell[] = [];

  // ── Turret dome  (dy = -2, 5 chars centred) ───────────────────────────
  const turret = ['▄', '█', '█', '█', '▄'];
  for (let i = 0; i < turret.length; i++) {
    sprites.push({ dx: i - 2, dy: -2, char: turret[i] });
  }

  // ── Hull top – sloped armour  (dy = -1, 7 chars) ─────────────────────
  const hullTop = ['▟', '█', '█', '█', '█', '█', '▙'];
  for (let i = 0; i < hullTop.length; i++) {
    sprites.push({ dx: i - 3, dy: -1, char: hullTop[i] });
  }

  // ── Hull body with viewport  (dy = 0, 7 chars) ───────────────────────
  // The viewport (◉) is offset toward the front of the tank
  const viewportDx = facingRight ? 1 : -1;
  for (let i = 0; i < 7; i++) {
    const dx = i - 3;
    sprites.push({ dx, dy: 0, char: dx === viewportDx ? '◉' : '█' });
  }

  // ── Hull bottom  (dy = 1, 7 chars) ───────────────────────────────────
  const hullBot = ['▐', '▄', '▄', '▄', '▄', '▄', '▌'];
  for (let i = 0; i < hullBot.length; i++) {
    sprites.push({ dx: i - 3, dy: 1, char: hullBot[i] });
  }

  // ── Treads  (dy = 2, 7 chars) ────────────────────────────────────────
  const treads = ['●', '═', '●', '═', '●', '═', '●'];
  for (let i = 0; i < treads.length; i++) {
    sprites.push({ dx: i - 3, dy: 2, char: treads[i] });
  }

  // ── Barrel  (angle-dependent, extends from turret) ────────────────────
  sprites.push(...getBarrelCells(angle, facingRight));

  return sprites;
}

/**
 * Calculate a trajectory preview (dotted arc) for the aiming UI.
 * Uses the **exact same physics model** as the server.
 *
 * @param startX       Projectile launch x (screen column)
 * @param startY       Projectile launch y (screen row, 0 = top)
 * @param angle        Launch angle in degrees (world coordinates:
 *                     0 = right, 90 = up, 180 = left)
 * @param power        Launch power (server scale)
 * @param wind         Wind value (positive = rightward)
 * @param terrain      Array where terrain[x] = ground height from bottom
 * @param terrainHeight Total screen height in rows
 * @param terrainWidth  Total screen width in columns
 * @returns Up to 30 { x, y } screen positions (every 3rd physics step)
 */
export function getTrajectoryPreview(
  startX: number,
  startY: number,
  angle: number,
  power: number,
  wind: number,
  terrain: number[],
  terrainHeight: number,
  terrainWidth: number,
): { x: number; y: number }[] {
  const angleRad = angle * Math.PI / 180;
  const v0 = power * 0.4;
  const v0x = v0 * Math.cos(angleRad);
  const v0y = v0 * Math.sin(angleRad);
  const windAccel = wind * 0.12;
  const dt = 0.12;

  const points: { x: number; y: number }[] = [];

  for (let i = 1; i < 500; i++) {
    const t = i * dt;
    const x = startX + v0x * t + 0.5 * windAccel * t * t;
    const y = startY - v0y * t + 0.5 * 9.8 * t * t;

    const ix = Math.round(x);
    const iy = Math.round(y);

    // ── Stop conditions ──

    // Horizontal out-of-bounds
    if (ix < 0 || ix >= terrainWidth) break;

    // Fallen below the screen
    if (iy >= terrainHeight) break;

    // Terrain collision (terrain[col] = height measured from bottom)
    const terrainH = ix >= 0 && ix < terrain.length ? terrain[ix] : 0;
    const surfaceY = terrainHeight - terrainH;
    if (iy >= surfaceY) break;

    // Keep every 3rd point for a dotted-line effect, skip if above screen
    if (i % 3 === 0 && iy >= 0) {
      points.push({ x: ix, y: iy });
      if (points.length >= 30) break;
    }
  }

  return points;
}

/**
 * Return a compact one-line text indicator for the current barrel angle.
 *
 * @example
 *   getAngleIndicator(0)   // "→ 0°"
 *   getAngleIndicator(30)  // "↗ 30°"
 *   getAngleIndicator(45)  // "⟋ 45°"
 *   getAngleIndicator(90)  // "⬆ 90°"
 *   getAngleIndicator(135) // "↖ 135°"
 *   getAngleIndicator(180) // "← 180°"
 */
export function getAngleIndicator(angle: number): string {
  const a = Math.max(0, Math.min(180, Math.round(angle)));
  let arrow: string;

  if (a <= 10)       arrow = '→';
  else if (a <= 35)  arrow = '↗';
  else if (a <= 55)  arrow = '⟋';
  else if (a <= 80)  arrow = '↑';
  else if (a <= 100) arrow = '⬆';
  else if (a <= 125) arrow = '↑';
  else if (a <= 155) arrow = '↖';
  else if (a <= 170) arrow = '↖';
  else               arrow = '←';

  return `${arrow} ${a}°`;
}
