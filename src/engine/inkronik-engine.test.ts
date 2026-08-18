import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { InkronikEngine } from './inkronik-engine.js'
import { sanitizeEngineEvent } from './sanitize-event.js'
import type { EngineInitializeInput, ErrorUtilsLike, HermesInternalLike } from './types.js'
import type { NativePendingEvent } from '../native/types.js'
import type { MobileEnvelope } from '../protocol/types.js'

interface RecordedRequest {
    readonly input: RequestInfo | URL
    readonly init?: RequestInit
}

const originalFetch = globalThis.fetch
const originalErrorUtils = Reflect.get(globalThis, 'ErrorUtils')
const originalHermesInternal = Reflect.get(globalThis, 'HermesInternal')
const requests: Array<RecordedRequest> = []
const responseStatuses: Array<number> = []

const getRequestUrl = (request: RecordedRequest): string => {
    if (typeof request.input === 'string') {
        return request.input
    }

    return request.input instanceof URL ? request.input.toString() : request.input.url
}

const getRequestBody = (request: RecordedRequest): string => {
    if (typeof request.init?.body !== 'string') {
        throw new Error('Expected a JSON request body.')
    }

    return request.init.body
}

beforeEach(() => {
    requests.length = 0
    responseStatuses.length = 0
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ input, init })
        return Promise.resolve(new Response('', { status: responseStatuses.shift() ?? 202 }))
    }) as typeof fetch
})

afterEach(() => {
    globalThis.fetch = originalFetch
    if (originalErrorUtils === undefined) Reflect.deleteProperty(globalThis, 'ErrorUtils')
    else Reflect.set(globalThis, 'ErrorUtils', originalErrorUtils)
    if (originalHermesInternal === undefined) Reflect.deleteProperty(globalThis, 'HermesInternal')
    else Reflect.set(globalThis, 'HermesInternal', originalHermesInternal)
})

const createInitializedEngine = (overrides: Partial<EngineInitializeInput>): InkronikEngine => {
    const engine = new InkronikEngine()
    engine.initialize({
        beforeSend: sanitizeEngineEvent,
        collectorUrl: 'https://collector.example/mobile',
        debug: false,
        cacheItemTtlMs: 86_400_000,
        dedupeWindowMs: 10_000,
        maxBreadcrumbs: 50,
        maxCacheItems: 30,
        maxEnvelopeBytes: 500_000,
        maxEventBytes: 200_000,
        projectId: 'mobile-app',
        publicIngestKey: 'public_mobile_key_1234567890',
        release: 'com.example.mobile@1.2.3+42',
        retryBaseDelayMs: 1_000,
        retryMaxDelayMs: 60_000,
        ...overrides,
    })
    return engine
}

const getEnvelope = (request: RecordedRequest): MobileEnvelope => JSON.parse(getRequestBody(request)) as MobileEnvelope

