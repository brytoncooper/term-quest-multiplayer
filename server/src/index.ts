import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';

import { BrawlerRoom } from './games/brawler';
import { TanksGame } from './games/tanks';

const PORT = parseInt(process.env.PORT || '3000', 10);
const wss = new WebSocketServer({ port: PORT });

// We'll hardcode the minimum version for now to 1.0.2
const MIN_VERSION = '1.0.2';

interface Room {
  id: string;
  gameId: string | null;
  host: string;
  players: Record<string, { ws: WebSocket; isHost: boolean }>;
  gameState: any;
}

const rooms: Record<string, Room> = {};
const clients: Record<string, { ws: WebSocket, roomId: string | null }> = {};

function generateRoomCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
}

function broadcastToRoom(roomId: string, message: object) {
  const room = rooms[roomId];
  if (!room) return;
  const msgStr = JSON.stringify(message);
  Object.values(room.players).forEach(p => {
    if (p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(msgStr);
    }
  });
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
        case 'handshake': {
          // Version checking
          const clientVer = data.version ? data.version.split('.').map(Number) : [0,0,0];
          const minVer = MIN_VERSION.split('.').map(Number);
          let outdated = false;
          for (let i = 0; i < 3; i++) {
            if (clientVer[i] < minVer[i]) { outdated = true; break; }
            if (clientVer[i] > minVer[i]) { break; }
          }
          
          if (outdated) {
            ws.send(JSON.stringify({ type: 'error', message: 'UPDATE_REQUIRED' }));
            ws.close();
            return;
          }
          ws.send(JSON.stringify({ type: 'handshake_ok' }));
          break;
        }

        case 'list_rooms': {
          const openRooms = Object.values(rooms)
            .filter(r => Object.keys(r.players).length < 2)
            .map(r => r.id);
          ws.send(JSON.stringify({ type: 'rooms_list', rooms: openRooms }));
          break;
        }

        case 'create_room': {
          let code = generateRoomCode();
          while (rooms[code]) code = generateRoomCode();
          rooms[code] = {
            id: code,
            gameId: null,
            host: clientId,
            players: { [clientId]: { ws, isHost: true } },
            gameState: null
          };
          client.roomId = code;
          ws.send(JSON.stringify({ type: 'room_joined', code, isHost: true, playerId: clientId }));
          break;
        }

        case 'join_room': {
          const code = data.code?.toUpperCase();
          const room = rooms[code];
          if (room) {
            if (Object.keys(room.players).length >= 2) {
              ws.send(JSON.stringify({ type: 'error', message: 'Room is full' }));
              return;
            }
            room.players[clientId] = { ws, isHost: false };
            client.roomId = code;
            ws.send(JSON.stringify({ type: 'room_joined', code, isHost: false, playerId: clientId }));
            
            // Notify host that guest joined
            broadcastToRoom(code, { type: 'guest_joined' });
            
            if (room.gameId) {
               if (room.gameState && typeof room.gameState.addPlayer === 'function') {
                 room.gameState.addPlayer(clientId);
               }
               ws.send(JSON.stringify({ type: 'game_selected', gameId: room.gameId, state: room.gameState?.state || room.gameState }));
            }
          } else {
            ws.send(JSON.stringify({ type: 'error', message: 'Room not found' }));
          }
          break;
        }

        case 'select_game': {
          const room = rooms[client.roomId!];
          if (room && room.host === clientId) {
            room.gameId = data.gameId;
            
            // Initialize game instance
            if (data.gameId === 'brawler') {
              room.gameState = new BrawlerRoom(room.id);
            } else if (data.gameId === 'tanks') {
              room.gameState = new TanksGame(room.id);
            }
            
            // Add all players to the new game state
            Object.keys(room.players).forEach(pId => {
              if (room.gameState && typeof room.gameState.addPlayer === 'function') {
                room.gameState.addPlayer(pId);
              }
            });

            broadcastToRoom(room.id, { type: 'game_selected', gameId: room.gameId, state: room.gameState?.state || room.gameState });
          }
          break;
        }
        
        // Pass everything else to the specific game logic
        default: {
          if (client.roomId && rooms[client.roomId]) {
             const room = rooms[client.roomId];
             let stateChanged = false;
             if (room.gameState) {
               if (typeof room.gameState.handleMessage === 'function') {
                 room.gameState.handleMessage(clientId, data);
                 stateChanged = true;
               } else if (typeof room.gameState.handleInput === 'function') {
                 room.gameState.handleInput(clientId, data);
                 stateChanged = true;
               }
             }
             
             if (stateChanged) {
               broadcastToRoom(client.roomId, { type: 'game_event', data: { type: 'state', state: room.gameState.state } });
             } else {
               broadcastToRoom(client.roomId, { type: 'game_event', data });
             }
          }
          break;
        }
      }
    } catch (e) {
      console.error('Error handling message', e);
    }
  });

  ws.on('close', () => {
    const client = clients[clientId];
    if (client.roomId && rooms[client.roomId]) {
      const room = rooms[client.roomId];
      delete room.players[clientId];
      broadcastToRoom(client.roomId, { type: 'player_left' });
      if (Object.keys(room.players).length === 0) {
        delete rooms[client.roomId];
      } else if (room.host === clientId) {
        // If host leaves, make the other player the host
        const otherPlayerId = Object.keys(room.players)[0];
        room.host = otherPlayerId;
        room.players[otherPlayerId].isHost = true;
        room.players[otherPlayerId].ws.send(JSON.stringify({ type: 'promoted_to_host' }));
      }
    }
    delete clients[clientId];
    console.log(`Client disconnected: ${clientId}`);
  });
});

console.log(`Platform Server started on ws://localhost:${PORT}`);
