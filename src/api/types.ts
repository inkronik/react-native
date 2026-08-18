import type { Engine } from '../engine/types.js'
import type { InkronikOptions } from '../types.js'

export interface CreateInkronikClientInput {
    readonly engine: Engine
    readonly options: InkronikOptions
}

export interface ReportInternalErrorInput {
    readonly error: unknown
    readonly onError?: (error: Error) => void
}

export interface RunSafelyInput<TResult> {
    readonly callback: () => TResult
    readonly fallback: TResult
    readonly onError?: (error: Error) => void
}

export interface ValidateMobileConfigurationInput {
    readonly collectorUrl: string
    readonly publicIngestKey: string
    readonly projectId: string
    readonly allowInsecureDevelopment: boolean
}

export interface ResolvedConfiguration {
    readonly collectorUrl: URL
    readonly traceOrigins: ReadonlySet<string>
    readonly autoInstrumentFetch: boolean
    readonly autoInstrumentXhr: boolean
    readonly maxBreadcrumbs: number
    readonly maxCacheItems: number
    readonly maxEventBytes: number
    readonly maxEnvelopeBytes: number
    readonly cacheItemTtlMs: number
    readonly retryBaseDelayMs: number
    readonly retryMaxDelayMs: number
    readonly dedupeWindowMs: number
}

export interface ResolveConfigurationInput {
    readonly options: InkronikOptions
}

export interface ValidateIntegerInput {
    readonly name: string
    readonly value: number
    readonly minimum: number
    readonly maximum: number
}
