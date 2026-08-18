import type { BreadcrumbInput, CaptureSpanInput } from '../types.js'

export interface TraceContext {
    readonly traceId: string
    readonly spanId: string
    readonly parentSpanId?: string
    readonly sampled: boolean
}

export interface CreateTraceContextInput {
    readonly parentTraceparent?: string
    readonly randomBytes: (length: number) => Uint8Array | undefined
}

export interface InstrumentFetchInput {
    readonly fetchImpl: typeof fetch
    readonly collectorUrl: URL
    readonly traceOrigins: ReadonlySet<string>
    readonly addBreadcrumb: (breadcrumb: BreadcrumbInput) => void
    readonly captureSpan: (span: CaptureSpanInput) => void
    readonly onError?: (error: Error) => void
}

export type InstallGlobalFetchInstrumentationInput = Omit<InstrumentFetchInput, 'fetchImpl'>

export interface InstrumentedRequestInput {
    readonly input: RequestInfo | URL
    readonly init?: RequestInit
    readonly traceparent: string
}

export interface XhrRequestState {
    readonly method: string
    readonly requestUrl: URL
    readonly parentTraceparent?: string
}

export interface InstrumentXhrInput {
    readonly addBreadcrumb: (breadcrumb: BreadcrumbInput) => void
    readonly captureSpan: (span: CaptureSpanInput) => void
    readonly collectorUrl: URL
    readonly onError?: (error: Error) => void
    readonly traceOrigins: ReadonlySet<string>
}
