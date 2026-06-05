export interface BrawlerPlayer {
  id: string;
  x: number;
  y: number;
  hp: number;
  color: string;
  facing: 'up' | 'down' | 'left' | 'right';
}

export interface BrawlerState {
  players: Record<string, BrawlerPlayer>;
  boardWidth: number;
  boardHeight: number;
  attacks: { x: number; y: number; time: number; type: string }[];
}

const COLORS = ['green', 'yellow', 'blue', 'magenta', 'cyan', 'red'];

export class BrawlerRoom {
  public id: string;
  public state: BrawlerState;

  constructor(id: string) {
    this.id = id;
    this.state = {
      players: {},
      boardWidth: 30,
      boardHeight: 15,
      attacks: []
    };
  }

  public addPlayer(playerId: string) {
    const color = COLORS[Object.keys(this.state.players).length % COLORS.length];
    this.state.players[playerId] = {
      id: playerId,
      x: Math.floor(Math.random() * this.state.boardWidth),
      y: Math.floor(Math.random() * this.state.boardHeight),
      hp: 100,
      color,
      facing: 'right'
    };
  }

  public removePlayer(playerId: string) {
    delete this.state.players[playerId];
  }

  public handleInput(playerId: string, input: string) {
    // Left empty or handle basic generic input if needed
    // But since the assignment says "handles join_room, move, and attack messages",
    // we assume there's a handleMessage or handleAction. Let's provide a generic handleMessage.
  }

  public handleMessage(playerId: string, message: any) {
    // Clean up old attacks
    const now = Date.now();
    this.state.attacks = this.state.attacks.filter(a => now - a.time < 300);

    const player = this.state.players[playerId];

    if (message.type === 'join_room') {
      if (!player) {
        this.addPlayer(playerId);
      }
    } else if (message.type === 'move') {
      if (!player || player.hp <= 0) return;
      const { direction } = message;
      if (direction === 'up') {
        player.y = Math.max(0, player.y - 1);
        player.facing = 'up';
      } else if (direction === 'down') {
        player.y = Math.min(this.state.boardHeight - 1, player.y + 1);
        player.facing = 'down';
      } else if (direction === 'left') {
        player.x = Math.max(0, player.x - 1);
        player.facing = 'left';
      } else if (direction === 'right') {
        player.x = Math.min(this.state.boardWidth - 1, player.x + 1);
        player.facing = 'right';
      }
    } else if (message.type === 'attack') {
      if (!player || player.hp <= 0) return;

      // Deal damage to all adjacent players
      const adjacentCoords = [
        { x: player.x, y: player.y - 1, facing: 'up' },
        { x: player.x, y: player.y + 1, facing: 'down' },
        { x: player.x - 1, y: player.y, facing: 'left' },
        { x: player.x + 1, y: player.y, facing: 'right' }
      ];

      for (const coord of adjacentCoords) {
        if (coord.x >= 0 && coord.x < this.state.boardWidth && coord.y >= 0 && coord.y < this.state.boardHeight) {
          this.state.attacks.push({ x: coord.x, y: coord.y, time: now, type: coord.facing });
        }
      }

      for (const pId in this.state.players) {
        const p = this.state.players[pId];
        if (p.id !== playerId && p.hp > 0) {
          const isAdjacent = Math.abs(p.x - player.x) + Math.abs(p.y - player.y) === 1;
          if (isAdjacent) {
            p.hp = Math.max(0, p.hp - 20);
          }
        }
      }
    }
  }
}
