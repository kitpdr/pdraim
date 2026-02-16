import prettier from 'eslint-config-prettier';
import js from '@eslint/js';
import { includeIgnoreFile } from '@eslint/compat';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import { fileURLToPath } from 'node:url';
import ts from 'typescript-eslint';
const gitignorePath = fileURLToPath(new URL('./.gitignore', import.meta.url));

export default ts.config(
	includeIgnoreFile(gitignorePath),
	{
		ignores: ['src/convex/_generated/**']
	},
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs['flat/recommended'],
	prettier,
	...svelte.configs['flat/prettier'],
	{
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node
			}
		}
	},
	{
		files: ['**/*.svelte'],

		languageOptions: {
			parserOptions: {
				parser: ts.parser
			}
		},
		rules: {
			// False positive with Svelte 5 $bindable() — ESLint 10 flags the
			// destructuring assignment as useless but Svelte's compiler uses it.
			'no-useless-assignment': 'off'
		}
	},
	{
		// Svelte 5 .svelte.ts files use runes - need svelte-eslint-parser
		files: ['**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parser: svelte.parser,
			parserOptions: {
				parser: ts.parser
			}
		}
	}
);
