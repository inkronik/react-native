import { describe, expect, test } from 'bun:test'

import { redactText, sanitizeRecord, sanitizeUrl, sanitizeValue, toSafeError, toSafeErrorChain } from './sanitize.js'

describe('privacy sanitization', () => {
    test('redacts nested credentials and token-shaped text before queuing', () => {
        const result = sanitizeRecord({
            value: {
                merchantPrivateCode: 'merchant-secret',
                nested: {
                    authorization: 'Bearer abc.def.ghi',
                    message: 'access_token=opaque-value safe=visible',
                    safe: 'visible',
                },
            },
        })

        expect(result).toEqual({
            merchantPrivateCode: '[REDACTED]',
            nested: {
                authorization: '[REDACTED]',
                message: 'access_token=[REDACTED] safe=visible',
                safe: 'visible',
            },
        })
    })

    test('removes credentials, query, fragment, and identifier-like path values from URLs', () => {
        expect(sanitizeUrl({ value: 'https://user:pass@api.example/orders/123456?token=secret#fragment' })).toBe('https://api.example/orders/:id')
        expect(sanitizeUrl({ value: 'not-a-url?password=secret' })).toBe('not-a-url')
    })

    test('bounds hostile, circular, and throwing values without throwing', () => {
        const circular: Record<string, unknown> = { value: 'safe' }
        Reflect.set(circular, 'circular', circular)

        const throwing = Object.defineProperty({}, 'secret', {
            enumerable: true,
            get: () => {
                throw new Error('getter must not escape')
            },
        })

        expect(() => sanitizeValue({ value: circular })).not.toThrow()
        expect(sanitizeValue({ value: throwing })).toEqual({})
        expect(redactText(`Bearer ${'a'.repeat(2_000)}`).length).toBeLessThanOrEqual(1_024)
    })

    test('normalizes thrown non-Error values', () => {
        expect(toSafeError({ error: { password: 'secret', reason: 'declined' } })).toEqual({
            name: 'NonErrorThrown',
            message: '[object Object]',
        })
    })

    test('captures a bounded redacted cause chain without trusting Error getters', () => {
        const rootCause = new Error('api_key=secret')
        const outerError = new Error('operation failed', { cause: rootCause })
        const hostileError = Object.defineProperty(new Error('hostile'), 'cause', {
            get: () => {
                throw new Error('cause getter must not escape')
            },
        })

        expect(toSafeErrorChain({ error: outerError })).toEqual([
            expect.objectContaining({ message: 'operation failed', name: 'Error' }),
            expect.objectContaining({ message: 'api_key=[REDACTED]', name: 'Error' }),
        ])
        expect(() => toSafeErrorChain({ error: hostileError })).not.toThrow()
        expect(toSafeErrorChain({ error: hostileError })).toHaveLength(1)
    })
})
