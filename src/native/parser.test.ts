import { describe, expect, test } from 'bun:test'

import { parseNativePendingEvents } from './parser.js'

describe('native pending event parser', () => {
    test('accepts bounded platform events and sanitizes native-controlled text', () => {
        const events = parseNativePendingEvents(
            JSON.stringify([
                {
                    handled: false,
                    id: 'a'.repeat(32),
                    level: 'fatal',
                    mechanism: 'android.application-exit',
                    message: 'token=secret native crash',
                    platform: 'android',
                    frames: [
                        {
                            filename: 'libcheckout.so',
                            function: 'token=secret',
                            imageAddress: '0x1000',
                            imageUuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
                            inApp: true,
                            instructionAddress: '0x1234',
                            symbolAddress: 'invalid',
                        },
                    ],
                    stack: 'Authorization: bearer secret',
                    timestamp: '2026-08-17T12:00:00.000Z',
                    type: 'NativeCrash',
                },
                { id: 'invalid' },
            ]),
        )

        expect(events).toHaveLength(1)
        expect(JSON.stringify(events)).not.toContain('secret')
        expect(events[0]?.platform).toBe('android')
        expect(events[0]?.frames).toEqual([
            {
                filename: 'libcheckout.so',
                function: 'token=[REDACTED]',
                imageAddress: '0x1000',
                imageUuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
                inApp: true,
                instructionAddress: '0x1234',
            },
        ])
    })

    test('rejects malformed JSON roots without trusting object shapes', () => {
        expect(parseNativePendingEvents('{}')).toEqual([])
        expect(() => parseNativePendingEvents('{')).toThrow()
    })
})
