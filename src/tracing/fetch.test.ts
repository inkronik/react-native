import { describe, expect, test } from 'bun:test'

import type { BreadcrumbInput, CaptureSpanInput } from '../types.js'
import { instrumentFetch } from './fetch.js'

describe('fetch trace propagation', () => {
    test('adds only traceparent to exact allowlisted origins and records sanitized breadcrumbs', async () => {
        const breadcrumbs: Array<BreadcrumbInput> = []
        const spans: Array<CaptureSpanInput> = []
        const requests: Array<{ readonly input: RequestInfo | URL; readonly init?: RequestInit }> = []
        const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => {
            requests.push({ input, init })
            return Promise.resolve(new Response('', { status: 204 }))
        }) as typeof fetch
        const tracedFetch = instrumentFetch({
            addBreadcrumb: breadcrumb => breadcrumbs.push(breadcrumb),
            captureSpan: span => spans.push(span),
            collectorUrl: new URL('https://collector.example/mobile'),
            fetchImpl,
            traceOrigins: new Set(['https://api.example']),
        })

        await tracedFetch('https://api.example/orders/123456?access_token=secret', { headers: { 'x-safe': 'yes' }, method: 'POST' })
        await tracedFetch('https://not-api.example/orders')

        const tracedHeaders = new Headers(requests[0]?.init?.headers)
        expect(tracedHeaders.get('traceparent')).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/u)
        expect(tracedHeaders.get('baggage')).toBeNull()
        expect(tracedHeaders.get('x-safe')).toBe('yes')
        expect(new Headers(requests[1]?.init?.headers).get('traceparent')).toBeNull()
        expect(breadcrumbs).toHaveLength(2)
        expect(JSON.stringify(breadcrumbs)).toContain('https://api.example/orders/:id')
        expect(JSON.stringify(breadcrumbs)).not.toContain('access_token')
        expect(JSON.stringify(breadcrumbs)).not.toContain('secret')
        expect(spans).toHaveLength(1)
        expect(spans[0]).toMatchObject({ name: 'HTTP POST', status: 'ok' })
        expect(spans[0]?.trace.spanId).toBe(tracedHeaders.get('traceparent')?.split('-')[2] ?? '')
    })

    test('never instruments the collector path even when it shares an API origin', async () => {
        const requests: Array<{ readonly init?: RequestInit }> = []
        const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) => {
            requests.push({ init })
            return Promise.resolve(new Response('', { status: 200 }))
        }) as typeof fetch
        const tracedFetch = instrumentFetch({
            addBreadcrumb: () => undefined,
            captureSpan: () => undefined,
            collectorUrl: new URL('https://api.example/inkronik'),
            fetchImpl,
            traceOrigins: new Set(['https://api.example']),
        })

        await tracedFetch('https://api.example/inkronik/api/project/envelope/')

        expect(new Headers(requests[0]?.init?.headers).get('traceparent')).toBeNull()
    })
})
