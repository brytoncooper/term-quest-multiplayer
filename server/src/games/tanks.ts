// ─── Types ───────────────────────────────────────────────────────────────────

export type ShellType = 'standard' | 'heavy' | 'cluster' | 'sniper' | 'napalm';

export interface ShellDefinition {
  cost: number;          // 0 = free
  damage: number;        // per-hit damage (napalm = per tick)
  blastRadius: number;
  /** -1 = infinite ammo (standard) */
  defaultAmmo: number;
  /** cluster sub-munitions */
  submunitions?: number;
  /** napalm ticks of burn damage */
  burnTicks?: number;
}

export const SHELL_DEFS: Record<ShellType, ShellDefinition> = {
  standard: { cost: 0,  damage: 20, blastRadius: 2, defaultAmmo: -1 },
  heavy:    { cost: 40, damage: 45, blastRadius: 4, defaultAmmo: 0 },
  cluster:  { cost: 60, damage: 30, blastRadius: 2, defaultAmmo: 0, submunitions: 3 },
  sniper:   { cost: 30, damage: 35, blastRadius: 1, defaultAmmo: 0 },
  napalm:   { cost: 55, damage: 15, blastRadius: 5, defaultAmmo: 0, burnTicks: 3 },
};

export const ALL_SHELL_TYPES: ShellType[] = ['standard', 'heavy', 'cluster', 'sniper', 'napalm'];

export interface Inventory {
  standard: number;
  heavy: number;
  cluster: number;
  sniper: number;
  napalm: number;
}

export interface BurnEffect {
  damagePerTick: number;
  ticksRemaining: number;
}

export interface PlayerState {
  id: string;
  name: string;
  hp: number;
  money: number;
  inventory: Inventory;
  x: number;
  y: number;
  color: string;
  burn?: BurnEffect;
}

export interface TrajectoryPoint {
  x: number;
  y: number;
}

export interface FireDetails {
  trajectory: TrajectoryPoint[];
  impact: TrajectoryPoint;
  shellType: ShellType;
  hit: boolean;
  damageDone: number;
  /** For cluster shells: sub-munition impacts */
  subImpacts?: { point: TrajectoryPoint; hit: boolean; damageDone: number }[];
  /** For napalm: how many burn ticks were applied */
  burnApplied?: number;
  /** Craters carved into the terrain (for client rendering) */
  craters: { x: number; depthReduction: number }[];
}

