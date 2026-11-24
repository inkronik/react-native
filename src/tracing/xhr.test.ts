import { afterEach, describe, expect, test } from 'bun:test'

import type { BreadcrumbInput, CaptureSpanInput } from '../types.js'
import { installGlobalXhrInstrumentation } from './xhr.js'
import { instrumentFetch } from './fetch.js'

type Listener = () => void

class FakeXhr {
    public readonly headers = new Map<string, string>()
    public readonly listeners = new Map<string, ReadonlyArray<Listener>>()
    public method = ''
    public status = 204
    public isPending = false
    public url = ''

    public open(method: string, url: string): void {
        this.headers.clear()
        this.method = method
        this.url = url
    }

    public setRequestHeader(name: string, value: string): void {
        const key = name.toLowerCase()
        const previous = this.headers.get(key)
        this.headers.set(key, previous === undefined ? value : `${previous}, ${value}`)
    }

    public send(): void {
        if (!this.isPending) this.emit('loadend')
    }

    public addEventListener(name: string, listener: Listener): void {
        this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener])
    }

    public removeEventListener(name: string, listener: Listener): void {
        this.listeners.set(
            name,
            (this.listeners.get(name) ?? []).filter(candidate => candidate !== listener),
        )
    }

    private emit(name: string): void {
        ;(this.listeners.get(name) ?? []).forEach(listener => listener())
    }
}

const originalXhr = Reflect.get(globalThis, 'XMLHttpRequest')
const hadOriginalXhr = Reflect.has(globalThis, 'XMLHttpRequest')

afterEach(() => {
    if (!hadOriginalXhr) {
        Reflect.deleteProperty(globalThis, 'XMLHttpRequest')
    } else {
        Reflect.set(globalThis, 'XMLHttpRequest', originalXhr)
    }
})

