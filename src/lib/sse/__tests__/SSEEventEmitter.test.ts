/**
 * Unit tests for SSEEventEmitter
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// We need to import the class, not the singleton for testing
// First, let's create a test-friendly version

describe('SSEEventEmitter', () => {
	// Import the module fresh for each test
	let SSEEventEmitter: typeof import('../SSEEventEmitter');

	beforeEach(async () => {
		// Clear module cache and re-import
		vi.resetModules();
		SSEEventEmitter = await import('../SSEEventEmitter');
	});

	describe('emit', () => {
		it('should broadcast events to all listeners on the sse channel', () => {
			const { sseEmitter } = SSEEventEmitter;
			const listener = vi.fn();

			sseEmitter.addListener('sse', listener);

			sseEmitter.emit('chatMessage', {
				id: '123',
				chatRoomId: 'room1',
				senderId: 'user1',
				content: 'Hello',
				type: 'chat',
				timestamp: Date.now()
			});

			expect(listener).toHaveBeenCalledTimes(1);
			expect(listener).toHaveBeenCalledWith(
				expect.objectContaining({
					type: 'chatMessage',
					data: expect.objectContaining({
						id: '123',
						content: 'Hello'
					})
				})
			);
		});

		it('should include event ID when provided', () => {
			const { sseEmitter } = SSEEventEmitter;
			const listener = vi.fn();

			sseEmitter.addListener('sse', listener);

			sseEmitter.emit(
				'chatMessage',
				{
					id: '123',
					chatRoomId: 'room1',
					senderId: 'user1',
					content: 'Hello',
					type: 'chat',
					timestamp: Date.now()
				},
				'event-id-456'
			);

			expect(listener).toHaveBeenCalledWith(
				expect.objectContaining({
					id: 'event-id-456'
				})
			);
		});
	});

	describe('addListener', () => {
		it('should return a cleanup function', () => {
			const { sseEmitter } = SSEEventEmitter;
			const listener = vi.fn();

			const cleanup = sseEmitter.addListener('sse', listener);

			expect(typeof cleanup).toBe('function');
			expect(sseEmitter.getListenerCount('sse')).toBe(1);

			cleanup();
			expect(sseEmitter.getListenerCount('sse')).toBe(0);
		});

		it('should support multiple listeners', () => {
			const { sseEmitter } = SSEEventEmitter;
			const listener1 = vi.fn();
			const listener2 = vi.fn();

			sseEmitter.addListener('sse', listener1);
			sseEmitter.addListener('sse', listener2);

			sseEmitter.emit('buddyListUpdate', []);

			expect(listener1).toHaveBeenCalledTimes(1);
			expect(listener2).toHaveBeenCalledTimes(1);
		});
	});

	describe('removeListener', () => {
		it('should remove a specific listener', () => {
			const { sseEmitter } = SSEEventEmitter;
			const listener = vi.fn();

			sseEmitter.addListener('sse', listener);
			expect(sseEmitter.getListenerCount('sse')).toBe(1);

			const removed = sseEmitter.removeListener('sse', listener);
			expect(removed).toBe(true);
			expect(sseEmitter.getListenerCount('sse')).toBe(0);
		});

		it('should return false for non-existent listener', () => {
			const { sseEmitter } = SSEEventEmitter;
			const listener = vi.fn();

			const removed = sseEmitter.removeListener('sse', listener);
			expect(removed).toBe(false);
		});
	});

	describe('removeAllListeners', () => {
		it('should remove all listeners for a channel', () => {
			const { sseEmitter } = SSEEventEmitter;
			const listener1 = vi.fn();
			const listener2 = vi.fn();

			sseEmitter.addListener('sse', listener1);
			sseEmitter.addListener('sse', listener2);
			expect(sseEmitter.getListenerCount('sse')).toBe(2);

			sseEmitter.removeAllListeners('sse');
			expect(sseEmitter.getListenerCount('sse')).toBe(0);
		});

		it('should remove all listeners when no channel specified', () => {
			const { sseEmitter } = SSEEventEmitter;
			const listener = vi.fn();

			sseEmitter.addListener('sse', listener);
			sseEmitter.addListener('other', listener);

			sseEmitter.removeAllListeners();
			expect(sseEmitter.getListenerCount()).toBe(0);
		});
	});

	describe('hasListeners', () => {
		it('should return true when channel has listeners', () => {
			const { sseEmitter } = SSEEventEmitter;
			const listener = vi.fn();

			sseEmitter.addListener('sse', listener);
			expect(sseEmitter.hasListeners('sse')).toBe(true);
		});

		it('should return false when channel has no listeners', () => {
			const { sseEmitter } = SSEEventEmitter;
			expect(sseEmitter.hasListeners('sse')).toBe(false);
		});
	});

	describe('error handling', () => {
		it('should continue broadcasting even if a listener throws', () => {
			const { sseEmitter } = SSEEventEmitter;
			const badListener = vi.fn(() => {
				throw new Error('Listener error');
			});
			const goodListener = vi.fn();

			sseEmitter.addListener('sse', badListener);
			sseEmitter.addListener('sse', goodListener);

			// Should not throw
			expect(() => {
				sseEmitter.emit('buddyListUpdate', []);
			}).not.toThrow();

			// Good listener should still be called
			expect(goodListener).toHaveBeenCalledTimes(1);
		});
	});
});
