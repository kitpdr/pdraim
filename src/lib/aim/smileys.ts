/**
 * AIM "Yellow Smiley" set (AIM 4.x/5.x). Typed codes become the original
 * 19×19 GIFs from /static/smileys (local-only, AOL artwork). When a GIF is
 * missing the browser shows the img alt text, which is the Unicode emoji.
 */
export interface Smiley {
	file: string;
	codes: string[];
	label: string;
	emoji: string;
}

export const SMILEYS: Smiley[] = [
	{ file: '01', codes: [':-)', ':)'], label: 'Content', emoji: '🙂' },
	{ file: '02', codes: [';-)', ';)'], label: 'Clin d’œil', emoji: '😉' },
	{ file: '03', codes: [':-(', ':('], label: 'Triste', emoji: '🙁' },
	{ file: '04', codes: [':-P', ':-p', ':P', ':p'], label: 'Langue', emoji: '😛' },
	{ file: '05', codes: ['=-O', '=-o'], label: 'Surpris', emoji: '😮' },
	{ file: '06', codes: [':-*'], label: 'Bisou', emoji: '😘' },
	{ file: '07', codes: ['>:o'], label: 'Crie', emoji: '😠' },
	{ file: '08', codes: [':-D', ':D'], label: 'Rire', emoji: '😁' },
	{ file: '09', codes: [':-$'], label: 'Radin', emoji: '🤑' },
	{ file: '10', codes: [':-!'], label: 'Gaffe', emoji: '😬' },
	{ file: '11', codes: [':-['], label: 'Gêné', emoji: '😳' },
	{ file: '12', codes: ['O:-)'], label: 'Innocent', emoji: '😇' },
	{ file: '13', codes: [':-\\'], label: 'Indécis', emoji: '😕' },
	{ file: '14', codes: [":'("], label: 'Pleure', emoji: '😢' },
	{ file: '15', codes: [':-X', ':-x'], label: 'Bouche cousue', emoji: '🤐' },
	{ file: '16', codes: ['8-)'], label: 'Cool', emoji: '😎' }
];

const escape = (text: string) =>
	text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');

// Codes are matched on already-escaped HTML, so match their escaped form.
const byEscapedCode = new Map<string, Smiley>();
for (const smiley of SMILEYS)
	for (const code of smiley.codes) byEscapedCode.set(escape(code), smiley);

const pattern = new RegExp(
	// Longest first so "O:-)" wins over ":-)"; codes must not touch letters/digits.
	`(^|[^\\w])(${[...byEscapedCode.keys()]
		.sort((a, b) => b.length - a.length)
		.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
		.join('|')})(?=$|[^\\w])`,
	'g'
);

export function smileyImg(smiley: Smiley) {
	return `<img class="aim-smiley" src="/smileys/${smiley.file}.gif" alt="${smiley.emoji}" title="${escape(smiley.codes[0])}" width="19" height="19" draggable="false">`;
}

/**
 * Replace smiley codes in escaped HTML text. Only text between tags is
 * touched so attributes (style="color: …") are never rewritten.
 */
export function replaceSmileys(html: string): string {
	return html
		.split(/(<[^>]*>)/)
		.map((part) =>
			part.startsWith('<')
				? part
				: part.replace(pattern, (_, before: string, code: string) => {
						const smiley = byEscapedCode.get(code);
						return smiley ? before + smileyImg(smiley) : _;
					})
		)
		.join('');
}
