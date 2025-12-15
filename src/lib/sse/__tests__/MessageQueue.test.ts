/**
 * Unit tests for MessageQueue
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MessageQueue } from '../MessageQueue';

describe('MessageQueue', () => {
	let queue: MessageQueue;

	beforeEach(() => {
		// Create a queue with short TTL for testing
		queue = new MessageQueue(1000, 10); // 1 second TTL, max 10 messages
	});

	afterEach(() => {
		queue.stopCleanup();
		queue.clear();
	});

	describe('enqueue', () => {
		it('should add a message to the queue and return an ID', () => {
			const id = queue.enqueue('room1', 'chatMessage', { text: 'hello' });

			expect(id).toBeDefined();
			expect(typeof id).toBe('string');
			expect(id.length).toBeGreaterThan(0);
		});

		it('should store messages by room ID', () => {
			queue.enqueue('room1', 'chatMessage', { text: 'hello' });
			queue.enqueue('room2', 'chatMessage', { text: 'world' });

			const room1Messages = queue.getMessages('room1');
			const room2Messages = queue.getMessages('room2');

			expect(room1Messages).toHaveLength(1);
			expect(room2Messages).toHaveLength(1);
			expect(room1Messages[0].data).toEqual({ text: 'hello' });
			expect(room2Messages[0].data).toEqual({ text: 'world' });
		});

		it('should enforce max queue size', () => {
			// Add more than max (10) messages
			for (let i = 0; i < 15; i++) {
				queue.enqueue('room1', 'chatMessage', { index: i });
			}

			const messages = queue.getMessages('room1');
			expect(messages).toHaveLength(10);

			// Should keep the newest messages
			expect(messages[0].data).toEqual({ index: 5 });
			expect(messages[9].data).toEqual({ index: 14 });
		});
	});

	describe('getMessagesSince', () => {
		it('should return messages after a given ID', () => {
			const id1 = queue.enqueue('room1', 'chatMessage', { index: 1 });
			const id2 = queue.enqueue('room1', 'chatMessage', { index: 2 });
			queue.enqueue('room1', 'chatMessage', { index: 3 });

			const messagesSinceId1 = queue.getMessagesSince('room1', id1);
			expect(messagesSinceId1).toHaveLength(2);
			expect(messagesSinceId1[0].data).toEqual({ index: 2 });
			expect(messagesSinceId1[1].data).toEqual({ index: 3 });

			const messagesSinceId2 = queue.getMessagesSince('room1', id2);
			expect(messagesSinceId2).toHaveLength(1);
			expect(messagesSinceId2[0].data).toEqual({ index: 3 });
		});

		it('should return recent messages if ID not found', () => {
			for (let i = 0; i < 5; i++) {
				queue.enqueue('room1', 'chatMessage', { index: i });
			}

			const messages = queue.getMessagesSince('room1', 'unknown-id');
			expect(messages).toHaveLength(5);
		});

		it('should return empty array for non-existent room', () => {
			const messages = queue.getMessagesSince('nonexistent', 'some-id');
			expect(messages).toEqual([]);
		});
	});

	describe('getLatestEventId', () => {
		it('should return the ID of the last message', () => {
			queue.enqueue('room1', 'chatMessage', { index: 1 });
			const id2 = queue.enqueue('room1', 'chatMessage', { index: 2 });

			expect(queue.getLatestEventId('room1')).toBe(id2);
		});

		it('should return null for empty room', () => {
			expect(queue.getLatestEventId('nonexistent')).toBeNull();
		});
	});

	describe('hasEventId', () => {
		it('should return true if event ID exists', () => {
			const id = queue.enqueue('room1', 'chatMessage', { text: 'hello' });
			expect(queue.hasEventId('room1', id)).toBe(true);
		});

		it('should return false if event ID does not exist', () => {
			expect(queue.hasEventId('room1', 'unknown')).toBe(false);
		});
	});

	describe('cleanup', () => {
		it('should remove expired messages', async () => {
			vi.useFakeTimers();

			queue.enqueue('room1', 'chatMessage', { text: 'old' });

			// Fast-forward past TTL
			vi.advanceTimersByTime(2000);

			const removed = queue.cleanup();
			expect(removed).toBe(1);
			expect(queue.getMessages('room1')).toHaveLength(0);

			vi.useRealTimers();
		});

		it('should keep non-expired messages', async () => {
			vi.useFakeTimers();

			queue.enqueue('room1', 'chatMessage', { text: 'message' });

			// Fast-forward but not past TTL
			vi.advanceTimersByTime(500);

			const removed = queue.cleanup();
			expect(removed).toBe(0);
			expect(queue.getMessages('room1')).toHaveLength(1);

			vi.useRealTimers();
		});
	});

	describe('getStats', () => {
		it('should return correct statistics', () => {
			queue.enqueue('room1', 'chatMessage', { text: '1' });
			queue.enqueue('room1', 'chatMessage', { text: '2' });
			queue.enqueue('room2', 'chatMessage', { text: '3' });

			const stats = queue.getStats();
			expect(stats.rooms).toBe(2);
			expect(stats.totalMessages).toBe(3);
		});
	});
});
