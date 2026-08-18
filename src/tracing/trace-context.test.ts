import { describe, expect, test } from 'bun:test'

import { createTraceContext, parseTraceparent, toTraceparent } from './trace-context.js'

const deterministicRandom = (length: number): Uint8Array => Uint8Array.from({ length }, (_value, index) => index + 1)

describe('W3C trace context', () => {
    test('creates a valid root context from secure bytes', () => {
        const context = createTraceContext({ randomBytes: deterministicRandom })

        expect(context).toEqual({
            sampled: true,
            spanId: '0102030405060708',
            traceId: '0102030405060708090a0b0c0d0e0f10',
        })
        expect(context === undefined ? '' : toTraceparent(context)).toBe('00-0102030405060708090a0b0c0d0e0f10-0102030405060708-01')
    })

    test('continues a trace with a new child span and preserves sampling', () => {
        const context = createTraceContext({
            parentTraceparent: '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-00',
            randomBytes: deterministicRandom,
        })

        expect(context).toEqual({
            parentSpanId: 'bbbbbbbbbbbbbbbb',
            sampled: false,
            spanId: '0102030405060708',
            traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        })
    })

    test('rejects malformed and all-zero identifiers', () => {
        expect(parseTraceparent('00-00000000000000000000000000000000-bbbbbbbbbbbbbbbb-01')).toBeUndefined()
        expect(parseTraceparent('invalid')).toBeUndefined()
        expect(createTraceContext({ randomBytes: () => new Uint8Array(16) })).toBeUndefined()
    })
})
