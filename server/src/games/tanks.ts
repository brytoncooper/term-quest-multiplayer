export interface PlayerState {
  id: string;
  name: string;
  hp: number;
  money: number;
  inventory: {
    standard: number;
    heavy: number;
    cluster: number;
  };
  x: number;
  y: number;
  color: string;
}

export interface TankGameState {
  status: 'waiting' | 'playing' | 'game_over';
  phase: 'buy' | 'fire' | 'animating';
  players: Record<string, PlayerState>;
  playerIds: string[];
  turnIndex: number;
  terrainWidth: number;
  terrainHeight: number;
  lastAction?: {
    playerId: string;
    type: string;
    details: any;
  };
  winner?: string;
}

export class TanksGame {
  public id: string;
  public state: TankGameState;

  constructor(id: string) {
    this.id = id;
    this.state = {
      status: 'waiting',
      phase: 'buy',
      players: {},
      playerIds: [],
      turnIndex: 0,
      terrainWidth: 80,
      terrainHeight: 20,
    };
  }

  public addPlayer(playerId: string) {
    if (this.state.playerIds.length >= 2) return;

    const isPlayerOne = this.state.playerIds.length === 0;
    
    this.state.players[playerId] = {
      id: playerId,
      name: isPlayerOne ? 'Player 1' : 'Player 2',
      hp: 100,
      money: 100,
      inventory: { standard: -1, heavy: 0, cluster: 0 },
      x: isPlayerOne ? 10 : 70,
      y: this.state.terrainHeight - 2, // Tank rests on terrainHeight - 1 (ground)
      color: isPlayerOne ? 'cyan' : 'magenta',
    };
    this.state.playerIds.push(playerId);

    if (this.state.playerIds.length === 2) {
      this.state.status = 'playing';
      this.state.phase = 'buy';
      this.state.turnIndex = 0;
    }
  }

  public removePlayer(playerId: string) {
    delete this.state.players[playerId];
    this.state.playerIds = this.state.playerIds.filter(id => id !== playerId);
    if (this.state.status === 'playing') {
      this.state.status = 'game_over';
    }
  }

  // Support both "input" (like index.ts standard) or "action" objects
  public handleInput(playerId: string, actionPayload: any) {
    let action = actionPayload;
    if (typeof action === 'string') {
      try {
        action = JSON.parse(action);
      } catch {
        action = { type: action }; // Fallback
      }
    }

    if (this.state.status !== 'playing') return;
    
    const currentTurnPlayerId = this.state.playerIds[this.state.turnIndex];
    if (playerId !== currentTurnPlayerId) return;

    const player = this.state.players[playerId];

    if (this.state.phase === 'buy') {
      if (action.type === 'buy') {
        const item = action.item;
        const costs: any = { heavy: 50, cluster: 75 };
        if (costs[item] && player.money >= costs[item]) {
          player.money -= costs[item];
          (player.inventory as any)[item]++;
        }
      } else if (action.type === 'end_buy') {
        this.state.phase = 'fire';
      }
    } else if (this.state.phase === 'fire') {
      if (action.type === 'fire') {
        const { angle, power, shellType } = action;
        
        if (shellType !== 'standard' && (player.inventory as any)[shellType] <= 0) {
            return; // Not enough inventory
        }
        if (shellType !== 'standard') {
            (player.inventory as any)[shellType]--;
        }

        // Projectile fires from turret (p.y - 1)
        const startX = player.x;
        const startY = player.y - 1;
        const trajectory = this.calculateTrajectory(startX, startY, angle, power);
        const impact = trajectory[trajectory.length - 1];

        // Hit detection
        const damages: any = { standard: 25, heavy: 50, cluster: 40 };
        const blastRadii: any = { standard: 3, heavy: 5, cluster: 8 };
        const dmg = damages[shellType] || 25;
        const rad = blastRadii[shellType] || 3;

        const targetPlayerId = this.state.playerIds.find(id => id !== playerId);
        const targetPlayer = targetPlayerId ? this.state.players[targetPlayerId] : null;

        let hit = false;
        let damageDone = 0;

        if (targetPlayer) {
          const dx = impact.x - targetPlayer.x;
          const dy = impact.y - targetPlayer.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist <= rad) {
            hit = true;
            // Full damage inside blast radius
            damageDone = dmg;
            targetPlayer.hp = Math.max(0, targetPlayer.hp - damageDone);
          }
        }

        this.state.lastAction = {
          playerId,
          type: 'fire',
          details: { trajectory, impact, shellType, hit, damageDone }
        };

        this.state.phase = 'animating';
        
        if (targetPlayer && targetPlayer.hp <= 0) {
          this.state.status = 'game_over';
          this.state.winner = playerId;
        }
      }
    } else if (this.state.phase === 'animating') {
      if (action.type === 'end_animation') {
        if ((this.state.status as string) !== 'game_over') {
          this.state.turnIndex = (this.state.turnIndex + 1) % 2;
          this.state.phase = 'buy';
          this.state.players[this.state.playerIds[this.state.turnIndex]].money += 25; // Passive income
        }
      }
    }
  }

  private calculateTrajectory(startX: number, startY: number, angleDeg: number, power: number) {
    // 0 is right, 180 is left, 90 is up
    const angleRad = angleDeg * (Math.PI / 180);
    // Velocity scaling
    const v0 = power * 0.4; 
    const v0x = v0 * Math.cos(angleRad);
    const v0y = v0 * Math.sin(angleRad);
    const g = 9.8;
    
    const trajectory = [];
    let t = 0;
    
    while (true) {
      const x = Math.round(startX + (v0x * t));
      const y = Math.round(startY - (v0y * t) + (0.5 * g * t * t));
      
      trajectory.push({ x, y });
      
      // Stop if hit ground or out of bounds
      if (y >= this.state.terrainHeight - 1 || x < -20 || x > this.state.terrainWidth + 20) {
         break;
      }
      t += 0.15;
    }
    
    return trajectory;
  }
}
