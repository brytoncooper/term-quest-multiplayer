import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import WebSocket from 'ws';

interface Player {
  id: string;
  x: number;
  y: number;
  color: string;
}

interface GameState {
  players: Record<string, Player>;
  boardWidth: number;
  boardHeight: number;
}

interface AppProps {
  action: 'create' | 'join';
  roomCode?: string;
  serverUrl?: string;
}

export default function App({ action, roomCode, serverUrl = 'ws://localhost:3000' }: AppProps) {
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [currentRoom, setCurrentRoom] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const socket = new WebSocket(serverUrl);

    socket.on('open', () => {
      setWs(socket);
      if (action === 'create') {
        socket.send(JSON.stringify({ type: 'create_room' }));
      } else if (action === 'join' && roomCode) {
        socket.send(JSON.stringify({ type: 'join_room', code: roomCode }));
      }
    });

    socket.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'room_created' || msg.type === 'room_joined') {
          setCurrentRoom(msg.code);
        } else if (msg.type === 'state') {
          setGameState(msg.state);
        } else if (msg.type === 'error') {
          setError(msg.message);
        }
      } catch (err) {
        console.error('Failed to parse message', err);
      }
    });

    socket.on('close', () => {
      setError('Connection to server closed.');
    });

    return () => {
      socket.close();
    };
  }, [action, roomCode, serverUrl]);

  useInput((input, key) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    let actionKey = null;
    if (key.upArrow) actionKey = 'up';
    else if (key.downArrow) actionKey = 'down';
    else if (key.leftArrow) actionKey = 'left';
    else if (key.rightArrow) actionKey = 'right';

    if (actionKey) {
      ws.send(JSON.stringify({ type: 'input', key: actionKey }));
    }
  });

  if (error) {
    return (
      <Box borderStyle="round" borderColor="red" padding={1}>
        <Text color="red">Error: {error}</Text>
      </Box>
    );
  }

  if (!gameState) {
    return <Text>Connecting to server...</Text>;
  }

  // Render the board
  const board: JSX.Element[] = [];
  for (let y = 0; y < gameState.boardHeight; y++) {
    const row: JSX.Element[] = [];
    for (let x = 0; x < gameState.boardWidth; x++) {
      let cellChar = '.';
      let cellColor = 'gray';

      // Find if there's a player here
      for (const player of Object.values(gameState.players)) {
        if (player.x === x && player.y === y) {
          cellChar = '@';
          cellColor = player.color;
          break;
        }
      }

      row.push(<Text key={`${x}-${y}`} color={cellColor}>{cellChar}</Text>);
    }
    board.push(<Box key={y}>{row}</Box>);
  }

  return (
    <Box flexDirection="column">
      <Box borderStyle="single" padding={1} flexDirection="column">
        <Text bold>Room Code: <Text color="green">{currentRoom}</Text></Text>
        <Text>Use Arrow Keys to move. Press Ctrl+C to exit.</Text>
        <Text>Players connected: {Object.keys(gameState.players).length}</Text>
      </Box>
      <Box borderStyle="round" flexDirection="column">
        {board}
      </Box>
    </Box>
  );
}
