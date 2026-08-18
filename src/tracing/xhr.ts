/* eslint-disable functional/functional-parameters, functional/immutable-data, @typescript-eslint/unbound-method -- XMLHttpRequest instrumentation must preserve, patch, and restore the host API. */
import { reportInternalError } from '../api/safety.js'
import { sanitizeUrl } from '../privacy/sanitize.js'
import { createTraceContext, secureRandomBytes, toTraceparent } from './trace-context.js'
import type { InstrumentXhrInput, XhrRequestState } from './types.js'

const resolveUrl = (value: unknown): URL | undefined => {
    if (typeof value !== 'string') {
        return undefined
    }

    try {
        return new URL(value)
    } catch {
        return undefined
    }
}

const isCollectorRequest = ({ collectorUrl, requestUrl }: { readonly collectorUrl: URL; readonly requestUrl: URL }): boolean => {
    if (collectorUrl.origin !== requestUrl.origin) {
        return false
    }

    const collectorPath = collectorUrl.pathname.replace(/\/+$/u, '')
    return requestUrl.pathname === collectorPath || requestUrl.pathname.startsWith(`${collectorPath}/`)
}

export const installGlobalXhrInstrumentation = ({
    addBreadcrumb,
    captureSpan,
    collectorUrl,
    onError,
    traceOrigins,
}: InstrumentXhrInput): (() => void) => {
    const xhrConstructor = Reflect.get(globalThis, 'XMLHttpRequest') as { readonly prototype: XMLHttpRequest } | undefined

    if (xhrConstructor === undefined) {
        return () => undefined
    }

    const prototype = xhrConstructor.prototype
    const originalOpen = prototype.open
    const originalSend = prototype.send
    const originalSetRequestHeader = prototype.setRequestHeader
    const states = new WeakMap<XMLHttpRequest, XhrRequestState>()
    const completed = new WeakSet<XMLHttpRequest>()

    const instrumentedOpen = function (this: XMLHttpRequest, ...argumentsList: ReadonlyArray<unknown>): unknown {
        const requestUrl = resolveUrl(argumentsList[1])
        const rawMethod = argumentsList[0]
        const method = (typeof rawMethod === 'string' ? rawMethod : 'GET').toUpperCase()

        if (requestUrl === undefined || !traceOrigins.has(requestUrl.origin) || isCollectorRequest({ collectorUrl, requestUrl })) {
            states.delete(this)
        } else {
            states.set(this, { method, requestUrl })
        }

        return Reflect.apply(originalOpen, this, argumentsList)
    }

    const instrumentedSetRequestHeader = function (this: XMLHttpRequest, ...argumentsList: ReadonlyArray<unknown>): unknown {
        const rawName = argumentsList[0]
        const rawValue = argumentsList[1]
        const name = typeof rawName === 'string' ? rawName : ''
        const value = typeof rawValue === 'string' ? rawValue : ''
        const state = states.get(this)

        if (state !== undefined && name.toLowerCase() === 'traceparent') {
            states.set(this, { ...state, parentTraceparent: value })
        }

        return Reflect.apply(originalSetRequestHeader, this, argumentsList)
    }

    const instrumentedSend = function (this: XMLHttpRequest, ...argumentsList: ReadonlyArray<unknown>): unknown {
        const state = states.get(this)

        if (state === undefined) {
            return Reflect.apply(originalSend, this, argumentsList)
        }

        const traceContext = createTraceContext({ parentTraceparent: state.parentTraceparent, randomBytes: secureRandomBytes })
        if (traceContext === undefined) {
            reportInternalError({ error: new Error('Secure randomness is unavailable; XHR trace propagation was skipped.'), onError })
            return Reflect.apply(originalSend, this, argumentsList)
        }

        const safeUrl = sanitizeUrl({ value: state.requestUrl.toString() })
        const startedAt = Date.now()
        const finish = (status: 'ok' | 'error'): void => {
            if (completed.has(this)) {
                return
            }

            completed.add(this)
            const endedAt = Date.now()
            const statusCode = Number.isFinite(this.status) ? this.status : 0
            addBreadcrumb({
                category: 'http.client',
                level: status === 'ok' ? 'info' : 'error',
                message: `${state.method} ${safeUrl} ${statusCode}`,
                data: {
                    duration_ms: endedAt - startedAt,
                    method: state.method,
                    span_id: traceContext.spanId,
                    status_code: statusCode,
                    trace_id: traceContext.traceId,
                    transport: 'xhr',
                    url: safeUrl,
                },
            })
            captureSpan({
                name: `HTTP ${state.method}`,
                startedAt,
                endedAt,
                status,
                trace: traceContext,
                attributes: { method: state.method, status_code: statusCode, transport: 'xhr', url: safeUrl },
            })
        }
        const onLoadEnd = (): void => {
            this.removeEventListener('loadend', onLoadEnd)
            finish(this.status >= 200 && this.status < 300 ? 'ok' : 'error')
        }

        originalSetRequestHeader.call(this, 'traceparent', toTraceparent(traceContext))
        addBreadcrumb({
            category: 'http.client',
            level: 'info',
            message: `${state.method} ${safeUrl}`,
            data: { method: state.method, span_id: traceContext.spanId, trace_id: traceContext.traceId, transport: 'xhr', url: safeUrl },
        })
        this.addEventListener('loadend', onLoadEnd)

        try {
            return Reflect.apply(originalSend, this, argumentsList)
        } catch (error) {
            this.removeEventListener('loadend', onLoadEnd)
            finish('error')
            throw error
        }
    }

    prototype.open = instrumentedOpen as typeof prototype.open
    prototype.setRequestHeader = instrumentedSetRequestHeader as typeof prototype.setRequestHeader
    prototype.send = instrumentedSend as typeof prototype.send

    return () => {
        if (prototype.open === instrumentedOpen) prototype.open = originalOpen
        if (prototype.setRequestHeader === instrumentedSetRequestHeader) prototype.setRequestHeader = originalSetRequestHeader
        if (prototype.send === instrumentedSend) prototype.send = originalSend
    }
}
