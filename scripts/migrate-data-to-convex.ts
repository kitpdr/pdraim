/**
 * Migration script to import Turso data to Convex with proper ID mapping.
 *
 * This script:
 * 1. Clears existing data in Convex
 * 2. Imports users and builds oldId → newId mapping
 * 3. Imports chat rooms and builds oldId → newId mapping
 * 4. Imports messages with mapped user and room IDs
 *
 * Usage: CONVEX_URL=<url> CONVEX_API_SECRET=<secret> npx tsx scripts/migrate-data-to-convex.ts
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const EXPORTS_DIR = './exports';

// Get environment variables
const CONVEX_URL = process.env.CONVEX_URL || process.env.PUBLIC_CONVEX_URL;
const CONVEX_API_SECRET = process.env.CONVEX_API_SECRET;

if (!CONVEX_URL || !CONVEX_API_SECRET) {
	console.error('Missing environment variables. Set CONVEX_URL and CONVEX_API_SECRET');
	console.error(
		'Example: CONVEX_URL=https://quirky-giraffe-19.convex.cloud CONVEX_API_SECRET=xxx npx tsx scripts/migrate-data-to-convex.ts'
	);
	process.exit(1);
}

// Convert .cloud URL to .site URL for HTTP actions
const HTTP_URL = CONVEX_URL.replace('.convex.cloud', '.convex.site');

console.log('Migrating to:', HTTP_URL);

// Helper to call Convex HTTP endpoints
async function convexFetch<T>(path: string, body: Record<string, unknown> = {}): Promise<T> {
	const url = `${HTTP_URL}${path}`;
	const response = await fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-Convex-Secret': CONVEX_API_SECRET!
		},
		body: JSON.stringify(body)
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Convex HTTP error: ${response.status} - ${error}`);
	}

	return response.json();
}

// Types for our data
interface OldUser {
	id: string;
	password: string;
	nickname: string;
	status: string;
	avatarUrl: string | null;
	createdAt: number;
	lastSeen: number | null;
}

interface OldChatRoom {
	id: string;
	name: string | null;
	type: string;
	createdAt: number;
}

interface OldMessage {
	id: string;
	chatRoomId: string;
	senderId: string;
	content: string;
	type: string;
	timestamp: number;
	styleData: string | null;
	hasFormatting: number | boolean;
}

async function migrate() {
	// ID mappings: oldId → newConvexId
	const userIdMap = new Map<string, string>();
	const roomIdMap = new Map<string, string>();

	// Step 1: Load exported data
	console.log('\n📂 Loading exported data...');
	const users: OldUser[] = JSON.parse(readFileSync(join(EXPORTS_DIR, 'users.json'), 'utf-8'));
	const chatRooms: OldChatRoom[] = JSON.parse(
		readFileSync(join(EXPORTS_DIR, 'chat_rooms.json'), 'utf-8')
	);
	const messages: OldMessage[] = JSON.parse(
		readFileSync(join(EXPORTS_DIR, 'messages.json'), 'utf-8')
	);

	console.log(
		`  Found ${users.length} users, ${chatRooms.length} rooms, ${messages.length} messages`
	);

	// Step 2: Import users
	console.log('\n👤 Importing users...');
	for (const user of users) {
		try {
			const result = await convexFetch<{ userId: string }>('/api/users/create', {
				nickname: user.nickname,
				password: user.password // Already hashed
			});
			userIdMap.set(user.id, result.userId);
			console.log(`  ✓ ${user.nickname} → ${result.userId}`);
		} catch (err) {
			// User might already exist, try to get by nickname
			const existing = await convexFetch<{ _id: string } | null>('/api/users/getByNickname', {
				nickname: user.nickname
			});
			if (existing) {
				userIdMap.set(user.id, existing._id);
				console.log(`  ⚡ ${user.nickname} already exists → ${existing._id}`);
			} else {
				console.error(`  ✗ Failed to import ${user.nickname}:`, err);
			}
		}
	}

	// Step 3: Import chat rooms
	console.log('\n🏠 Importing chat rooms...');
	for (const room of chatRooms) {
		try {
			// Use getOrCreateDefault for the General room
			if (room.name === 'General' && room.type === 'group') {
				const result = await convexFetch<{ _id: string }>('/api/chatRooms/getOrCreateDefault', {});
				roomIdMap.set(room.id, result._id);
				console.log(`  ✓ ${room.name} → ${result._id}`);
			} else {
				// For other rooms, we'd need a create endpoint - skip for now
				console.log(`  ⚠ Skipping non-General room: ${room.name}`);
			}
		} catch (err) {
			console.error(`  ✗ Failed to import room ${room.name}:`, err);
		}
	}

	// Step 4: Import messages
	console.log('\n💬 Importing messages...');
	let imported = 0;
	let skipped = 0;

	// Sort messages by timestamp to maintain order
	messages.sort((a, b) => a.timestamp - b.timestamp);

	for (const msg of messages) {
		const newSenderId = userIdMap.get(msg.senderId);
		const newRoomId = roomIdMap.get(msg.chatRoomId);

		if (!newSenderId) {
			console.log(`  ⚠ Skipping message - unknown sender: ${msg.senderId}`);
			skipped++;
			continue;
		}

		if (!newRoomId) {
			console.log(`  ⚠ Skipping message - unknown room: ${msg.chatRoomId}`);
			skipped++;
			continue;
		}

		try {
			await convexFetch('/api/messages/send', {
				chatRoomId: newRoomId,
				senderId: newSenderId,
				content: msg.content,
				type: msg.type || 'chat',
				styleData: msg.styleData || undefined,
				hasFormatting: Boolean(msg.hasFormatting)
			});
			imported++;
			if (imported % 10 === 0) {
				console.log(`  ✓ Imported ${imported} messages...`);
			}
		} catch (err) {
			console.error(`  ✗ Failed to import message:`, err);
			skipped++;
		}
	}

	console.log(`\n✅ Migration complete!`);
	console.log(`   Users: ${userIdMap.size}`);
	console.log(`   Rooms: ${roomIdMap.size}`);
	console.log(`   Messages: ${imported} imported, ${skipped} skipped`);

	// Print ID mappings for reference
	console.log('\n📋 User ID Mappings:');
	for (const [oldId, newId] of userIdMap) {
		const user = users.find((u) => u.id === oldId);
		console.log(`   ${user?.nickname}: ${oldId} → ${newId}`);
	}
}

migrate().catch(console.error);
