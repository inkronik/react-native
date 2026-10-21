import { describe, expect, test } from 'bun:test'

import { parseStack } from './stack.js'

describe('stack parser', () => {
    test.each([
        ['V8 missing name', '    at /tmp/example.js:1:1', '<anonymous>', '/tmp/example.js'],
        ['V8 empty name', '    at  (/tmp/example.js:1:1)', '<anonymous>', '/tmp/example.js'],
        ['V8 named frame', '    at checkout (/tmp/example.js:1:1)', 'checkout', '/tmp/example.js'],
        ['Hermes empty name', '@/tmp/example.js:1:1', '<anonymous>', '/tmp/example.js'],
        ['Hermes named frame', 'checkout@/tmp/example.js:1:1', 'checkout', '/tmp/example.js'],
        ['Hermes bytecode frame', '    at checkout (address at index.android.bundle:1:1)', 'checkout', 'address at index.android.bundle'],
    ])('parses %s', (_label, line, functionName, filename) => {
        expect(parseStack(`Error: failed\n${line}`)).toEqual([{ function: functionName, filename, line: 1, column: 1, in_app: true }])
    })

    test('preserves mixed frame order and removes URL query secrets', () => {
        expect(parseStack('Error: failed\n    at /tmp/example.js:1:1\ncheckout@https://app.example/index.bundle?token=secret:2:3')).toEqual([
            { function: '<anonymous>', filename: '/tmp/example.js', line: 1, column: 1, in_app: true },
            { function: 'checkout', filename: 'https://app.example/index.bundle', line: 2, column: 3, in_app: true },
        ])
    })

    test('ignores absent stacks and unsupported lines', () => {
        expect(parseStack(undefined)).toEqual([])
        expect(parseStack('Error: failed\n    at native code\n')).toEqual([])
    })
})
