import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { GameRoom } from './game';

const PORT = parseInt(process.env.PORT || '3000', 10);
const wss = new WebSocketServer({ port: PORT });

// Store rooms and clients
const rooms: Record<string, GameRoom> = {};
const clients: Record<string, { ws: WebSocket, roomId: string | null }> = {};

// Helper to generate simple 4-char room codes
function generateRoomCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

wss.on('connection', (ws) => {
  const clientId = uuidv4();
  clients[clientId] = { ws, roomId: null };
  console.log(`Client connected: ${clientId}`);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      const client = clients[clientId];

      switch (data.type) {
        case 'create_room': {
          let code = generateRoomCode();
          while (rooms[code]) code = generateRoomCode(); // ensure uniqueness
          
          rooms[code] = new GameRoom(code);
          rooms[code].addPlayer(clientId);
          client.roomId = code;
          
          ws.send(JSON.stringify({ type: 'room_created', code }));
          broadcastState(code);
          break;
        }

        case 'join_room': {
          const code = data.code?.toUpperCase();
          if (rooms[code]) {
            rooms[code].addPlayer(clientId);
            client.roomId = code;
            ws.send(JSON.stringify({ type: 'room_joined', code }));
            broadcastState(code);
          } else {
            ws.send(JSON.stringify({ type: 'error', message: 'Room not found' }));
          }
          break;
        }

        case 'input': {
          if (client.roomId && rooms[client.roomId]) {
            rooms[client.roomId].handleInput(clientId, data.key);
            // We could broadcast state on every input, or set up a tick loop.
            // For this simple prototype, immediate broadcast is fine.
            broadcastState(client.roomId);
          }
          break;
        }
      }
    } catch (e) {
      console.error('Invalid message format', e);
    }
  });

  ws.on('close', () => {
    const client = clients[clientId];
    if (client.roomId && rooms[client.roomId]) {
      const room = rooms[client.roomId];
      room.removePlayer(clientId);
      broadcastState(client.roomId);
      
      // Clean up empty rooms
      if (Object.keys(room.state.players).length === 0) {
        console.log(`Deleting empty room: ${client.roomId}`);
        delete rooms[client.roomId];
      }
    }
    delete clients[clientId];
    console.log(`Client disconnected: ${clientId}`);
  });
});

function broadcastState(roomId: string) {
  const room = rooms[roomId];
  if (!room) return;

  const stateMsg = JSON.stringify({
    type: 'state',
    state: room.state
  });

  Object.entries(clients).forEach(([clientId, client]) => {
    if (client.roomId === roomId && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(stateMsg);
    }
  });
}

console.log(`Server started on ws://localhost:${PORT}`);
