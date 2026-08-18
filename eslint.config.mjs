import { codemaskConfig, codemaskImportConfig } from 'eslint-config-codemask'

export default [
    { ignores: ['lib/**', 'node_modules/**', 'eslint.config.mjs'] },
    ...codemaskConfig,
    ...codemaskImportConfig,
    {
        files: ['src/**/*.{ts,tsx}', 'scripts/**/*.ts'],
        languageOptions: {
            parserOptions: {
                project: './tsconfig.json',
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            camelcase: 'off',
            'import/order': [
                'error',
                {
                    groups: ['builtin', 'external', 'internal', ['sibling', 'parent'], 'index'],
                    pathGroups: [
                        { pattern: '*', group: 'external', position: 'before' },
                        { pattern: '@*/**', group: 'external', position: 'after' },
                    ],
                    pathGroupsExcludedImportTypes: ['builtin'],
                    warnOnUnassignedImports: true,
                },
            ],
            'no-param-reassign': 'error',
            'no-var': 'error',
            'prefer-const': 'error',
        },
    },
    {
        files: ['src/**/*.test.{ts,tsx}'],
        rules: {
            '@typescript-eslint/require-await': 'off',
            'functional/immutable-data': 'off',
        },
    },
    {
        files: ['fixtures/native-crash-harness/**/*.{ts,tsx}'],
        languageOptions: {
            parserOptions: {
                project: './fixtures/native-crash-harness/tsconfig.json',
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            camelcase: 'off',
            'no-param-reassign': 'error',
            'no-var': 'error',
            'prefer-const': 'error',
        },
    },
    {
        files: ['fixtures/native-crash-harness/**/*.test.{ts,tsx}'],
        rules: {
            '@typescript-eslint/require-await': 'off',
            'functional/immutable-data': 'off',
        },
    },
]
