import type { ComponentType, ErrorInfo, ReactNode } from 'react'

export type EventLevel = 'debug' | 'info' | 'warning' | 'error' | 'fatal'
export type BreadcrumbLevel = 'debug' | 'info' | 'warning' | 'error'

export interface InkronikOptions {
    readonly collectorUrl: string
    readonly publicIngestKey: string
    readonly projectId: string
    readonly release?: string
    readonly dist?: string
    readonly environment?: string
    readonly tracePropagationTargets?: ReadonlyArray<string>
    readonly autoInstrumentFetch?: boolean
    readonly autoInstrumentXhr?: boolean
    readonly maxBreadcrumbs?: number
    readonly maxCacheItems?: number
    readonly maxEventBytes?: number
    readonly maxEnvelopeBytes?: number
    readonly cacheItemTtlMs?: number
    readonly retryBaseDelayMs?: number
    readonly retryMaxDelayMs?: number
    readonly dedupeWindowMs?: number
    readonly debug?: boolean
    readonly allowInsecureDevelopment?: boolean
    readonly onError?: (error: Error) => void
}

export interface TraceIdentifiers {
    readonly traceId: string
    readonly spanId: string
    readonly parentSpanId?: string
    readonly sampled: boolean
}

export interface CaptureSpanInput {
    readonly name: string
    readonly startedAt: number
    readonly endedAt: number
    readonly status: 'ok' | 'error'
    readonly trace: TraceIdentifiers
    readonly attributes?: Readonly<Record<string, unknown>>
}

export interface User {
    readonly id: string
}

export interface SetTagInput {
    readonly key: string
    readonly value: string
}

export interface SetContextInput {
    readonly name: string
    readonly value: Readonly<Record<string, unknown>>
}

export interface BreadcrumbInput {
    readonly category: string
    readonly message?: string
    readonly level?: BreadcrumbLevel
    readonly data?: Readonly<Record<string, unknown>>
    readonly timestamp?: number
}

export interface CaptureContext {
    readonly level?: EventLevel
    readonly tags?: Readonly<Record<string, string>>
    readonly contexts?: Readonly<Record<string, Readonly<Record<string, unknown>>>>
    readonly fingerprint?: ReadonlyArray<string>
}

export interface CaptureExceptionInput {
    readonly error: unknown
    readonly context?: CaptureContext
}

export interface CaptureMessageInput {
    readonly message: string
    readonly context?: CaptureContext
}

export interface FlushInput {
    readonly timeoutMs: number
}

export interface InkronikErrorBoundaryProps {
    readonly children?: ReactNode
    readonly fallback: ReactNode | ComponentType<{ readonly error: Error }>
    readonly beforeCapture?: (error: Error, info: ErrorInfo) => void
    readonly onError?: (error: Error, info: ErrorInfo) => void
}

export interface InkronikErrorBoundaryState {
    readonly error?: Error
}

export interface WrapInput<TProps extends object> {
    readonly component: ComponentType<TProps>
    readonly fallback: InkronikErrorBoundaryProps['fallback']
}
