import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import WebSocket from 'ws';
import BrawlerView from './games/BrawlerView.js';
import TanksView from './games/TanksView.js';

interface AppProps {
  action: 'create' | 'join' | 'start';
  roomCode?: string;
  version: string;
  serverUrl?: string;
}

type ViewState = 'CONNECTING' | 'MAIN_MENU' | 'JOINING' | 'BROWSER' | 'LOBBY' | 'GAME' | 'ERROR';

export default function App({ action, roomCode, version, serverUrl = 'wss://term-quest-server.onrender.com' }: AppProps) {
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [view, setView] = useState<ViewState>('CONNECTING');
  const [errorMsg, setErrorMsg] = useState<string>('');
  
  const [room, setRoom] = useState<string | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [openRooms, setOpenRooms] = useState<string[]>([]);
  const [gameId, setGameId] = useState<string | null>(null);
  const [gameState, setGameState] = useState<any>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);

  useEffect(() => {
    const socket = new WebSocket(serverUrl);

    socket.on('open', () => {
      setWs(socket);
      socket.send(JSON.stringify({ type: 'handshake', version }));
    });

    socket.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        
        switch (msg.type) {
          case 'handshake_ok':
            if (action === 'create') socket.send(JSON.stringify({ type: 'create_room' }));
            else if (action === 'join' && roomCode) socket.send(JSON.stringify({ type: 'join_room', code: roomCode }));
            else setView('MAIN_MENU');
            break;
            
          case 'rooms_list':
            setOpenRooms(msg.rooms);
            setView('BROWSER');
            break;
            
          case 'room_joined':
            setRoom(msg.code);
            setIsHost(msg.isHost);
            setPlayerId(msg.playerId);
            setView('LOBBY');
            break;
            
          case 'promoted_to_host':
            setIsHost(true);
            break;
            
          case 'game_selected':
            setGameId(msg.gameId);
            setGameState(msg.state);
            setView('GAME');
            break;
            
          case 'game_event':
            if (msg.data && msg.data.type === 'state') {
              setGameState(msg.data.state);
            }
            break;
            
          case 'returned_to_lobby':
            setGameId(null);
            setGameState(null);
            setView('LOBBY');
            break;

          case 'opponent_disconnected':
            setGameId(null);
            setGameState(null);
            setErrorMsg('Your opponent disconnected.');
            setView('LOBBY');
            break;

          case 'error':
            if (msg.message === 'UPDATE_REQUIRED') {
              setErrorMsg('You are using an outdated version! Run: npm update -g @cli-games/term-quest-multiplayer');
            } else {
              setErrorMsg(msg.message);
            }
            setView('ERROR');
            break;
        }
      } catch (err) {}
    });

    socket.on('close', () => {
      if (view !== 'ERROR') {
        setErrorMsg('Connection to server closed.');
        setView('ERROR');
      }
    });

    return () => { socket.close(); };
  }, [action, roomCode, serverUrl, version]);

  const onLeave = () => {
    ws?.send(JSON.stringify({ type: 'leave_game' }));
  };

  if (view === 'ERROR') {
    return (
      <Box borderStyle="round" borderColor="red" padding={1}>
        <Text color="red" bold>{errorMsg}</Text>
      </Box>
    );
  }

  if (view === 'CONNECTING') return <Text>Connecting to server...</Text>;

  if (view === 'MAIN_MENU') {
    const items = [
      { label: 'Create New Room', value: 'create' },
      { label: 'Browse Open Rooms', value: 'browse' },
      { label: 'Quit', value: 'quit' }
    ];
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" borderColor="blue">
        <Text bold color="cyan">=== TERM QUEST PLATFORM ===</Text>
        <Box marginTop={1}>
          <SelectInput items={items} onSelect={(item) => {
            if (item.value === 'create') ws?.send(JSON.stringify({ type: 'create_room' }));
            if (item.value === 'browse') ws?.send(JSON.stringify({ type: 'list_rooms' }));
            if (item.value === 'quit') process.exit(0);
          }} />
        </Box>
      </Box>
    );
  }
  
  if (view === 'BROWSER') {
    const items = openRooms.length > 0 
      ? openRooms.map(r => ({ label: `Room: ${r}`, value: r }))
      : [{ label: 'No open rooms. Back to menu.', value: 'back' }];
      
    return (
      <Box flexDirection="column" padding={1} borderStyle="round">
        <Text bold color="cyan">Select a Room to Join:</Text>
        <SelectInput items={items} onSelect={(item) => {
          if (item.value === 'back') setView('MAIN_MENU');
          else ws?.send(JSON.stringify({ type: 'join_room', code: item.value }));
        }} />
      </Box>
    );
  }

  if (view === 'LOBBY') {
    if (!isHost) {
      return (
        <Box borderStyle="round" padding={1}>
          <Text>Waiting for Host to select a game in Room <Text color="green" bold>{room}</Text>...</Text>
        </Box>
      );
    }
    
    const games = [
      { label: 'Dynamic Brawler', value: 'brawler' },
      { label: 'Terminal Tanks', value: 'tanks' }
    ];
    
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" borderColor="yellow">
        <Text bold>Room Code: <Text color="green">{room}</Text></Text>
        <Text>You are the Host! Select a game to play:</Text>
        <Box marginTop={1}>
          <SelectInput items={games} onSelect={(item) => {
            ws?.send(JSON.stringify({ type: 'select_game', gameId: item.value }));
          }} />
        </Box>
      </Box>
    );
  }

  if (view === 'GAME' && ws && playerId) {
    if (gameId === 'brawler') {
      return <BrawlerView ws={ws} gameState={gameState} playerId={playerId} onLeave={onLeave} />;
    } else if (gameId === 'tanks') {
      return <TanksView ws={ws} gameState={gameState} playerId={playerId} onLeave={onLeave} />;
    }
    return (
      <Box borderStyle="round" padding={1} flexDirection="column">
        <Text bold>Game: {gameId}</Text>
        <Text italic>Unknown game type!</Text>
      </Box>
    );
  }

  return <Text>Loading...</Text>;
}
