import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import WebSocket from 'ws';
import { getTankSprite, getTrajectoryPreview, getAngleIndicator } from './tankArt.js';

// ─── Types ──────────────────────────────────────────────────────────────────────

interface TanksViewProps {
  ws: WebSocket;
  gameState: any;
  playerId: string;
  onLeave?: () => void;
}

interface ShopItem {
  key: string;
  name: string;
  cost: number;
  damage: string;
  blast: string;
  desc: string;
  icon: string;
}

type ShellKey = 'standard' | 'heavy' | 'cluster' | 'sniper' | 'napalm';
type FireField = 'shell' | 'angle' | 'power';

// ─── Constants ──────────────────────────────────────────────────────────────────

const SHOP_ITEMS: ShopItem[] = [
  { key: 'standard', name: 'Standard Shell', cost: 0,  damage: '15',    blast: '2', desc: 'Basic ammo. Infinite supply.',       icon: '●' },
  { key: 'heavy',    name: 'Heavy Shell',    cost: 40, damage: '30',    blast: '4', desc: 'Big boom. Serious damage.',          icon: '◉' },
  { key: 'cluster',  name: 'Cluster Bomb',   cost: 60, damage: '10×5',  blast: '6', desc: 'Splits into sub-munitions.',         icon: '✸' },
  { key: 'sniper',   name: 'Sniper Round',   cost: 30, damage: '25',    blast: '1', desc: 'Precision shot. Tiny blast.',        icon: '▸' },
  { key: 'napalm',   name: 'Napalm Shell',   cost: 55, damage: '20+',   blast: '5', desc: 'Burns area. Lingering fire.',        icon: '♨' },
];

const SHELL_KEYS: ShellKey[] = ['standard', 'heavy', 'cluster', 'sniper', 'napalm'];

const EXPLOSION_CHARS = ['█', '▓', '▒', '░', '◆', '◈', '*'];
const TRAIL_CHAR = '·';
const PROJECTILE_CHAR = '◆';

// ─── Helpers ────────────────────────────────────────────────────────────────────

function hpBar(hp: number, maxHp: number, width: number): { bar: string; color: string } {
  const pct = Math.max(0, Math.min(1, hp / maxHp));
  const filled = Math.round(pct * width);
  const empty = width - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  const color = pct > 0.6 ? 'green' : pct > 0.3 ? 'yellow' : 'red';
  return { bar, color };
}

function windArrow(wind: number): string {
  if (wind === 0) return '○ Calm';
  const strength = Math.abs(wind);
  const arrows = wind < 0
    ? '◂'.repeat(Math.min(strength, 5))
    : '▸'.repeat(Math.min(strength, 5));
  return `${arrows} ${strength}`;
}

function padCenter(str: string, width: number): string {
  if (str.length >= width) return str.slice(0, width);
  const left = Math.floor((width - str.length) / 2);
  const right = width - str.length - left;
  return ' '.repeat(left) + str + ' '.repeat(right);
}

function padRight(str: string, width: number): string {
  if (str.length >= width) return str.slice(0, width);
  return str + ' '.repeat(width - str.length);
}

