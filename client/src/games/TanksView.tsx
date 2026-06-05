import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import WebSocket from 'ws';

interface TanksViewProps {
  ws: WebSocket;
  gameState: any;
  playerId: string;
}

export default function TanksView({ ws, gameState, playerId }: TanksViewProps) {
  const [selectedShopIndex, setSelectedShopIndex] = useState(0);
  const [activeField, setActiveField] = useState<'shell' | 'angle' | 'power'>('shell');
  const [shellType, setShellType] = useState<'standard' | 'heavy' | 'cluster'>('standard');
  const [angleStr, setAngleStr] = useState('45');
  const [powerStr, setPowerStr] = useState('50');
  const [animIndex, setAnimIndex] = useState(0);
  
  const isMyTurn = gameState.playerIds && gameState.playerIds[gameState.turnIndex] === playerId;

  useEffect(() => {
    if (gameState.phase === 'animating' && gameState.lastAction) {
      setAnimIndex(0);
      const traj = gameState.lastAction.details.trajectory;
      const interval = setInterval(() => {
        setAnimIndex((i) => {
          if (i >= traj.length) {
            clearInterval(interval);
            setTimeout(() => {
              // The player who shot sends the end animation signal
              if (gameState.lastAction.playerId === playerId) {
                ws.send(JSON.stringify({ type: 'input', key: JSON.stringify({ type: 'end_animation' }) }));
              }
            }, 1500); // 1.5 seconds explosion
            return i + 1; // Stay at end
          }
          return i + 1;
        });
      }, 50);
      return () => clearInterval(interval);
    }
  }, [gameState.phase, gameState.lastAction, playerId, ws]);

  useInput((input, key) => {
    if (!isMyTurn) return;
    
    // Helper to send json payloads using the existing server payload format
    const sendAction = (action: any) => {
      ws.send(JSON.stringify(action));
    };

    if (gameState.phase === 'buy') {
      if (key.upArrow) setSelectedShopIndex(Math.max(0, selectedShopIndex - 1));
      if (key.downArrow) setSelectedShopIndex(Math.min(2, selectedShopIndex + 1));
      if (key.return) {
        if (selectedShopIndex === 0) sendAction({ type: 'buy', item: 'heavy' });
        else if (selectedShopIndex === 1) sendAction({ type: 'buy', item: 'cluster' });
        else if (selectedShopIndex === 2) sendAction({ type: 'end_buy' });
      }
    } else if (gameState.phase === 'fire') {
      if (key.return) {
        sendAction({ 
          type: 'fire', 
          angle: Number(angleStr) || 45, 
          power: Number(powerStr) || 50, 
          shellType 
        });
      } else if (key.tab || key.rightArrow) {
        setActiveField(f => f === 'shell' ? 'angle' : (f === 'angle' ? 'power' : 'shell'));
      } else if (key.leftArrow) {
        setActiveField(f => f === 'shell' ? 'power' : (f === 'angle' ? 'shell' : 'angle'));
      } else if (activeField === 'shell') {
        if (key.upArrow || key.downArrow) {
          setShellType(s => s === 'standard' ? 'heavy' : (s === 'heavy' ? 'cluster' : 'standard'));
        }
      } else if (key.backspace || key.delete) {
        if (activeField === 'angle') setAngleStr(s => s.slice(0, -1));
        else if (activeField === 'power') setPowerStr(s => s.slice(0, -1));
      } else if (/\d/.test(input)) {
        if (activeField === 'angle') setAngleStr(s => (s + input).slice(0, 3)); // Max 3 digits
        else if (activeField === 'power') setPowerStr(s => (s + input).slice(0, 3));
      }
    }
  });

  if (gameState.status === 'waiting') {
    return (
      <Box borderStyle="round" borderColor="cyan" padding={1}>
        <Text>Waiting for another player to join Terminal Tanks...</Text>
      </Box>
    );
  }

  const me = gameState.players[playerId];
  if (!me) return <Text>Loading player data...</Text>;

  const otherId = gameState.playerIds.find((id: string) => id !== playerId);
  const other = otherId ? gameState.players[otherId] : null;

  // Render board
  const rows = [];
  for (let y = 0; y < gameState.terrainHeight; y++) {
    const segments = [];
    let currentColor = 'white';
    let currentStr = '';

    for (let x = 0; x < gameState.terrainWidth; x++) {
      let char = ' ';
      let color = 'gray';

      if (y === gameState.terrainHeight - 1) { 
        char = '■'; color = 'green'; 
      }

      // Render players
      for (const p of Object.values<any>(gameState.players)) {
        // Body [O]
        if (y === p.y && x >= p.x - 1 && x <= p.x + 1) {
          char = x === p.x ? 'O' : (x < p.x ? '[' : ']');
          color = p.color;
        }
        // Turret ┻
        if (y === p.y - 1 && x === p.x) {
          char = '┻';
          color = p.color;
        }
      }

      // Render animation
      if (gameState.phase === 'animating' && gameState.lastAction) {
        const traj = gameState.lastAction.details.trajectory;
        
        // Trajectory trail
        for (let i = 0; i <= Math.min(animIndex, traj.length - 1); i++) {
          const p = traj[i];
          if (p.x === x && p.y === y) {
             char = i === traj.length - 1 ? '💥' : '•';
             color = 'yellow';
          }
        }

        // Explosion frame
        if (animIndex >= traj.length) {
          const impact = traj[traj.length - 1];
          const dx = x - impact.x;
          const dy = y - impact.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const r = gameState.lastAction.details.shellType === 'heavy' ? 5 : (gameState.lastAction.details.shellType === 'cluster' ? 7 : 3);
          
          if (dist <= r) {
            char = Math.random() > 0.5 ? '▓' : '▒';
            color = 'red';
          }
        }
      }

      if (color !== currentColor) {
        if (currentStr) segments.push(<Text key={segments.length} color={currentColor}>{currentStr}</Text>);
        currentColor = color;
        currentStr = char;
      } else {
        currentStr += char;
      }
    }
    if (currentStr) segments.push(<Text key={segments.length} color={currentColor}>{currentStr}</Text>);
    rows.push(<Box key={y} flexDirection="row">{segments}</Box>);
  }

  // UI Panels
  const turnText = isMyTurn ? <Text color="green" bold>YOUR TURN</Text> : <Text color="red">OPPONENT'S TURN</Text>;

  let controlsUi = null;
  if (gameState.status === 'game_over') {
    const winnerName = gameState.winner === playerId ? 'YOU WIN!' : 'YOU LOSE!';
    controlsUi = (
      <Box padding={1} borderStyle="single" borderColor="yellow">
        <Text color="yellow" bold>GAME OVER - {winnerName}</Text>
      </Box>
    );
  } else if (!isMyTurn) {
    controlsUi = (
      <Box padding={1} borderStyle="single" borderColor="gray">
        <Text>Waiting for opponent to {gameState.phase}...</Text>
      </Box>
    );
  } else if (gameState.phase === 'buy') {
    controlsUi = (
      <Box padding={1} borderStyle="single" borderColor="cyan" flexDirection="column">
        <Text bold>--- SHOP PHASE (Money: ${me.money}) ---</Text>
        <Text color={selectedShopIndex === 0 ? 'bgWhite' : undefined}>
          {selectedShopIndex === 0 ? '> ' : '  '}Heavy Shell ($50) - Large Blast
        </Text>
        <Text color={selectedShopIndex === 1 ? 'bgWhite' : undefined}>
          {selectedShopIndex === 1 ? '> ' : '  '}Cluster Shell ($75) - Massive Blast
        </Text>
        <Text color={selectedShopIndex === 2 ? 'bgWhite' : undefined}>
          {selectedShopIndex === 2 ? '> ' : '  '}Done Buying (Proceed to Fire)
        </Text>
        <Text dimColor>Use Up/Down to select, Enter to buy/proceed.</Text>
      </Box>
    );
  } else if (gameState.phase === 'fire') {
    controlsUi = (
      <Box padding={1} borderStyle="single" borderColor="red" flexDirection="column">
        <Text bold>--- FIRE PHASE ---</Text>
        <Box gap={4}>
          <Text color={activeField === 'shell' ? 'bgBlue' : undefined}>
            Shell: {shellType} ({shellType === 'standard' ? '∞' : me.inventory[shellType]})
          </Text>
          <Text color={activeField === 'angle' ? 'bgBlue' : undefined}>
            Angle: {angleStr}°
          </Text>
          <Text color={activeField === 'power' ? 'bgBlue' : undefined}>
            Power: {powerStr}
          </Text>
        </Box>
        <Text dimColor>Use Left/Right/Tab to switch fields. Up/Down to change shell. Type numbers. Enter to FIRE.</Text>
      </Box>
    );
  } else if (gameState.phase === 'animating') {
    controlsUi = (
      <Box padding={1} borderStyle="single" borderColor="yellow">
        <Text bold color="yellow">ANIMATING...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box justifyContent="space-between" padding={1} borderStyle="single">
        <Box flexDirection="column">
          <Text color={me.color} bold>YOU: {me.name}</Text>
          <Text>HP: {me.hp}</Text>
          <Text>Money: ${me.money}</Text>
          <Text>Inventory: {me.inventory.heavy} Heavy, {me.inventory.cluster} Cluster</Text>
        </Box>
        <Box flexDirection="column" alignItems="center">
          <Text bold>TERMINAL TANKS</Text>
          {turnText}
        </Box>
        {other && (
          <Box flexDirection="column" alignItems="flex-end">
            <Text color={other.color} bold>OPPONENT: {other.name}</Text>
            <Text>HP: {other.hp}</Text>
            <Text>Money: ${other.money}</Text>
            <Text>Inventory: {other.inventory.heavy} Heavy, {other.inventory.cluster} Cluster</Text>
          </Box>
        )}
      </Box>

      {/* Board */}
      <Box borderStyle="round" flexDirection="column">
        {rows}
      </Box>

      {/* Controls */}
      {controlsUi}
    </Box>
  );
}