describe('XHR trace propagation', () => {
    test('reopening a pending request finishes its cancelled span without stealing the next response', () => {
        Reflect.set(globalThis, 'XMLHttpRequest', FakeXhr)
        const spans: Array<CaptureSpanInput> = []
        const restore = installGlobalXhrInstrumentation({
            addBreadcrumb: () => undefined,
            captureSpan: span => spans.push(span),
            collectorUrl: new URL('https://collector.example'),
            traceOrigins: new Set(['https://api.example']),
        })
        const request = new FakeXhr()
        request.isPending = true
        request.open('GET', 'https://api.example/first')
        request.send()
        request.open('GET', 'https://api.example/second')
        request.isPending = false
        request.send()
        expect(spans.map(span => span.status)).toEqual(['error', 'ok'])
        expect(spans[1]?.trace.spanId).toBe(request.headers.get('traceparent')?.split('-')[2] ?? '')
        restore()
    })

    test('captures every request when Axios reuses an XHR instance', () => {
        Reflect.set(globalThis, 'XMLHttpRequest', FakeXhr)
        const spans: Array<CaptureSpanInput> = []
        const restore = installGlobalXhrInstrumentation({
            addBreadcrumb: () => undefined,
            captureSpan: span => spans.push(span),
            collectorUrl: new URL('https://collector.example'),
            traceOrigins: new Set(['https://api.example']),
        })
        const request = new FakeXhr()
        request.open('GET', 'https://api.example/first')
        request.send()
        const firstHeader = request.headers.get('traceparent')
        request.open('GET', 'https://api.example/second')
        request.send()
        expect(spans).toHaveLength(2)
        expect(request.headers.get('traceparent') ?? '').not.toBe(firstHeader ?? '')
        expect(spans[1]?.trace.spanId).toBe(request.headers.get('traceparent')?.split('-')[2] ?? '')
        restore()
    })

    test('preserves an existing traceparent without appending a second header or span', () => {
        Reflect.set(globalThis, 'XMLHttpRequest', FakeXhr)
        const spans: Array<CaptureSpanInput> = []
        const restore = installGlobalXhrInstrumentation({
            addBreadcrumb: () => undefined,
            captureSpan: span => spans.push(span),
            collectorUrl: new URL('https://collector.example'),
            traceOrigins: new Set(['https://api.example']),
        })
        const request = new FakeXhr()
        request.open('GET', 'https://api.example/orders')
        const parent = `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`
        request.setRequestHeader('TraceParent', parent)
        request.send()
        expect(request.headers.get('traceparent')).toBe(parent)
        expect(spans).toHaveLength(0)
        restore()
    })

    test('fetch over XHR produces one matching client span and one valid wire header', async () => {
        Reflect.set(globalThis, 'XMLHttpRequest', FakeXhr)
        const spans: Array<CaptureSpanInput> = []
        const input = {
            addBreadcrumb: () => undefined,
            captureSpan: (span: CaptureSpanInput) => spans.push(span),
            collectorUrl: new URL('https://collector.example'),
            traceOrigins: new Set(['https://api.example']),
        }
        const restore = installGlobalXhrInstrumentation(input)
        const request = new FakeXhr()
        const fetchImpl = ((value, init) => {
            const wire = new Request(value, init)
            request.open(wire.method, wire.url)
            wire.headers.forEach((header, name) => request.setRequestHeader(name, header))
            request.send()
            return Promise.resolve(new Response('{}', { status: 200 }))
        }) as typeof fetch
        await instrumentFetch({ ...input, fetchImpl })('https://api.example/orders')
        expect(spans).toHaveLength(1)
        expect(request.headers.get('traceparent') ?? '').toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/u)
        expect(spans[0]?.trace.spanId).toBe(request.headers.get('traceparent')?.split('-')[2] ?? '')
        restore()
    })

    test('adds traceparent and captures a sanitized client span only for an exact API origin', () => {
        Reflect.set(globalThis, 'XMLHttpRequest', FakeXhr)
        const breadcrumbs: Array<BreadcrumbInput> = []
        const spans: Array<CaptureSpanInput> = []
        const restore = installGlobalXhrInstrumentation({
            addBreadcrumb: breadcrumb => breadcrumbs.push(breadcrumb),
            captureSpan: span => spans.push(span),
            collectorUrl: new URL('https://collector.example'),
            traceOrigins: new Set(['https://api.example']),
        })

        const request = new FakeXhr()
        request.open('POST', 'https://api.example/orders/123456?access_token=secret')
        request.setRequestHeader('x-safe', 'yes')
        request.send()

        const unrelated = new FakeXhr()
        unrelated.open('GET', 'https://not-api.example/orders')
        unrelated.send()

        expect(request.headers.get('traceparent') ?? '').toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/u)
        expect(request.headers.get('baggage')).toBeUndefined()
        expect(request.headers.get('x-safe')).toBe('yes')
        expect(unrelated.headers.get('traceparent')).toBeUndefined()
        expect(spans).toHaveLength(1)
        expect(spans[0]).toMatchObject({ name: 'HTTP POST', status: 'ok' })
        expect(JSON.stringify([breadcrumbs, spans])).toContain('https://api.example/orders/:id')
        expect(JSON.stringify([breadcrumbs, spans])).not.toContain('access_token')
        expect(JSON.stringify([breadcrumbs, spans])).not.toContain('secret')

        restore()
    })

    test('never instruments the collector path', () => {
        Reflect.set(globalThis, 'XMLHttpRequest', FakeXhr)
        const spans: Array<CaptureSpanInput> = []
        const restore = installGlobalXhrInstrumentation({
            addBreadcrumb: () => undefined,
            captureSpan: span => spans.push(span),
            collectorUrl: new URL('https://api.example/inkronik'),
            traceOrigins: new Set(['https://api.example']),
        })

        const request = new FakeXhr()
        request.open('POST', 'https://api.example/inkronik/v1/mobile/envelopes')
        request.send()

        expect(request.headers.get('traceparent')).toBeUndefined()
        expect(spans).toHaveLength(0)
        restore()
    })
})