function padLeft(str: string, width: number): string {
  if (str.length >= width) return str.slice(0, width);
  return ' '.repeat(width - str.length) + str;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// ─── Sub-Components ─────────────────────────────────────────────────────────────

function Divider({ char = '─', width = 80, color = 'gray' }: { char?: string; width?: number; color?: string }) {
  return <Text color={color}>{char.repeat(width)}</Text>;
}

function PlayerStatBlock({ player, label, align, maxHp = 100 }: { player: any; label: string; align: 'left' | 'right'; maxHp?: number }) {
  if (!player) return <Box width={30}><Text dimColor>No player</Text></Box>;

  const { bar, color: barColor } = hpBar(player.hp ?? 0, maxHp, 16);
  const inv = player.inventory || {};

  const nameDisplay = `${label}: ${player.name || 'Unknown'}`;
  const moneyDisplay = `$ ${player.money ?? 0}`;
  const invLine = `S:∞ H:${inv.heavy ?? 0} C:${inv.cluster ?? 0} N:${inv.sniper ?? 0} A:${inv.napalm ?? 0}`;

  return (
    <Box flexDirection="column" width={30}>
      <Text color={player.color || 'white'} bold>
        {align === 'right' ? padLeft(nameDisplay, 28) : padRight(nameDisplay, 28)}
      </Text>
      <Box>
        {align === 'right' && <Text>   </Text>}
        <Text color={barColor}>{bar}</Text>
        <Text> </Text>
        <Text color={barColor} bold>{`${player.hp ?? 0}`.padStart(3)} HP</Text>
      </Box>
      <Text dimColor>
        {align === 'right' ? padLeft(`${moneyDisplay}  ${invLine}`, 28) : padRight(`${moneyDisplay}  ${invLine}`, 28)}
      </Text>
    </Box>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────────

export default function TanksView({ ws, gameState, playerId, onLeave }: TanksViewProps) {
  // ── State ──
  const [shopIndex, setShopIndex] = useState(0);
  const [activeField, setActiveField] = useState<FireField>('angle');
  const [shellIndex, setShellIndex] = useState(0);
  const [angleStr, setAngleStr] = useState('45');
  const [powerStr, setPowerStr] = useState('70');
  const [animFrame, setAnimFrame] = useState(0);
  const [showExplosion, setShowExplosion] = useState(false);
  const animSentRef = useRef(false);

  // ── Derived ──
  const gs = gameState;
  const isPlaying = gs?.status === 'playing';
  const isGameOver = gs?.status === 'game_over';
  const isWaiting = gs?.status === 'waiting';
  const myTurn = gs?.playerIds && gs.playerIds[gs.turnIndex] === playerId;
  const me = gs?.players?.[playerId];
  const otherId = gs?.playerIds?.find((id: string) => id !== playerId);
  const other = otherId ? gs?.players?.[otherId] : null;
  const tWidth = gs?.terrainWidth ?? 80;
  const tHeight = gs?.terrainHeight ?? 24;
  const terrain: number[] = gs?.terrain ?? new Array(tWidth).fill(3);
  const wind: number = gs?.wind ?? 0;

  // ── Shell selection ──
  const availableShells = useMemo(() => {
    if (!me) return SHELL_KEYS;
    return SHELL_KEYS.filter(k => {
      if (k === 'standard') return true;
      return (me.inventory?.[k] ?? 0) > 0;
    });
  }, [me?.inventory]);

  const selectedShell = availableShells[clamp(shellIndex, 0, availableShells.length - 1)] || 'standard';

  // ── Animation ──
  useEffect(() => {
    if (gs?.phase !== 'animating' || !gs?.lastAction?.details?.trajectory) {
      setAnimFrame(0);
      setShowExplosion(false);
      animSentRef.current = false;
      return;
    }

    const traj: { x: number; y: number }[] = gs.lastAction.details.trajectory;
    animSentRef.current = false;
    setAnimFrame(0);
    setShowExplosion(false);

    const interval = setInterval(() => {
      setAnimFrame(prev => {
        const next = prev + 1;
        if (next >= traj.length) {
          clearInterval(interval);
          setShowExplosion(true);
          // After explosion display, signal end
          setTimeout(() => {
            if (!animSentRef.current && gs.lastAction.playerId === playerId) {
              animSentRef.current = true;
              ws.send(JSON.stringify({ type: 'end_animation' }));
            }
          }, 1200);
          return traj.length;
        }
        return next;
      });
    }, 40);

    return () => clearInterval(interval);
  }, [gs?.phase, gs?.lastAction, playerId, ws]);

  // ── Input ──
  useInput((input, key) => {
    // Q to leave (always available except during animation)
    if ((input === 'q' || input === 'Q' || key.escape) && gs?.phase !== 'animating') {
      if (isGameOver || isWaiting) {
        onLeave?.();
        return;
      }
      if (isPlaying) {
        onLeave?.();
        return;
      }
    }

    if (!myTurn || !isPlaying) return;

    const send = (action: any) => ws.send(JSON.stringify(action));

    if (gs.phase === 'buy') {
      const totalItems = SHOP_ITEMS.length + 1; // +1 for "Done Shopping"
      if (key.upArrow) setShopIndex(i => Math.max(0, i - 1));
      if (key.downArrow) setShopIndex(i => Math.min(totalItems - 1, i + 1));
      if (key.return) {
        if (shopIndex < SHOP_ITEMS.length) {
          const item = SHOP_ITEMS[shopIndex];
          if (item.cost === 0) {
            // Standard shells are free and infinite, no buy needed
          } else {
            send({ type: 'buy', item: item.key });
          }
        } else {
          // Done shopping
          send({ type: 'end_buy' });
        }
      }
    } else if (gs.phase === 'fire') {
      if (key.return) {
        send({
          type: 'fire',
          angle: clamp(Number(angleStr) || 45, 0, 180),
          power: clamp(Number(powerStr) || 50, 1, 100),
          shellType: selectedShell,
        });
      } else if (key.tab) {
        setActiveField(f => f === 'shell' ? 'angle' : f === 'angle' ? 'power' : 'shell');
      } else if (key.leftArrow) {
        if (activeField === 'angle') setAngleStr(s => String(clamp((Number(s) || 45) - 1, 0, 180)));
        else if (activeField === 'power') setPowerStr(s => String(clamp((Number(s) || 50) - 1, 1, 100)));
      } else if (key.rightArrow) {
        if (activeField === 'angle') setAngleStr(s => String(clamp((Number(s) || 45) + 1, 0, 180)));
        else if (activeField === 'power') setPowerStr(s => String(clamp((Number(s) || 50) + 1, 1, 100)));
      } else if (activeField === 'shell') {
        if (key.upArrow) setShellIndex(i => (i - 1 + availableShells.length) % availableShells.length);
        if (key.downArrow) setShellIndex(i => (i + 1) % availableShells.length);
      } else if (key.backspace || key.delete) {
        if (activeField === 'angle') setAngleStr(s => s.slice(0, -1) || '');
        if (activeField === 'power') setPowerStr(s => s.slice(0, -1) || '');
      } else if (/\d/.test(input)) {
        if (activeField === 'angle') setAngleStr(s => (s + input).slice(0, 3));
        if (activeField === 'power') setPowerStr(s => (s + input).slice(0, 3));
      }
    }
  });

  // ── Null / loading guard ──
  if (!gs) {
    return (
      <Box borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1}>
        <Text color="cyan">Loading Terminal Tanks...</Text>
      </Box>
    );
  }

  // ── Waiting screen ──
  if (isWaiting) {
    return (
      <Box flexDirection="column" alignItems="center" paddingY={1}>
        <Box borderStyle="double" borderColor="cyan" paddingX={3} paddingY={1} flexDirection="column" alignItems="center">
          <Text bold color="cyan">
            {'╔══════════════════════════════════════╗'}
          </Text>
          <Text bold color="cyan">
            {'║      ⚔  T E R M I N A L  T A N K S  ║'}
          </Text>
          <Text bold color="cyan">
            {'╚══════════════════════════════════════╝'}
          </Text>
          <Text> </Text>
          <Text color="yellow">⏳ Waiting for another player to join...</Text>
          <Text> </Text>
          <Text dimColor>Press Q to return to lobby</Text>
        </Box>
      </Box>
    );
  }

  // ── Build terrain grid ──
  const grid: { char: string; fg: string; bold?: boolean }[][] = [];
  for (let y = 0; y < tHeight; y++) {
    const row: { char: string; fg: string; bold?: boolean }[] = [];
    for (let x = 0; x < tWidth; x++) {
      const groundTop = tHeight - (terrain[x] ?? 3);
      if (y < groundTop) {
        // Sky
        row.push({ char: ' ', fg: 'blueBright' });
      } else if (y === groundTop) {
        // Surface layer
        row.push({ char: '▓', fg: 'green' });
      } else if (y === groundTop + 1) {
        // Sub-surface
        row.push({ char: '▒', fg: 'green' });
      } else {
        // Deep ground
        row.push({ char: '░', fg: 'yellow' });
      }
    }
    grid.push(row);
  }

  // ── Draw tanks on grid ──
  if (gs.players) {
    for (const pid of gs.playerIds || []) {
      const p = gs.players[pid];
      if (!p) continue;
      const tankColor = p.color || 'white';
      
      // Determine facing direction: player on the left faces right, player on the right faces left
      const facingRight = p.x < tWidth / 2;
      
      // Get current aim angle for the active player during fire phase
      let displayAngle = 90; // default straight up
      if (pid === playerId && gs.phase === 'fire' && myTurn) {
        displayAngle = clamp(Number(angleStr) || 45, 0, 180);
      } else if (pid !== playerId && gs.phase === 'fire' && !myTurn) {
        displayAngle = 90; // opponent's angle unknown, show neutral
      }
      
      // Get angle-aware tank sprite
      const sprite = getTankSprite(displayAngle, facingRight);
      for (const part of sprite) {
        const gx = p.x + part.dx;
        const gy = p.y + part.dy;
        if (gx >= 0 && gx < tWidth && gy >= 0 && gy < tHeight) {
          grid[gy][gx] = { char: part.char, fg: tankColor, bold: true };
        }
      }
      
      // Player name label above tank
      const nameTag = p.name?.slice(0, 7) || pid.slice(0, 4);
      const labelY = p.y - 7;
      const labelStartX = p.x - Math.floor(nameTag.length / 2);
      if (labelY >= 0 && labelY < tHeight) {
        for (let ci = 0; ci < nameTag.length; ci++) {
          const lx = labelStartX + ci;
          if (lx >= 0 && lx < tWidth) {
            grid[labelY][lx] = { char: nameTag[ci], fg: tankColor, bold: true };
          }
        }
      }
    }
  }

  // ── Draw trajectory preview during fire phase ──
  if (gs.phase === 'fire' && myTurn && me) {
    const aimAngle = clamp(Number(angleStr) || 45, 0, 180);
    const aimPower = clamp(Number(powerStr) || 50, 1, 100);
    const startX = me.x;
    const startY = me.y - 1; // turret position
    const preview = getTrajectoryPreview(startX, startY, aimAngle, aimPower, wind, terrain, tHeight, tWidth);
    
    for (let i = 0; i < preview.length; i++) {
      const pt = preview[i];
      if (pt.x >= 0 && pt.x < tWidth && pt.y >= 0 && pt.y < tHeight) {
        // Don't overwrite tank pixels
        const existing = grid[pt.y][pt.x];
        if (existing.char === ' ' || existing.char === '▓' || existing.char === '▒' || existing.char === '░') {
          const fade = i / preview.length;
          const dotColor = fade < 0.3 ? 'whiteBright' : fade < 0.6 ? 'cyanBright' : 'gray';
          grid[pt.y][pt.x] = { char: '∙', fg: dotColor };
        }
      }
    }
  }

  // ── Draw projectile & trail ──
  if (gs.phase === 'animating' && gs.lastAction?.details?.trajectory) {
    const traj: { x: number; y: number }[] = gs.lastAction.details.trajectory;
    const currentFrame = Math.min(animFrame, traj.length - 1);

    // Draw trail dots
    for (let i = Math.max(0, currentFrame - 20); i < currentFrame; i++) {
      const tp = traj[i];
      if (tp && tp.x >= 0 && tp.x < tWidth && tp.y >= 0 && tp.y < tHeight) {
        const age = currentFrame - i;
        const trailColor = age < 5 ? 'yellowBright' : age < 12 ? 'yellow' : 'gray';
        grid[tp.y][tp.x] = { char: TRAIL_CHAR, fg: trailColor };
      }
    }

    // Draw projectile head
    if (!showExplosion && currentFrame < traj.length) {
      const pp = traj[currentFrame];
      if (pp && pp.x >= 0 && pp.x < tWidth && pp.y >= 0 && pp.y < tHeight) {
        grid[pp.y][pp.x] = { char: PROJECTILE_CHAR, fg: 'yellowBright', bold: true };
      }
    }

    // Draw explosion
    if (showExplosion && traj.length > 0) {
      const impact = traj[traj.length - 1];
      const shellType = gs.lastAction.details?.shellType || 'standard';
      const blastR = shellType === 'cluster' ? 6 : shellType === 'heavy' ? 4 : shellType === 'napalm' ? 5 : shellType === 'sniper' ? 1 : 3;

      for (let ey = Math.max(0, impact.y - blastR); ey <= Math.min(tHeight - 1, impact.y + blastR); ey++) {
        for (let ex = Math.max(0, impact.x - blastR); ex <= Math.min(tWidth - 1, impact.x + blastR); ex++) {
          const dist = Math.sqrt((ex - impact.x) ** 2 + (ey - impact.y) ** 2);
          if (dist <= blastR) {
            const eChar = EXPLOSION_CHARS[Math.floor(Math.random() * EXPLOSION_CHARS.length)];
            const eColor = dist < blastR * 0.3 ? 'whiteBright' : dist < blastR * 0.6 ? 'yellowBright' : 'redBright';
            grid[ey][ex] = { char: eChar, fg: eColor, bold: true };
          }
        }
      }
    }
  }

  // ── Render grid into <Text> segments ──
  const gridRows = grid.map((row, y) => {
    const segments: React.ReactElement[] = [];
    let buf = '';
    let curFg = row[0]?.fg || 'white';
    let curBold = row[0]?.bold || false;

    for (let x = 0; x < row.length; x++) {
      const cell = row[x];
      if (cell.fg !== curFg || (!!cell.bold) !== curBold) {
        if (buf) segments.push(<Text key={`${y}-${segments.length}`} color={curFg} bold={curBold}>{buf}</Text>);
        buf = cell.char;
        curFg = cell.fg;
        curBold = !!cell.bold;
      } else {
        buf += cell.char;
      }
    }
    if (buf) segments.push(<Text key={`${y}-${segments.length}`} color={curFg} bold={curBold}>{buf}</Text>);
    return <Box key={y}>{segments}</Box>;
  });

  // ── Header ──
  const turnLabel = myTurn
    ? <Text color="greenBright" bold>{'▶ YOUR TURN'}</Text>
    : <Text color="redBright">{"  OPPONENT'S TURN"}</Text>;

  const windDisplay = windArrow(wind);
  const roundDisplay = `Round ${gs.roundNumber ?? 1}`;

  const header = (
    <Box flexDirection="column" width={tWidth}>
      <Text bold color="cyan">
        {'┌' + '─'.repeat(tWidth - 2) + '┐'}
      </Text>
      <Text bold color="cyan">
        {'│' + padCenter('⚔  T E R M I N A L   T A N K S  ⚔', tWidth - 2) + '│'}
      </Text>
      <Text bold color="cyan">
        {'├' + '─'.repeat(tWidth - 2) + '┤'}
      </Text>
      <Box>
        <Text color="cyan">{'│ '}</Text>
        <PlayerStatBlock player={me} label="YOU" align="left" />
        <Box flexDirection="column" alignItems="center" width={16}>
          {turnLabel}
          <Text color="cyanBright" bold>{roundDisplay}</Text>
          <Text color={wind === 0 ? 'gray' : wind < 0 ? 'blueBright' : 'redBright'}>
            Wind: {windDisplay}
          </Text>
        </Box>
        <PlayerStatBlock player={other} label="FOE" align="right" />
        <Text color="cyan">{' │'}</Text>
      </Box>
      <Text bold color="cyan">
        {'└' + '─'.repeat(tWidth - 2) + '┘'}
      </Text>
    </Box>
  );

  // ── Battlefield frame ──
  const battlefield = (
    <Box flexDirection="column">
      <Text color="gray">{'╔' + '═'.repeat(tWidth) + '╗'}</Text>
      {gridRows.map((row, i) => (
        <Box key={i}>
          <Text color="gray">{'║'}</Text>
          {row}
          <Text color="gray">{'║'}</Text>
        </Box>
      ))}
      <Text color="gray">{'╚' + '═'.repeat(tWidth) + '╝'}</Text>
    </Box>
  );

  // ── Bottom Panel ──
  let bottomPanel: React.ReactElement | null = null;

  if (isGameOver) {
    const didWin = gs.winner === playerId;
    const winnerName = gs.winner ? (gs.players[gs.winner]?.name || 'Unknown') : 'Nobody';
    bottomPanel = (
      <Box flexDirection="column" alignItems="center" paddingY={1}>
        <Text color="yellow" bold>
          {'╔════════════════════════════════════════════╗'}
        </Text>
        <Text color="yellow" bold>
          {'║          '}
          <Text color={didWin ? 'greenBright' : 'redBright'} bold>
            {didWin ? '🏆  V I C T O R Y  🏆' : '💀  D E F E A T  💀  '}
          </Text>
          <Text color="yellow" bold>{'          ║'}</Text>
        </Text>
        <Text color="yellow" bold>
          {'╠════════════════════════════════════════════╣'}
        </Text>
        <Text color="yellow" bold>
          {'║  '}
          <Text color="white">Winner: </Text>
          <Text color="greenBright" bold>{padRight(winnerName, 33)}</Text>
          <Text color="yellow" bold>{'║'}</Text>
        </Text>
        <Text color="yellow" bold>
          {'╚════════════════════════════════════════════╝'}
        </Text>
        <Text> </Text>
        <Text dimColor>Press Q to return to lobby</Text>
      </Box>
    );
  } else if (gs.phase === 'animating') {
    const shooterName = gs.lastAction?.playerId
      ? (gs.players[gs.lastAction.playerId]?.name || 'Someone')
      : 'Someone';
    const shellName = gs.lastAction?.details?.shellType || 'standard';
    bottomPanel = (
      <Box paddingX={2} paddingY={0}>
        <Text color="yellowBright" bold>{'💣 '}</Text>
        <Text color="yellow" bold>{shooterName}</Text>
        <Text color="gray">{' fires a '}</Text>
        <Text color="redBright" bold>{shellName}</Text>
        <Text color="gray">{' shell!'}</Text>
        {showExplosion && <Text color="redBright" bold>{'  💥 BOOM!'}</Text>}
      </Box>
    );
  } else if (!myTurn) {
    bottomPanel = (
      <Box flexDirection="column" paddingX={2} paddingY={0}>
        <Box>
          <Text color="gray">{'⏳ Waiting for '}</Text>
          <Text color={other?.color || 'white'} bold>{other?.name || 'opponent'}</Text>
          <Text color="gray">{` to ${gs.phase === 'buy' ? 'shop' : 'fire'}...`}</Text>
        </Box>
        <Text dimColor>Press Q to leave</Text>
      </Box>
    );
  } else if (gs.phase === 'buy') {
    // ── Shop Panel ──
    const moneyDisplay = me?.money ?? 0;
    const shopRows = SHOP_ITEMS.map((item, i) => {
      const selected = i === shopIndex;
      const owned = item.key === 'standard' ? '∞' : String(me?.inventory?.[item.key] ?? 0);
      const canAfford = item.cost <= moneyDisplay;
      const prefix = selected ? '▸ ' : '  ';
      return (
        <Box key={item.key}>
          <Text color={selected ? 'cyanBright' : 'white'} bold={selected}>
            {prefix}
          </Text>
          <Text color={selected ? 'yellowBright' : 'white'} bold={selected}>
            {padRight(`${item.icon} ${item.name}`, 20)}
          </Text>
          <Text color={item.cost === 0 ? 'greenBright' : canAfford ? 'yellow' : 'red'}>
            {padRight(item.cost === 0 ? 'FREE' : `$${item.cost}`, 7)}
          </Text>
          <Text color="gray">
            {padRight(`DMG:${item.damage}`, 10)}
          </Text>
          <Text color="gray">
            {padRight(`R:${item.blast}`, 5)}
          </Text>
          <Text dimColor>
            {padRight(item.desc, 28)}
          </Text>
          <Text color="magenta">{`[${owned}]`}</Text>
        </Box>
      );
    });

    const doneSelected = shopIndex === SHOP_ITEMS.length;

    bottomPanel = (
      <Box flexDirection="column" paddingX={1}>
        <Text color="cyan" bold>
          {'┌──── ARMORY ─────────────────────────────────────────────────────────────────┐'}
        </Text>
        <Box>
          <Text color="cyan">{'│ '}</Text>
          <Text color="greenBright" bold>{`Balance: $${moneyDisplay}`}</Text>
          <Text color="gray">{' │ '}</Text>
          <Text dimColor>↑↓ Select  Enter: Buy  </Text>
          <Text color="cyan">{'│'}</Text>
        </Box>
        <Text color="cyan">
          {'├─────────────────────────────────────────────────────────────────────────────┤'}
        </Text>
        <Box flexDirection="column">
          <Box>
            <Text color="cyan">{'│ '}</Text>
            <Text dimColor bold>
              {padRight('  ITEM', 20)}
              {padRight('COST', 7)}
              {padRight('DAMAGE', 10)}
              {padRight('BLAST', 5)}
              {padRight('DESCRIPTION', 28)}
              {'QTY'}
            </Text>
            <Text color="cyan">{' │'}</Text>
          </Box>
          {shopRows.map((row, i) => (
            <Box key={i}>
              <Text color="cyan">{'│ '}</Text>
              {row}
              <Text color="cyan">{' │'}</Text>
            </Box>
          ))}
        </Box>
        <Text color="cyan">
          {'├─────────────────────────────────────────────────────────────────────────────┤'}
        </Text>
        <Box>
          <Text color="cyan">{'│ '}</Text>
          <Text color={doneSelected ? 'greenBright' : 'gray'} bold={doneSelected}>
            {doneSelected ? '▸ ' : '  '}
            {'✓ Done Shopping — Proceed to Fire'}
          </Text>
          <Text color="cyan">
            {' '.repeat(Math.max(0, 43 - '✓ Done Shopping — Proceed to Fire'.length))}
            {'│'}
          </Text>
        </Box>
        <Text color="cyan" bold>
          {'└──────────────────────────────────────────────────────────────────────────── ┘'}
        </Text>
        <Text dimColor>Press Q to leave game</Text>
      </Box>
    );
  } else if (gs.phase === 'fire') {
    // ── Fire Controls ──
    const angle = Number(angleStr) || 45;
    const power = Number(powerStr) || 50;

    // Visual angle indicator using simple text
    const angleDisplay = `${angle}°`;

    // Power bar
    const pwrFilled = Math.round((power / 100) * 20);
    const pwrEmpty = 20 - pwrFilled;
    const pwrColor = power > 75 ? 'redBright' : power > 40 ? 'yellowBright' : 'greenBright';
    const pwrBar = '█'.repeat(pwrFilled) + '░'.repeat(pwrEmpty);

    // Shell info
    const shellInfo = SHOP_ITEMS.find(s => s.key === selectedShell);
    const shellCount = selectedShell === 'standard' ? '∞' : String(me?.inventory?.[selectedShell] ?? 0);

    bottomPanel = (
      <Box flexDirection="column" paddingX={1}>
        <Text color="red" bold>
          {'┌──── FIRE CONTROL ───────────────────────────────────────────────────────────┐'}
        </Text>
        <Box>
          <Text color="red">{'│ '}</Text>
          {/* Shell selector */}
          <Box width={26}>
            <Text color={activeField === 'shell' ? 'cyanBright' : 'gray'} bold={activeField === 'shell'}>
              {activeField === 'shell' ? '▸' : ' '}
              {'Shell: '}
            </Text>
            <Text color="yellowBright" bold>
              {`${shellInfo?.icon || '●'} ${shellInfo?.name || selectedShell}`}
            </Text>
            <Text color="magenta">{` [${shellCount}]`}</Text>
          </Box>
          <Text color="gray">{' │ '}</Text>
          {/* Angle */}
          <Box width={16}>
            <Text color={activeField === 'angle' ? 'cyanBright' : 'gray'} bold={activeField === 'angle'}>
              {activeField === 'angle' ? '▸' : ' '}
              {'Angle: '}
            </Text>
            <Text color="whiteBright" bold>{padRight(angleDisplay, 5)}</Text>
            <Text color="yellow">{getAngleIndicator(Number(angleStr) || 45)}</Text>
          </Box>
          <Text color="gray">{' │ '}</Text>
          {/* Power */}
          <Box width={16}>
            <Text color={activeField === 'power' ? 'cyanBright' : 'gray'} bold={activeField === 'power'}>
              {activeField === 'power' ? '▸' : ' '}
              {'Power: '}
            </Text>
            <Text color="whiteBright" bold>{`${power}%`}</Text>
          </Box>
          <Text color="red">{' │'}</Text>
        </Box>
        <Box>
          <Text color="red">{'│ '}</Text>
          <Text color={pwrColor}>{`  Power: ${pwrBar} `}</Text>
          <Text color="gray">{'│ '}</Text>
          <Text color={wind === 0 ? 'gray' : wind < 0 ? 'blueBright' : 'redBright'}>
            {`Wind: ${windArrow(wind)}`}
          </Text>
          <Text color="red">
            {' '.repeat(Math.max(0, 30 - `Wind: ${windArrow(wind)}`.length))}
            {'│'}
          </Text>
        </Box>
        <Text color="red">
          {'├─────────────────────────────────────────────────────────────────────────────┤'}
        </Text>
        <Box>
          <Text color="red">{'│ '}</Text>
          <Text dimColor>Tab: switch field  ↑↓: shell  ←→/type: angle/power  Enter: </Text>
          <Text color="redBright" bold>FIRE!</Text>
          <Text dimColor>{'  Q: leave'}</Text>
          <Text color="red">{' │'}</Text>
        </Box>
        <Text color="red" bold>
          {'└──────────────────────────────────────────────────────────────────────────── ┘'}
        </Text>
      </Box>
    );
  }

  // ── Last action log ──
  let actionLog: React.ReactElement | null = null;
  if (gs.lastAction && gs.phase !== 'animating') {
    const actor = gs.players?.[gs.lastAction.playerId];
    const actorName = actor?.name || 'Someone';
    const actorColor = actor?.color || 'white';
    if (gs.lastAction.type === 'fire') {
      const dmg = gs.lastAction.details?.damage ?? '?';
      actionLog = (
        <Box paddingX={2}>
          <Text color="gray">{'Last: '}</Text>
          <Text color={actorColor} bold>{actorName}</Text>
          <Text color="gray">{` fired ${gs.lastAction.details?.shellType || 'a shell'} for `}</Text>
          <Text color="redBright" bold>{`${dmg} damage`}</Text>
        </Box>
      );
    } else if (gs.lastAction.type === 'buy') {
      actionLog = (
        <Box paddingX={2}>
          <Text color="gray">{'Last: '}</Text>
          <Text color={actorColor} bold>{actorName}</Text>
          <Text color="gray">{` bought ${gs.lastAction.details?.item || 'something'}`}</Text>
        </Box>
      );
    }
  }

  // ── Final Layout ──
  return (
    <Box flexDirection="column">
      {header}
      {battlefield}
      {actionLog}
      {bottomPanel}
    </Box>
  );
}