export interface TankGameState {
  status: 'waiting' | 'playing' | 'game_over';
  phase: 'buy' | 'fire' | 'animating';
  players: Record<string, PlayerState>;
  playerIds: string[];
  turnIndex: number;
  terrainWidth: number;
  terrainHeight: number;
  terrain: number[];       // terrain[x] = ground height from bottom
  wind: number;            // -5 … +5
  roundNumber: number;
  lastAction?: {
    playerId: string;
    type: string;
    details: any;
  };
  winner?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const TERRAIN_WIDTH = 80;
const TERRAIN_HEIGHT = 24;
const STARTING_HP = 100;
const STARTING_MONEY = 100;
const ROUND_INCOME = 30;
const GRAVITY = 9.8;
const VELOCITY_SCALE = 0.4;
const TIME_STEP = 0.12;
const MAX_TRAJECTORY_STEPS = 2000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function randInt(lo: number, hi: number): number {
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

function randFloat(lo: number, hi: number): number {
  return Math.random() * (hi - lo) + lo;
}

/**
 * Generate terrain using layered sine waves + midpoint displacement for variety.
 * Returns an array of length `width` where each value is the ground height
 * measured from the bottom (range roughly 3 … height-4).
 */
function generateTerrain(width: number, height: number): number[] {
  const terrain: number[] = new Array(width);
  const midHeight = height * 0.45;     // baseline ~45 % up
  const amplitude1 = height * 0.15;
  const amplitude2 = height * 0.08;
  const amplitude3 = height * 0.04;

  // Random phase offsets for each sine layer
  const phase1 = randFloat(0, Math.PI * 2);
  const phase2 = randFloat(0, Math.PI * 2);
  const phase3 = randFloat(0, Math.PI * 2);

  for (let x = 0; x < width; x++) {
    const t = x / width;
    let h = midHeight;
    h += amplitude1 * Math.sin(t * Math.PI * 2 * 1.3 + phase1);   // broad hills
    h += amplitude2 * Math.sin(t * Math.PI * 2 * 3.7 + phase2);   // medium bumps
    h += amplitude3 * Math.sin(t * Math.PI * 2 * 7.1 + phase3);   // fine detail
    terrain[x] = clamp(Math.round(h), 3, height - 4);
  }

  // Midpoint-displacement roughening pass
  midpointDisplace(terrain, 0, width - 1, 2.0, 3);

  // Final clamp
  for (let x = 0; x < width; x++) {
    terrain[x] = clamp(Math.round(terrain[x]), 3, height - 4);
  }

  return terrain;
}

function midpointDisplace(
  arr: number[],
  lo: number,
  hi: number,
  roughness: number,
  depth: number,
): void {
  if (depth <= 0 || hi - lo < 2) return;
  const mid = Math.floor((lo + hi) / 2);
  const avg = (arr[lo] + arr[hi]) / 2;
  arr[mid] = avg + randFloat(-roughness, roughness);
  midpointDisplace(arr, lo, mid, roughness * 0.6, depth - 1);
  midpointDisplace(arr, mid, hi, roughness * 0.6, depth - 1);
}

function randomWind(): number {
  return randInt(-5, 5);
}

/**
 * Convert terrain-bottom-height to screen-y for a tank sitting on column `x`.
 * Screen y=0 is top. Ground surface at column x is at row (terrainHeight - terrain[x]).
 * Tank sits one row above the surface.
 */
function tankScreenY(terrain: number[], x: number, terrainHeight: number): number {
  const col = clamp(x, 0, terrain.length - 1);
  return terrainHeight - terrain[col] - 1;
}

// ─── TanksGame ───────────────────────────────────────────────────────────────

export class TanksGame {
  public id: string;
  public state: TankGameState;

  constructor(id: string) {
    this.id = id;
    const terrain = generateTerrain(TERRAIN_WIDTH, TERRAIN_HEIGHT);
    this.state = {
      status: 'waiting',
      phase: 'buy',
      players: {},
      playerIds: [],
      turnIndex: 0,
      terrainWidth: TERRAIN_WIDTH,
      terrainHeight: TERRAIN_HEIGHT,
      terrain,
      wind: randomWind(),
      roundNumber: 1,
    };
  }

  // ── Player Management ────────────────────────────────────────────────────

  public addPlayer(playerId: string): void {
    if (this.state.playerIds.length >= 2) return;
    if (this.state.players[playerId]) return; // already joined

    const isPlayerOne = this.state.playerIds.length === 0;
    const startX = isPlayerOne ? 10 : 70;

    const inventory: Inventory = {
      standard: SHELL_DEFS.standard.defaultAmmo,
      heavy:    SHELL_DEFS.heavy.defaultAmmo,
      cluster:  SHELL_DEFS.cluster.defaultAmmo,
      sniper:   SHELL_DEFS.sniper.defaultAmmo,
      napalm:   SHELL_DEFS.napalm.defaultAmmo,
    };

    this.state.players[playerId] = {
      id: playerId,
      name: isPlayerOne ? 'Player 1' : 'Player 2',
      hp: STARTING_HP,
      money: STARTING_MONEY,
      inventory,
      x: startX,
      y: tankScreenY(this.state.terrain, startX, TERRAIN_HEIGHT),
      color: isPlayerOne ? 'cyan' : 'magenta',
    };
    this.state.playerIds.push(playerId);

    if (this.state.playerIds.length === 2) {
      this.state.status = 'playing';
      this.state.phase = 'buy';
      this.state.turnIndex = 0;
    }
  }

  public removePlayer(playerId: string): void {
    delete this.state.players[playerId];
    this.state.playerIds = this.state.playerIds.filter((id) => id !== playerId);

    if (this.state.playerIds.length === 1) {
      this.state.status = 'game_over';
      this.state.winner = this.state.playerIds[0];
    } else if (this.state.playerIds.length === 0) {
      this.state.status = 'game_over';
      this.state.winner = undefined;
    }

    // Fix turnIndex if it's now out of range
    if (this.state.playerIds.length > 0) {
      this.state.turnIndex = this.state.turnIndex % this.state.playerIds.length;
    }
  }

  // ── Input Dispatch ───────────────────────────────────────────────────────

  public handleInput(playerId: string, actionPayload: any): void {
    let action = actionPayload;
    if (typeof action === 'string') {
      try { action = JSON.parse(action); } catch { action = { type: action }; }
    }
    if (!action || typeof action !== 'object' || !action.type) return;

    if (this.state.status !== 'playing') return;

    // Ensure the current turn player still exists; skip if not
    this.skipRemovedPlayers();
    if (this.state.playerIds.length === 0) return;

    const currentTurnPlayerId = this.state.playerIds[this.state.turnIndex];
    if (playerId !== currentTurnPlayerId) return;

    const player = this.state.players[playerId];
    if (!player) return;

    switch (this.state.phase) {
      case 'buy':
        this.handleBuyPhase(player, action);
        break;
      case 'fire':
        this.handleFirePhase(player, playerId, action);
        break;
      case 'animating':
        this.handleAnimatingPhase(action);
        break;
    }
  }

  // ── Buy Phase ────────────────────────────────────────────────────────────

  private handleBuyPhase(player: PlayerState, action: any): void {
    if (action.type === 'buy') {
      const item = action.item as string;
      if (!this.isValidShellType(item)) return;
      if (item === 'standard') return; // can't buy standard, it's free & infinite

      const def = SHELL_DEFS[item as ShellType];
      if (player.money < def.cost) return;

      player.money -= def.cost;
      player.inventory[item as ShellType]++;
    } else if (action.type === 'end_buy') {
      this.state.phase = 'fire';
    }
  }

  // ── Fire Phase ───────────────────────────────────────────────────────────

  private handleFirePhase(player: PlayerState, playerId: string, action: any): void {
    if (action.type !== 'fire') return;

    const shellType = this.validateShellType(action.shellType);
    const angle = clamp(Number(action.angle) || 90, 0, 180);
    const power = clamp(Number(action.power) || 50, 1, 100);

    // Check ammo
    const ammo = player.inventory[shellType];
    if (ammo === 0) return;                        // no ammo (0 = none left)
    if (ammo > 0) player.inventory[shellType]--;   // -1 = infinite, don't decrement

    const def = SHELL_DEFS[shellType];

    // Starting position: from turret (one row above tank)
    const startX = player.x;
    const startY = player.y - 1;

    // Calculate trajectory with wind
    const trajectory = this.calculateTrajectory(startX, startY, angle, power);
    const impact = trajectory[trajectory.length - 1];

    // Find target
    const targetPlayerId = this.state.playerIds.find((id) => id !== playerId);
    const target = targetPlayerId ? this.state.players[targetPlayerId] : null;

    let totalDamage = 0;
    let hit = false;
    const craters: { x: number; depthReduction: number }[] = [];
    let subImpacts: FireDetails['subImpacts'] | undefined;
    let burnApplied: number | undefined;

    if (shellType === 'cluster' && def.submunitions) {
      // ── Cluster: sub-munitions spread from impact point ──────────────
      subImpacts = [];
      for (let i = 0; i < def.submunitions; i++) {
        const spreadX = impact.x + randInt(-4, 4);
        const clampedX = clamp(spreadX, 0, TERRAIN_WIDTH - 1);
        const groundY = TERRAIN_HEIGHT - this.state.terrain[clampedX];
        const subPoint: TrajectoryPoint = { x: clampedX, y: groundY };

        const subHitInfo = this.applyDamageAtPoint(subPoint, def.damage, def.blastRadius, target);
        this.craterTerrain(subPoint.x, def.blastRadius, craters);

        subImpacts.push({
          point: subPoint,
          hit: subHitInfo.hit,
          damageDone: subHitInfo.damageDone,
        });
        if (subHitInfo.hit) hit = true;
        totalDamage += subHitInfo.damageDone;
      }
    } else if (shellType === 'napalm' && def.burnTicks) {
      // ── Napalm: immediate small damage + apply burn DoT ─────────────
      const hitInfo = this.applyDamageAtPoint(impact, def.damage, def.blastRadius, target);
      hit = hitInfo.hit;
      totalDamage = hitInfo.damageDone;
      this.craterTerrain(impact.x, def.blastRadius, craters);

      if (target && hit) {
        target.burn = { damagePerTick: def.damage, ticksRemaining: def.burnTicks };
        burnApplied = def.burnTicks;
      }
    } else {
      // ── Standard / Heavy / Sniper ───────────────────────────────────
      const hitInfo = this.applyDamageAtPoint(impact, def.damage, def.blastRadius, target);
      hit = hitInfo.hit;
      totalDamage = hitInfo.damageDone;
      this.craterTerrain(impact.x, def.blastRadius, craters);
    }

    // Update tank positions after terrain destruction
    this.settleTanks();

    // Record last action
    const details: FireDetails = {
      trajectory,
      impact,
      shellType,
      hit,
      damageDone: totalDamage,
      craters,
      subImpacts,
      burnApplied,
    };
    this.state.lastAction = { playerId, type: 'fire', details };

    // Transition to animating
    this.state.phase = 'animating';

    // Check for kill
    if (target && target.hp <= 0) {
      this.state.status = 'game_over';
      this.state.winner = playerId;
    }
  }

  // ── Animating Phase ──────────────────────────────────────────────────────

  private handleAnimatingPhase(action: any): void {
    if (action.type !== 'end_animation') return;
    if (this.state.status === 'game_over') return;

    // Apply burn damage at start of new turn
    this.applyBurnDamage();

    // Check if burn killed someone
    const dead = this.state.playerIds.find(
      (id) => this.state.players[id] && this.state.players[id].hp <= 0,
    );
    if (dead) {
      this.state.status = 'game_over';
      this.state.winner = this.state.playerIds.find((id) => id !== dead);
      return;
    }

    // Advance turn
    this.state.turnIndex = (this.state.turnIndex + 1) % this.state.playerIds.length;
    this.skipRemovedPlayers();

    // Check if a full round has completed (turnIndex wrapped back to 0)
    if (this.state.turnIndex === 0) {
      this.state.roundNumber++;
      this.state.wind = randomWind();
      // Grant round income to all players
      for (const pid of this.state.playerIds) {
        const p = this.state.players[pid];
        if (p) p.money += ROUND_INCOME;
      }
    }

    this.state.phase = 'buy';
  }

  // ── Trajectory Calculation ───────────────────────────────────────────────

  private calculateTrajectory(
    startX: number,
    startY: number,
    angleDeg: number,
    power: number,
  ): TrajectoryPoint[] {
    const angleRad = (angleDeg * Math.PI) / 180;
    const v0 = power * VELOCITY_SCALE;
    const v0x = v0 * Math.cos(angleRad);
    const v0y = v0 * Math.sin(angleRad);
    const wind = this.state.wind;         // horizontal acceleration
    const windAccel = wind * 0.12;        // subtle but meaningful

    const points: TrajectoryPoint[] = [];
    let t = 0;

    for (let step = 0; step < MAX_TRAJECTORY_STEPS; step++) {
      const rawX = startX + v0x * t + 0.5 * windAccel * t * t;
      const rawY = startY - v0y * t + 0.5 * GRAVITY * t * t;

      const px = Math.round(rawX);
      const py = Math.round(rawY);
      points.push({ x: px, y: py });

      // Out of horizontal bounds (generous margin)
      if (px < -20 || px > TERRAIN_WIDTH + 20) break;
      // Fell below screen
      if (py > TERRAIN_HEIGHT + 10) break;

      // Terrain collision: ground surface at column px is row (terrainHeight - terrain[px])
      if (px >= 0 && px < TERRAIN_WIDTH) {
        const groundY = TERRAIN_HEIGHT - this.state.terrain[px];
        if (py >= groundY) {
          // Snap impact to ground level
          points[points.length - 1].y = groundY;
          break;
        }
      }

      t += TIME_STEP;
    }

    // Ensure at least one point
    if (points.length === 0) {
      points.push({ x: startX, y: startY });
    }

    return points;
  }

  // ── Damage helpers ───────────────────────────────────────────────────────

  private applyDamageAtPoint(
    point: TrajectoryPoint,
    damage: number,
    blastRadius: number,
    target: PlayerState | null,
  ): { hit: boolean; damageDone: number } {
    if (!target) return { hit: false, damageDone: 0 };

    const dx = point.x - target.x;
    const dy = point.y - target.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist <= blastRadius) {
      // Damage falls off linearly with distance
      const falloff = 1 - dist / (blastRadius + 1);
      const dmg = Math.round(damage * Math.max(falloff, 0.25));
      target.hp = Math.max(0, target.hp - dmg);
      return { hit: true, damageDone: dmg };
    }

    return { hit: false, damageDone: 0 };
  }

  private applyBurnDamage(): void {
    for (const pid of this.state.playerIds) {
      const p = this.state.players[pid];
      if (!p || !p.burn) continue;
      if (p.burn.ticksRemaining > 0) {
        p.hp = Math.max(0, p.hp - p.burn.damagePerTick);
        p.burn.ticksRemaining--;
        if (p.burn.ticksRemaining <= 0) {
          delete p.burn;
        }
      }
    }
  }

  // ── Terrain Destruction ──────────────────────────────────────────────────

  private craterTerrain(
    impactX: number,
    blastRadius: number,
    craters: { x: number; depthReduction: number }[],
  ): void {
    for (let dx = -blastRadius; dx <= blastRadius; dx++) {
      const col = impactX + dx;
      if (col < 0 || col >= TERRAIN_WIDTH) continue;

      // Parabolic crater shape: deepest at centre
      const dist = Math.abs(dx);
      const depth = Math.max(1, Math.round((blastRadius - dist + 1) * 0.6));
      this.state.terrain[col] = Math.max(1, this.state.terrain[col] - depth);

      craters.push({ x: col, depthReduction: depth });
    }
  }

  /** Re-seat every tank on top of possibly-lowered terrain. */
  private settleTanks(): void {
    for (const pid of this.state.playerIds) {
      const p = this.state.players[pid];
      if (!p) continue;
      p.y = tankScreenY(this.state.terrain, p.x, TERRAIN_HEIGHT);
    }
  }

  // ── Validation ───────────────────────────────────────────────────────────

  private isValidShellType(type: string): type is ShellType {
    return ALL_SHELL_TYPES.includes(type as ShellType);
  }

  private validateShellType(raw: any): ShellType {
    if (typeof raw === 'string' && this.isValidShellType(raw)) return raw;
    return 'standard';
  }

  /** Skip past any turnIndex that points at a removed player. */
  private skipRemovedPlayers(): void {
    if (this.state.playerIds.length === 0) return;
    const maxIter = this.state.playerIds.length;
    for (let i = 0; i < maxIter; i++) {
      const pid = this.state.playerIds[this.state.turnIndex];
      if (pid && this.state.players[pid]) return; // valid
      this.state.turnIndex = (this.state.turnIndex + 1) % this.state.playerIds.length;
    }
  }
}
