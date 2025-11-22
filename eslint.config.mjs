import typescriptEslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import boundaries from 'eslint-plugin-boundaries';

export default [
	{
		files: ['**/*.ts'],
	},
	{
		plugins: {
			'@typescript-eslint': typescriptEslint,
			boundaries,
		},

		languageOptions: {
			parser: tsParser,
			ecmaVersion: 2022,
			sourceType: 'module',
		},

		settings: {
			'boundaries/ignore': ['**/*.test.ts', 'src/test/**', 'dist/**', 'out/**'],
			'boundaries/ignoreBuiltIn': true,
			'boundaries/elements': [
				{ type: 'domain', pattern: 'src/domain/**' },
				{ type: 'services', pattern: 'src/services/**' },
				{ type: 'adapters', pattern: 'src/adapters/**' },
				{ type: 'webview', pattern: 'src/webview/**' },
				{ type: 'composition', pattern: 'src/extension.ts' },
				{ type: 'types', pattern: 'src/types/**' },
				{ type: 'tests', pattern: 'src/test/**' },
				{ type: 'root', pattern: 'src/**' },
			],
		},

		rules: {
			'@typescript-eslint/naming-convention': [
				'warn',
				{
					selector: 'import',
					format: ['camelCase', 'PascalCase'],
				},
			],

			curly: 'warn',
			eqeqeq: 'warn',
			'no-throw-literal': 'warn',
			semi: 'warn',

			'boundaries/element-types': [
				'error',
				{
					default: 'disallow',
					message: 'Import violates architecture boundaries',
					rules: [
						{ from: 'adapters', allow: ['domain', 'services', 'types', 'webview'] },
						{ from: 'services', allow: ['domain', 'types'] },
						{ from: 'domain', allow: ['domain', 'types'] },
						{ from: 'webview', allow: ['types'] },
						{ from: 'types', allow: ['types'] },
						{ from: 'composition', allow: ['adapters', 'services', 'domain', 'types', 'webview'] },
						{ from: 'tests', allow: ['root'] },
					],
				},
			],
			'boundaries/no-unknown-files': 'error',
		},
	},
];
