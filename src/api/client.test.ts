import { afterEach, describe, expect, test } from 'bun:test'

import type { Engine, EngineEvent, EngineInitializeInput } from '../engine/types.js'
import { registerNativeCaptureModule } from '../native/registry.js'
import type { NativeCaptureModule, NativePendingEvent } from '../native/types.js'
import type { BreadcrumbInput, CaptureContext, User } from '../types.js'
import { InkronikClient } from './client.js'

interface FakeEngineCalls {
    readonly breadcrumbs: Array<BreadcrumbInput>
    readonly capturedContexts: Array<CaptureContext>
    readonly initialized: Array<EngineInitializeInput>
    readonly nativeEvents: Array<NativePendingEvent>
    readonly users: Array<User | null>
}

const createFakeEngine = (): { readonly calls: FakeEngineCalls; readonly engine: Engine } => {
    const calls: FakeEngineCalls = { breadcrumbs: [], capturedContexts: [], initialized: [], nativeEvents: [], users: [] }
    const engine: Engine = {
        initialize: input => calls.initialized.push(input),
        captureException: ({ context }) => {
            calls.capturedContexts.push(context)
            return 'exception-event-id'
        },
        captureMessage: ({ context }) => {
            calls.capturedContexts.push(context)
            return 'message-event-id'
        },
        captureSpan: () => 'span-event-id',
        captureNativeEvent: event => {
            calls.nativeEvents.push(event)
            return event.id
        },
        setUser: user => calls.users.push(user),
        setTag: () => undefined,
        setContext: () => undefined,
        addBreadcrumb: breadcrumb => calls.breadcrumbs.push(breadcrumb),
        flush: () => Promise.resolve(true),
        close: () => Promise.resolve(true),
    }

    return { calls, engine }
}

const createClient = ({ engine, onError }: { readonly engine: Engine; readonly onError?: (error: Error) => void }): InkronikClient =>
    new InkronikClient({
        engine,
        options: {
            collectorUrl: 'https://collector.example/mobile',
            projectId: 'project',
            publicIngestKey: 'public_mobile_key_1234567890',
            ...(onError === undefined ? {} : { onError }),
        },
    })

afterEach(() => registerNativeCaptureModule(null))

describe('Inkronik client', () => {
    test('forces secure engine initialization and installs the sanitizer', () => {
        const { calls, engine } = createFakeEngine()
        createClient({ engine })

        expect(calls.initialized).toHaveLength(1)
        const initialized = calls.initialized[0]
        const unsafeEvent: EngineEvent = { request: { body: 'secret' }, user: { email: 'person@example.com', id: 'user-1' } }
        expect(initialized.beforeSend(unsafeEvent)).toEqual({ user: { id: 'user-1' } })
        expect(initialized.collectorUrl).toBe('https://collector.example/mobile')
        expect(initialized.projectId).toBe('project')
        expect(initialized.publicIngestKey).toBe('public_mobile_key_1234567890')
    })

    test('accepts only an opaque user id and clears it on logout', () => {
        const errors: Array<Error> = []
        const { calls, engine } = createFakeEngine()
        const client = createClient({ engine, onError: error => errors.push(error) })

        client.setUser({ id: ' user-123 ' })
        client.setUser({ id: '' })
        client.clearUser()

        expect(calls.users).toEqual([{ id: 'user-123' }, null])
        expect(errors).toHaveLength(1)
        expect(errors[0]?.name).toBe('InkronikSdkError')
    })

    test('configures native capture without transport secrets and drains restart events', async () => {
        const configured: Array<string> = []
        const acknowledged: Array<string> = []
        const users: Array<string | null> = []
        const nativeEvent = {
            handled: false,
            id: 'c'.repeat(32),
            level: 'fatal',
            mechanism: 'ios.metrickit-crash',
            message: 'Process crash',
            platform: 'ios',
            timestamp: '2026-08-17T12:00:00.000Z',
            type: 'IOSCrash',
        } as const
        const nativeModule: NativeCaptureModule = {
            acknowledgeEvents: eventIdsJson => {
                acknowledged.push(eventIdsJson)
                return Promise.resolve(true)
            },
            configure: configurationJson => configured.push(configurationJson),
            drainPendingEvents: () => Promise.resolve(JSON.stringify([nativeEvent])),
            setUserId: userId => users.push(userId),
        }
        registerNativeCaptureModule(nativeModule)
        const { calls, engine } = createFakeEngine()
        const client = createClient({ engine })

        await Bun.sleep(0)
        expect(configured).toHaveLength(1)
        expect(configured[0]).not.toContain('collector')
        expect(configured[0]).not.toContain('public_mobile_key')
        expect(calls.nativeEvents).toEqual([nativeEvent])

        expect(await calls.initialized[0]?.acknowledgeNativeEvents?.([nativeEvent.id])).toBeTrue()
        expect(acknowledged).toEqual([JSON.stringify([nativeEvent.id])])

        client.setUser({ id: ' user-native ' })
        client.clearUser()
        expect(users).toEqual(['user-native', null])
    })

    test('sanitizes explicit capture context before handing it to the engine', () => {
        const { calls, engine } = createFakeEngine()
        const client = createClient({ engine })

        expect(
            client.captureException({
                error: new Error('failed'),
                context: {
                    contexts: { payment: { authorization: 'secret', result: 'declined' } },
                    tags: { access_token: 'secret', operation: 'capture' },
                },
            }),
        ).toBe('exception-event-id')
        expect(calls.capturedContexts).toEqual([
            {
                contexts: { payment: { authorization: '[REDACTED]', result: 'declined' } },
                tags: { access_token: '[REDACTED]', operation: 'capture' },
            },
        ])
    })
})
