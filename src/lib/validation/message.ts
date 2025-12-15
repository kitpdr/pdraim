import { z } from 'zod';

// Message constraints
export const MAX_MESSAGE_LENGTH = 500;
export const MIN_MESSAGE_LENGTH = 1;

// Message content schema
export const messageContentSchema = z
	.string()
	.min(MIN_MESSAGE_LENGTH, 'Message cannot be empty')
	.max(MAX_MESSAGE_LENGTH, `Message cannot exceed ${MAX_MESSAGE_LENGTH} characters`)
	.trim();

// Full send message request schema
// Note: ID format validation is relaxed - DB queries validate existence
export const sendMessageSchema = z.object({
	content: messageContentSchema,
	userId: z.string().min(1, 'User ID is required'),
	chatRoomId: z.string().min(1).optional(),
	type: z.enum(['chat', 'emote', 'system']).default('chat'),
	styleData: z.unknown().optional()
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;

// Validation helper function
export function validateMessageContent(content: string): {
	isValid: boolean;
	error?: string;
	sanitized: string;
} {
	const result = messageContentSchema.safeParse(content);

	if (result.success) {
		return {
			isValid: true,
			sanitized: result.data
		};
	}

	return {
		isValid: false,
		error: result.error.issues[0]?.message || 'Invalid message',
		sanitized: content.slice(0, MAX_MESSAGE_LENGTH).trim()
	};
}
