#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import App from './App.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf-8'));
const version = packageJson.version;

const args = process.argv.slice(2);
const isLocal = args.includes('--local');
const cleanArgs = args.filter(a => a !== '--local');
const action = (cleanArgs[0] || 'start') as 'create' | 'join' | 'start';
const serverUrl = isLocal ? 'ws://localhost:3000' : 'wss://term-quest-server.onrender.com';

if (action !== 'create' && action !== 'join' && action !== 'start') {
  console.error('Usage:');
  console.error('  npx @cli-games/term-quest-multiplayer start');
  console.error('  npx @cli-games/term-quest-multiplayer create');
  console.error('  npx @cli-games/term-quest-multiplayer join <ROOM_CODE>');
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
render(<App action={action} roomCode={roomCode} version={version} serverUrl={serverUrl} />);
