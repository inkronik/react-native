import { afterEach, describe, expect, test } from 'bun:test'
import { InkronikClient as NodeInkronikClient, parseTraceparent as parseNodeTraceparent } from '@inkronik/node-sdk'

import { InkronikEngine } from '../engine/inkronik-engine.js'
import { sanitizeEngineEvent } from '../engine/sanitize-event.js'
import type { MobileEnvelope } from '../protocol/types.js'
import { instrumentFetch } from '../tracing/fetch.js'
import type { NodeBatch, NodeSpanPayload } from './types.js'

const originalFetch = globalThis.fetch

afterEach(() => {
    globalThis.fetch = originalFetch
})

describe('mobile to Node SDK correlation', () => {
    test('joins mobile and server spans by W3C trace context while resolving the same opaque user independently', async () => {
        const mobileBodies: Array<string> = []
        globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
            if (typeof init?.body === 'string') mobileBodies.push(init.body)
            return Promise.resolve(new Response('', { status: 202 }))
        }) as typeof fetch
        const mobileEngine = new InkronikEngine()
        mobileEngine.initialize({
            beforeSend: sanitizeEngineEvent,
            cacheItemTtlMs: 86_400_000,
            collectorUrl: 'https://collector.example',
            debug: false,
            dedupeWindowMs: 10_000,
            maxBreadcrumbs: 50,
            maxCacheItems: 30,
            maxEnvelopeBytes: 500_000,
            maxEventBytes: 200_000,
            projectId: 'mobile-app',
            publicIngestKey: 'public_mobile_key_1234567890',
            retryBaseDelayMs: 1_000,
            retryMaxDelayMs: 60_000,
        })
        mobileEngine.setUser({ id: 'user-123' })

        const apiHeaders: Array<Headers> = []
        const tracedFetch = instrumentFetch({
            addBreadcrumb: breadcrumb => mobileEngine.addBreadcrumb(breadcrumb),
            captureSpan: span => {
                mobileEngine.captureSpan(span)
            },
            collectorUrl: new URL('https://collector.example'),
            fetchImpl: ((_input: RequestInfo | URL, init?: RequestInit) => {
                apiHeaders.push(new Headers(init?.headers))
                return Promise.resolve(new Response('', { status: 204 }))
            }) as typeof fetch,
            traceOrigins: new Set(['https://api.example']),
        })

        await tracedFetch('https://api.example/orders/123456')
        expect(await mobileEngine.flush(2_000)).toBeTrue()

        const traceparent = apiHeaders[0]?.get('traceparent') ?? undefined
        const incomingContext = parseNodeTraceparent(traceparent)
        expect(incomingContext).toBeDefined()

        const nodeBatches: Array<NodeBatch> = []
        const nodeClient = new NodeInkronikClient({
            collectorUrl: 'https://collector.example',
            fetchImpl: ((_input: RequestInfo | URL, init?: RequestInit) => {
                if (typeof init?.body === 'string') nodeBatches.push(JSON.parse(init.body) as NodeBatch)
                return Promise.resolve(
                    new Response(JSON.stringify({ accepted: 1, application_id: 'api-app', organisation_id: 'organisation' }), {
                        headers: { 'content-type': 'application/json' },
                        status: 202,
                    }),
                )
            }) as typeof fetch,
            flushIntervalMs: 60_000,
            ingestApiKey: 'ik_test_secret',
            serviceName: 'api',
        })
        nodeClient.captureHttpExchange({
            captureRequestResponse: false,
            durationMs: 12,
            method: 'GET',
            metrics: { enabled: false },
            parentSpanId: incomingContext?.parentSpanId,
            requestHeaders: {},
            requestQuery: {},
            responseHeaders: {},
            route: '/orders/:id',
            statusCode: 200,
            traceId: incomingContext?.traceId,
            url: 'https://api.example/orders/123456',
            userId: 'user-123',
        })
        await nodeClient.flush()
        await nodeClient.shutdown()

        const mobileEnvelope = JSON.parse(mobileBodies[0] ?? '{}') as MobileEnvelope
        const mobileSpan = mobileEnvelope.events.find(event => event.kind === 'span')
        const serverSpan = nodeBatches.flatMap(batch => batch.signals).find(signal => signal.signal_type === 'span')
        const serverPayload = serverSpan?.payload as NodeSpanPayload | undefined

        expect(mobileSpan?.span?.trace.traceId).toBe(serverPayload?.trace_id)
        expect(mobileSpan?.span?.trace.spanId).toBe(serverPayload?.parent_span_id)
        expect(serverPayload?.span_id).not.toBe(serverPayload?.parent_span_id)
        expect(mobileSpan?.user?.id).toBe('user-123')
        expect(serverPayload?.span_attributes?.['user.id']).toBe('user-123')
        await mobileEngine.close(0)
    })
})
