/**
 * This script prepares the Turso export data for Convex import.
 * It removes oldId fields and creates a clean import structure.
 *
 * Usage: npx tsx scripts/prepare-convex-import.ts
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const EXPORTS_DIR = './exports';
const IMPORT_DIR = './convex-import';

// Ensure import directory exists
if (!existsSync(IMPORT_DIR)) {
	mkdirSync(IMPORT_DIR, { recursive: true });
}

// Read and transform users
console.log('Processing users...');
const usersRaw = JSON.parse(readFileSync(join(EXPORTS_DIR, 'users.json'), 'utf-8'));
const users = usersRaw.map((user: Record<string, unknown>) => ({
	password: user.password,
	nickname: user.nickname,
	status: 'offline', // Reset status
	avatarUrl: user.avatarUrl || undefined,
	createdAt: user.createdAt,
	lastSeen: user.lastSeen || undefined
}));
writeFileSync(
	join(IMPORT_DIR, 'users.jsonl'),
	users.map((u: unknown) => JSON.stringify(u)).join('\n')
);
console.log(`  Processed ${users.length} users`);

// Read and transform chat rooms
console.log('Processing chat rooms...');
const roomsRaw = JSON.parse(readFileSync(join(EXPORTS_DIR, 'chat_rooms.json'), 'utf-8'));
const chatRooms = roomsRaw.map((room: Record<string, unknown>) => ({
	name: room.name || undefined,
	type: room.type,
	createdAt: room.createdAt
}));
writeFileSync(
	join(IMPORT_DIR, 'chatRooms.jsonl'),
	chatRooms.map((r: unknown) => JSON.stringify(r)).join('\n')
);
console.log(`  Processed ${chatRooms.length} chat rooms`);

// For messages, we need to map old IDs to new format
// Since we're doing a fresh import, messages will need user and room references
// We'll skip messages for now - they'll be recreated fresh
console.log('Skipping messages (will start fresh)');

// Sessions are also skipped - users will need to log in again
console.log('Skipping sessions (users will need to log in again)');

console.log('\nImport files created in', IMPORT_DIR);
console.log('\nTo import to Convex dev:');
console.log('  npx convex import --table users convex-import/users.jsonl --replace');
console.log('  npx convex import --table chatRooms convex-import/chatRooms.jsonl --replace');
console.log('\nOr deploy schema first, then import:');
console.log('  npx convex dev --once');
console.log('  npx convex import --table users convex-import/users.jsonl --replace');
console.log('  npx convex import --table chatRooms convex-import/chatRooms.jsonl --replace');
