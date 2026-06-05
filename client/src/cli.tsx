import React from 'react';
import { render } from 'ink';
import App from './App';

const args = process.argv.slice(2);
const action = args[0] as 'create' | 'join';

if (action !== 'create' && action !== 'join') {
  console.error('Usage:');
  console.error('  npx tsx src/cli.tsx create');
  console.error('  npx tsx src/cli.tsx join <ROOM_CODE>');
  process.exit(1);
}

let roomCode;
if (action === 'join') {
  roomCode = args[1];
  if (!roomCode) {
    console.error('Error: Please provide a room code to join.');
    process.exit(1);
  }
}

// Render the ink application
render(<App action={action} roomCode={roomCode} />);
