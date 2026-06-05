export interface Player {
  id: string;
  x: number;
  y: number;
  color: string;
}

export interface GameState {
  players: Record<string, Player>;
  boardWidth: number;
  boardHeight: number;
}

const COLORS = ['green', 'yellow', 'blue', 'magenta', 'cyan', 'red'];

export class GameRoom {
  public id: string;
  public state: GameState;
  
  constructor(id: string) {
    this.id = id;
    this.state = {
      players: {},
      boardWidth: 40,
      boardHeight: 20
    };
  }

  public addPlayer(playerId: string) {
    const color = COLORS[Object.keys(this.state.players).length % COLORS.length];
    this.state.players[playerId] = {
      id: playerId,
      x: Math.floor(this.state.boardWidth / 2),
      y: Math.floor(this.state.boardHeight / 2),
      color
    };
  }

  public removePlayer(playerId: string) {
    delete this.state.players[playerId];
  }

  public handleInput(playerId: string, input: string) {
    const player = this.state.players[playerId];
    if (!player) return;

    switch (input) {
      case 'up':
        player.y = Math.max(0, player.y - 1);
        break;
      case 'down':
        player.y = Math.min(this.state.boardHeight - 1, player.y + 1);
        break;
      case 'left':
        player.x = Math.max(0, player.x - 1);
        break;
      case 'right':
        player.x = Math.min(this.state.boardWidth - 1, player.x + 1);
        break;
    }
  }
}
