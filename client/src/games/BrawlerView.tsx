import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';

export default function BrawlerView({ ws, gameState, playerId }: any) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(interval);
  }, []);

  useInput((input, key) => {
    if (!ws) return;

    if (key.upArrow) {
      ws.send(JSON.stringify({ type: 'move', direction: 'up' }));
    } else if (key.downArrow) {
      ws.send(JSON.stringify({ type: 'move', direction: 'down' }));
    } else if (key.leftArrow) {
      ws.send(JSON.stringify({ type: 'move', direction: 'left' }));
    } else if (key.rightArrow) {
      ws.send(JSON.stringify({ type: 'move', direction: 'right' }));
    } else if (input === ' ') {
      ws.send(JSON.stringify({ type: 'attack' }));
    }
  });

  if (!gameState) {
    return <Text>Loading brawler...</Text>;
  }

  const activeAttacks = (gameState.attacks || []).filter((a: any) => now - a.time < 300);

  // Render board
  const board = [];
  for (let y = 0; y < gameState.boardHeight; y++) {
    const row = [];
    for (let x = 0; x < gameState.boardWidth; x++) {
      let cellChar = '.';
      let cellColor = 'gray';
      let isBold = false;

      // Check attacks
      const attack = activeAttacks.find((a: any) => a.x === x && a.y === y);
      if (attack) {
        cellChar = '💥'; // Explosion emoji for coolness
        cellColor = 'red';
        isBold = true;
      } else {
        // Check players
        let foundPlayer = null;
        for (const pId in gameState.players) {
          const p = gameState.players[pId];
          if (p.x === x && p.y === y) {
            foundPlayer = p;
            break;
          }
        }

        if (foundPlayer) {
          if (foundPlayer.hp <= 0) {
            cellChar = '☠️ ';
            cellColor = 'gray';
          } else {
            // Give different faces based on facing direction
            if (foundPlayer.facing === 'up') cellChar = '▲';
            else if (foundPlayer.facing === 'down') cellChar = '▼';
            else if (foundPlayer.facing === 'left') cellChar = '◄';
            else if (foundPlayer.facing === 'right') cellChar = '►';
            else cellChar = '☻';
            
            cellColor = foundPlayer.color;
            isBold = true;
          }
        }
      }

      // We use string padding to make the grid look better if emojis are used, 
      // but let's stick to ascii/ansi to ensure grid alignment isn't totally broken.
      // Emojis often break CLI grid alignment because of double-width characters. 
      // I'll replace emojis with ascii for better CLI support.
      if (cellChar === '💥') {
        cellChar = 'X';
      } else if (cellChar === '☠️ ') {
        cellChar = '+';
      }

      row.push(<Text key={`${x}-${y}`} color={cellColor} bold={isBold}>{cellChar}</Text>);
    }
    board.push(<Box key={y}>{row}</Box>);
  }

  // Render HP Bars
  const hpBars = Object.values(gameState.players).map((p: any) => {
    const barLength = 20;
    const filled = Math.ceil((Math.max(0, p.hp) / 100) * barLength);
    const bar = '█'.repeat(filled) + '░'.repeat(barLength - filled);
    const statusColor = p.hp > 50 ? 'green' : p.hp > 20 ? 'yellow' : 'red';
    
    return (
      <Box key={p.id}>
        <Text color={p.color} bold>{p.id === playerId ? 'You ' : 'P' + p.id.substring(0, 3)}: </Text>
        <Text color={statusColor}>{bar} {p.hp} HP</Text>
        {p.hp <= 0 && <Text color="gray"> (DEAD)</Text>}
      </Box>
    );
  });

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor="blue" padding={1} flexDirection="column">
        <Text bold>🔥 DYNAMIC BRAWLER 🔥</Text>
        <Text>Arrows to move, Spacebar to attack! Attack hits all 4 adjacent spaces.</Text>
      </Box>
      <Box flexDirection="row">
        <Box borderStyle="single" flexDirection="column" marginRight={2}>
          {board}
        </Box>
        <Box borderStyle="single" flexDirection="column" padding={1} width={40}>
          <Text bold underline>Players Status</Text>
          {hpBars}
        </Box>
      </Box>
    </Box>
  );
}
