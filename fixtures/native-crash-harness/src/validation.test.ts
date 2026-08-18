import { describe, expect, test } from 'bun:test'

import { findCrashCase } from './cases'
import { validateAcknowledgement, validateDeliveredEnvelope } from './validation'

const eventId = 'a'.repeat(32)
const release = 'dev.inkronik.native-crash-harness@0.1.0+1'
const userId = 'fixture-user-android.native-sigsegv'

const validEnvelope = JSON.stringify({
    schema_version: 1,
    events: [
        {
            event_id: eventId,
            platform: 'android',
            user: { id: userId },
            contexts: {
                release: { value: release },
                android_tombstone: { name: 'SIGSEGV', number: 11 },
            },
            exceptions: [
                {
                    mechanism: 'android.native-tombstone',
                    frames: [
                        {
                            function: 'fixture_crash',
                            filename: 'libinkronik_crash_fixture.so',
                            in_app: true,
                            instruction_addr: '0x70120',
                            image_addr: '0x70000',
                            image_uuid: 'abcdef0123456789abcdef0123456789',
                            symbol_addr: '0x70100',
                        },
                    ],
                },
            ],
        },
    ],
})

describe('native destructive crash acceptance validator', () => {
    test('accepts a minimized native event and verifies acknowledgement by event ID', () => {
        expect(
            validateDeliveredEnvelope({
                body: validEnvelope,
                crashCase: findCrashCase('android.native-sigsegv'),
                expectedRelease: release,
                expectedUserId: userId,
            }),
        ).toEqual({ eventId, mechanism: 'android.native-tombstone', frameCount: 1 })

        expect(() => validateAcknowledgement({ eventId, pendingEventsJson: '[]' })).not.toThrow()
        expect(() => validateAcknowledgement({ eventId, pendingEventsJson: JSON.stringify([{ id: eventId }]) })).toThrow(
            'Accepted native event remains in the restart queue',
        )

        const signalJournalEnvelope = validEnvelope.replace('android.native-tombstone', 'android.native-signal')
        expect(
            validateDeliveredEnvelope({
                body: signalJournalEnvelope,
                crashCase: findCrashCase('android.native-sigsegv'),
                expectedRelease: release,
                expectedUserId: userId,
            }).mechanism,
        ).toBe('android.native-signal')
    })

    test('rejects privacy-heavy fields, full paths, missing frames, and the wrong user snapshot', () => {
        const withRegisters = validEnvelope.replace('"android_tombstone":{"name"', '"android_tombstone":{"registers":[],"name"')
        const withPrivatePath = validEnvelope.replace('libinkronik_crash_fixture.so', '/data/app/private.package/libinkronik_crash_fixture.so')
        const withoutFrames = validEnvelope.replace(/"frames":\[[\s\S]*\]\}\]\}\]\}$/u, '"frames":[]}]}]}')

        expect(() =>
            validateDeliveredEnvelope({
                body: withRegisters,
                crashCase: findCrashCase('android.native-sigsegv'),
                expectedRelease: release,
                expectedUserId: userId,
            }),
        ).toThrow('Forbidden native field')
        expect(() =>
            validateDeliveredEnvelope({
                body: withPrivatePath,
                crashCase: findCrashCase('android.native-sigsegv'),
                expectedRelease: release,
                expectedUserId: userId,
            }),
        ).toThrow('private native image path')
        expect(() =>
            validateDeliveredEnvelope({
                body: withoutFrames,
                crashCase: findCrashCase('android.native-sigsegv'),
                expectedRelease: release,
                expectedUserId: userId,
            }),
        ).toThrow('Decoded native frames are missing')
        expect(() =>
            validateDeliveredEnvelope({
                body: validEnvelope,
                crashCase: findCrashCase('android.native-sigsegv'),
                expectedRelease: release,
                expectedUserId: 'wrong-user',
            }),
        ).toThrow('Crash-time user snapshot does not match')
    })
})
