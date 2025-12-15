import { z } from 'zod';
import type { TextStyle } from '$lib/types/text-formatting';
import { RETRO_FONTS } from '$lib/types/text-formatting';

// Text style constraints (different from BBCode - style picker has smaller max)
export const TEXT_STYLE_CONSTRAINTS = {
	minFontSize: 8,
	maxFontSize: 18,
	maxGradientColors: 3
};

// Hex color schema
const hexColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid hex color format');

// Font family schema - validates against RETRO_FONTS keys
const fontFamilyKeys = Object.keys(RETRO_FONTS) as [string, ...string[]];
const fontFamilySchema = z.enum(fontFamilyKeys);

// Font size schema with clamping
const fontSizeSchema = z.coerce
	.number()
	.int()
	.transform((val) =>
		Math.max(TEXT_STYLE_CONSTRAINTS.minFontSize, Math.min(TEXT_STYLE_CONSTRAINTS.maxFontSize, val))
	);

// Gradient schema - array of 1-3 hex colors
const gradientSchema = z
	.array(hexColorSchema)
	.min(1)
	.max(TEXT_STYLE_CONSTRAINTS.maxGradientColors)
	.optional();

// Full TextStyle schema
const textStyleSchema = z.object({
	fontFamily: fontFamilySchema.default('pixelated'),
	fontSize: fontSizeSchema.default(14),
	color: hexColorSchema.optional(),
	gradient: gradientSchema,
	bold: z.boolean().default(false),
	italic: z.boolean().default(false),
	underline: z.boolean().default(false),
	strikethrough: z.boolean().default(false)
});

// Legacy helper functions (for backwards compatibility)
export function validateHexColor(color: string): boolean {
	return hexColorSchema.safeParse(color).success;
}

export function validateFontFamily(fontFamily: string): boolean {
	return fontFamilySchema.safeParse(fontFamily).success;
}

export function validateFontSize(size: number): number {
	const result = fontSizeSchema.safeParse(size);
	return result.success ? result.data : 14;
}

export function validateGradient(gradient: unknown): string[] | undefined {
	const result = gradientSchema.safeParse(gradient);
	return result.success ? result.data : undefined;
}

export function validateTextStyle(style: unknown): TextStyle | null {
	if (!style || typeof style !== 'object') return null;

	const result = textStyleSchema.safeParse(style);
	if (!result.success) return null;

	return result.data as TextStyle;
}

export function sanitizeStyleData(styleData: unknown): TextStyle | undefined {
	if (!styleData) return undefined;

	// Handle JSON string input
	let parsedData: unknown = styleData;
	if (typeof styleData === 'string') {
		try {
			parsedData = JSON.parse(styleData);
		} catch {
			return undefined;
		}
	}

	const validated = validateTextStyle(parsedData);
	return validated || undefined;
}
