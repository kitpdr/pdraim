import { z } from 'zod';
import { RETRO_FONTS } from '$lib/types/text-formatting';

// Build allowed fonts Set from RETRO_FONTS - includes both keys and display names
const ALLOWED_FONTS_SET = new Set<string>();
for (const [key, value] of Object.entries(RETRO_FONTS)) {
	// Add the key (e.g., 'comicsans')
	ALLOWED_FONTS_SET.add(key.toLowerCase());
	// Add the display name (e.g., 'comic sans ms')
	ALLOWED_FONTS_SET.add(value.name.toLowerCase());
}

// BBCode constraints
export const BBCODE_CONSTRAINTS = {
	minFontSize: 8,
	maxFontSize: 24,
	namedColors: [
		'red',
		'blue',
		'green',
		'yellow',
		'orange',
		'purple',
		'pink',
		'black',
		'white',
		'gray',
		'grey',
		'brown',
		'cyan',
		'magenta',
		'lime',
		'navy',
		'teal',
		'maroon'
	] as const
};

// Hex color schema - validates 6-digit hex colors
const hexColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid hex color format');

// Named color schema - validates against predefined list
const namedColorSchema = z.enum(BBCODE_CONSTRAINTS.namedColors);

// Combined color schema - accepts either hex or named color
export const bbcodeColorSchema = z.union([hexColorSchema, namedColorSchema]);

// Font size schema - validates range 8-24
export const bbcodeFontSizeSchema = z.coerce
	.number()
	.int('Font size must be an integer')
	.min(
		BBCODE_CONSTRAINTS.minFontSize,
		`Font size must be at least ${BBCODE_CONSTRAINTS.minFontSize}px`
	)
	.max(
		BBCODE_CONSTRAINTS.maxFontSize,
		`Font size cannot exceed ${BBCODE_CONSTRAINTS.maxFontSize}px`
	);

// Font family schema - validates against RETRO_FONTS (both keys and names)
export const bbcodeFontFamilySchema = z
	.string()
	.transform((val) => val.toLowerCase().trim())
	.refine((val) => ALLOWED_FONTS_SET.has(val), {
		message: 'Invalid font family'
	});

// Validation helper functions that return boolean (for use in text-formatter)
export function isValidBBCodeColor(color: string): boolean {
	return bbcodeColorSchema.safeParse(color.toLowerCase()).success;
}

export function isValidBBCodeFontSize(size: string): boolean {
	return bbcodeFontSizeSchema.safeParse(size).success;
}

export function isValidBBCodeFont(font: string): boolean {
	return ALLOWED_FONTS_SET.has(font.toLowerCase().trim());
}

// Type exports for use elsewhere
export type BBCodeColor = z.infer<typeof bbcodeColorSchema>;
export type BBCodeFontSize = z.infer<typeof bbcodeFontSizeSchema>;
export type BBCodeFontFamily = z.infer<typeof bbcodeFontFamilySchema>;
