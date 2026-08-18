import { sanitizeUrl } from '../privacy/sanitize.js'
import { reportInternalError } from '../api/safety.js'
import { createTraceContext, secureRandomBytes, toTraceparent } from './trace-context.js'
import type { InstallGlobalFetchInstrumentationInput, InstrumentedRequestInput, InstrumentFetchInput } from './types.js'

const resolveUrl = (input: RequestInfo | URL): URL | undefined => {
    try {
        if (input instanceof Request) {
            return new URL(input.url)
        }

        return new URL(String(input))
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

const getHeaders = ({ init, input }: Pick<InstrumentedRequestInput, 'init' | 'input'>): Headers => {
    const inputHeaders = input instanceof Request ? input.headers : undefined
    return new Headers(init?.headers ?? inputHeaders)
}

const withTraceparent = ({ init, input, traceparent }: InstrumentedRequestInput): readonly [RequestInfo | URL, RequestInit | undefined] => {
    const headers = getHeaders({ init, input })
    headers.set('traceparent', traceparent)

    if (input instanceof Request) {
        return [new Request(input, { ...init, headers }), undefined]
    }

    return [input, { ...init, headers }]
}

const getMethod = ({ init, input }: Pick<InstrumentedRequestInput, 'init' | 'input'>): string =>
    (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()

export const instrumentFetch = ({ addBreadcrumb, captureSpan, collectorUrl, fetchImpl, onError, traceOrigins }: InstrumentFetchInput): typeof fetch =>
    (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const requestUrl = resolveUrl(input)

        if (requestUrl === undefined || !traceOrigins.has(requestUrl.origin) || isCollectorRequest({ collectorUrl, requestUrl })) {
            return fetchImpl(input, init)
        }

        const headers = getHeaders({ init, input })
        const traceContext = createTraceContext({ parentTraceparent: headers.get('traceparent') ?? undefined, randomBytes: secureRandomBytes })

        if (traceContext === undefined) {
            reportInternalError({ error: new Error('Secure randomness is unavailable; trace propagation was skipped.'), onError })
            return fetchImpl(input, init)
        }

        const traceparent = toTraceparent(traceContext)
        const method = getMethod({ init, input })
        const safeUrl = sanitizeUrl({ value: requestUrl.toString() })
        const tracedRequest = withTraceparent({ init, input, traceparent })
        const startedAt = Date.now()

        addBreadcrumb({
            category: 'http.client',
            level: 'info',
            message: `${method} ${safeUrl}`,
            data: { method, trace_id: traceContext.traceId, span_id: traceContext.spanId, url: safeUrl },
        })

        return fetchImpl(...tracedRequest)
            .then(response => {
                const endedAt = Date.now()
                addBreadcrumb({
                    category: 'http.client',
                    level: response.ok ? 'info' : 'warning',
                    message: `${method} ${safeUrl} ${response.status}`,
                    data: {
                        duration_ms: endedAt - startedAt,
                        method,
                        span_id: traceContext.spanId,
                        status_code: response.status,
                        trace_id: traceContext.traceId,
                        url: safeUrl,
                    },
                })
                captureSpan({
                    name: `HTTP ${method}`,
                    startedAt,
                    endedAt,
                    status: response.ok ? 'ok' : 'error',
                    trace: traceContext,
                    attributes: { method, status_code: response.status, url: safeUrl },
                })
                return response
            })
            .catch((error: unknown) => {
                const endedAt = Date.now()
                addBreadcrumb({
                    category: 'http.client',
                    level: 'error',
                    message: `${method} ${safeUrl} failed`,
                    data: { duration_ms: endedAt - startedAt, method, span_id: traceContext.spanId, trace_id: traceContext.traceId, url: safeUrl },
                })
                captureSpan({
                    name: `HTTP ${method}`,
                    startedAt,
                    endedAt,
                    status: 'error',
                    trace: traceContext,
                    attributes: { method, url: safeUrl },
                })
                throw error
            })
    }) as typeof fetch

export const installGlobalFetchInstrumentation = (input: InstallGlobalFetchInstrumentationInput): (() => void) => {
    const originalFetch = globalThis.fetch
    const instrumented = instrumentFetch({ ...input, fetchImpl: originalFetch })

    // Global fetch is an external instrumentation boundary and must be restored during shutdown.
    // Global fetch is the external API being instrumented.
    // eslint-disable-next-line functional/immutable-data
    globalThis.fetch = instrumented

    return () => {
        if (globalThis.fetch === instrumented) {
            // Global fetch is the external API being restored.
            // eslint-disable-next-line functional/immutable-data
            globalThis.fetch = originalFetch
        }
    }
}