describe('Inkronik-owned capture engine', () => {
    test('sends a structured, sanitized exception envelope only to Inkronik', async () => {
        const engine = createInitializedEngine({})
        engine.setUser({ id: 'user-123' })
        engine.setContext({ name: 'payment', value: { authorization: 'secret', operation: 'purchase' } })
        engine.addBreadcrumb({ category: 'payment', data: { cardNumber: '4111111111111111', result: 'declined' }, message: 'purchase failed' })

        const error = new Error('access_token=secret payment failed')
        error.stack = 'PaymentError: access_token=secret payment failed\n    at purchase (https://app.example/index.bundle?token=secret:10:20)'
        const eventId = engine.captureException({ context: { tags: { operation: 'purchase' } }, error })

        expect(eventId).toMatch(/^[0-9a-f]{32}$/u)
        expect(await engine.flush(2_000)).toBeTrue()
        expect(requests).toHaveLength(1)
        expect(getRequestUrl(requests[0] as RecordedRequest)).toBe('https://collector.example/mobile/v1/mobile/envelopes')

        const headers = new Headers(requests[0]?.init?.headers)
        expect(headers.get('x-inkronik-public-key')).toBe('public_mobile_key_1234567890')
        expect(headers.get('authorization')).toBeNull()
        expect(headers.get('baggage')).toBeNull()

        const body = getRequestBody(requests[0] as RecordedRequest)
        expect(body).toContain(eventId)
        expect(body).toContain('user-123')
        expect(body).toContain('https://app.example/index.bundle')
        expect(body).not.toContain('4111111111111111')
        expect(body).not.toContain('access_token=secret')
        expect(body).not.toContain('authorization":"secret')
        expect(body).not.toContain('?token=secret')
    })

    test('snapshots user identity when the event is captured', async () => {
        const engine = createInitializedEngine({})
        engine.setUser({ id: 'user-before' })
        engine.captureMessage({ context: {}, message: 'before logout' })
        engine.setUser(null)

        expect(await engine.flush(2_000)).toBeTrue()
        expect(getRequestBody(requests[0] as RecordedRequest)).toContain('user-before')
    })

    test('delivers persisted native events and acknowledges them only after collector acceptance', async () => {
        const acknowledgements: Array<ReadonlyArray<string>> = []
        const engine = createInitializedEngine({
            acknowledgeNativeEvents: eventIds => {
                acknowledgements.push(eventIds)
                return Promise.resolve(true)
            },
        })
        const nativeEvent: NativePendingEvent = {
            handled: false,
            id: 'a'.repeat(32),
            level: 'fatal',
            mechanism: 'android.application-exit',
            message: 'Native process crash',
            platform: 'android',
            frames: [
                {
                    filename: 'libcheckout.so',
                    function: 'Checkout::crash',
                    imageAddress: '0x1000',
                    imageUuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
                    inApp: true,
                    instructionAddress: '0x1234',
                },
            ],
            timestamp: '2026-08-17T12:00:00.000Z',
            type: 'NativeCrash',
            userId: 'user-at-crash',
        }

        expect(engine.captureNativeEvent(nativeEvent)).toBe(nativeEvent.id)
        expect(engine.captureNativeEvent(nativeEvent)).toBe(nativeEvent.id)
        expect(await engine.flush(2_000)).toBeTrue()
        await Bun.sleep(0)

        const envelope = getEnvelope(requests[0] as RecordedRequest)
        expect(envelope.events).toHaveLength(1)
        expect(envelope.events[0]?.platform).toBe('android')
        expect(envelope.events[0]?.user).toEqual({ id: 'user-at-crash' })
        expect(envelope.events[0]?.exceptions?.[0]?.frames).toEqual([
            {
                filename: 'libcheckout.so',
                function: 'Checkout::crash',
                image_addr: '0x1000',
                image_uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
                in_app: true,
                instruction_addr: '0x1234',
            },
        ])
        expect(acknowledgements).toEqual([[nativeEvent.id]])

        responseStatuses.push(400)
        const rejectedAcknowledgements: Array<ReadonlyArray<string>> = []
        const rejectedEngine = createInitializedEngine({
            acknowledgeNativeEvents: eventIds => {
                rejectedAcknowledgements.push(eventIds)
                return Promise.resolve(true)
            },
        })
        rejectedEngine.captureNativeEvent({ ...nativeEvent, id: 'b'.repeat(32) })
        await Bun.sleep(0)
        expect(rejectedAcknowledgements).toEqual([])
    })

    test('captures a redacted cause chain once when the same Error reaches multiple handlers', async () => {
        const engine = createInitializedEngine({ dedupeWindowMs: 60_000 })
        const rootCause = new Error('api_key=secret')
        const error = new Error('operation failed', { cause: rootCause })

        const firstEventId = engine.captureException({ context: {}, error })
        const duplicateEventId = engine.captureException({ context: { tags: { 'inkronik.mechanism': 'react.error-boundary' } }, error })

        expect(duplicateEventId).toBe(firstEventId)
        expect(await engine.flush(2_000)).toBeTrue()
        const envelope = getEnvelope(requests[0] as RecordedRequest)
        expect(envelope.events).toHaveLength(1)
        expect(envelope.events[0]?.exceptions).toHaveLength(2)
        expect(JSON.stringify(envelope)).not.toContain('api_key=secret')
    })

    test('honors breadcrumb, cache, and event byte limits', async () => {
        const engine = createInitializedEngine({ maxBreadcrumbs: 1 })
        engine.addBreadcrumb({ category: 'first' })
        engine.addBreadcrumb({ category: 'second' })
        engine.captureMessage({ context: {}, message: 'bounded' })

        expect(await engine.flush(2_000)).toBeTrue()
        expect(getEnvelope(requests[0] as RecordedRequest).events[0]?.breadcrumbs).toEqual([{ category: 'second' }])

        const disabledQueue = createInitializedEngine({ maxCacheItems: 0 })
        expect(disabledQueue.captureMessage({ context: {}, message: 'not queued' })).toBe('')

        const byteLimited = createInitializedEngine({ maxEnvelopeBytes: 2_000, maxEventBytes: 1_024 })
        expect(byteLimited.captureMessage({ context: {}, message: 'x'.repeat(10_000) })).toBe('')
        await Promise.all([disabledQueue.close(0), byteLimited.close(0)])
    })

    test('retries transient failures with backoff and expires stale queue items', async () => {
        responseStatuses.push(500, 202)
        const retryingEngine = createInitializedEngine({ retryBaseDelayMs: 5, retryMaxDelayMs: 10 })
        retryingEngine.captureMessage({ context: {}, message: 'retry me' })

        await Bun.sleep(20)
        expect(requests).toHaveLength(2)
        expect(await retryingEngine.flush(100)).toBeTrue()
        await retryingEngine.close(0)

        requests.length = 0
        responseStatuses.push(500)
        const expiringEngine = createInitializedEngine({ cacheItemTtlMs: 2, retryBaseDelayMs: 50, retryMaxDelayMs: 50 })
        expiringEngine.captureMessage({ context: {}, message: 'expire me' })

        await Bun.sleep(10)
        expect(await expiringEngine.flush(100)).toBeTrue()
        expect(requests).toHaveLength(1)
        await expiringEngine.close(0)
    })

    test('drains every size-bounded envelope and refuses captures after close', async () => {
        const engine = createInitializedEngine({ maxEnvelopeBytes: 1_000, maxEventBytes: 1_000 })
        const eventIds = [
            engine.captureMessage({ context: {}, message: `first ${'x'.repeat(250)}` }),
            engine.captureMessage({ context: {}, message: `second ${'x'.repeat(250)}` }),
            engine.captureMessage({ context: {}, message: `third ${'x'.repeat(250)}` }),
        ]

        expect(eventIds.every(eventId => eventId.length === 32)).toBeTrue()
        expect(await engine.flush(2_000)).toBeTrue()
        expect(requests.length).toBeGreaterThan(1)
        expect(requests.flatMap(request => getEnvelope(request).events)).toHaveLength(3)
        expect(requests.every(request => new TextEncoder().encode(getRequestBody(request)).byteLength <= 1_000)).toBeTrue()

        await engine.close(0)
        requests.length = 0
        expect(engine.captureMessage({ context: {}, message: 'after close' })).toBe('')
        await Bun.sleep(0)
        expect(requests).toHaveLength(0)
    })

    test('captures Hermes unhandled rejections and preserves the previous React Native handler', async () => {
        const previousErrors: Array<Error> = []
        const state: {
            handler: (error: Error, isFatal?: boolean) => void
            rejectionOptions?: NonNullable<Parameters<NonNullable<HermesInternalLike['enablePromiseRejectionTracker']>>[0]>
        } = { handler: error => previousErrors.push(error) }
        const errorUtils: ErrorUtilsLike = {
            getGlobalHandler: () => state.handler,
            setGlobalHandler: handler => {
                state.handler = handler
            },
        }
        const hermesInternal: HermesInternalLike = {
            enablePromiseRejectionTracker: options => {
                if (options !== null) state.rejectionOptions = options
            },
        }
        Reflect.set(globalThis, 'ErrorUtils', errorUtils)
        Reflect.set(globalThis, 'HermesInternal', hermesInternal)
        const engine = createInitializedEngine({})

        state.rejectionOptions?.onUnhandled(7, new Error('async failed'))

        expect(await engine.flush(2_000)).toBeTrue()
        expect(previousErrors).toHaveLength(1)
        expect(getRequestBody(requests[0] as RecordedRequest)).toContain('unhandledrejection')
        await engine.close(0)
    })
})
