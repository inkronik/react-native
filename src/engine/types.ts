import type { BreadcrumbInput, CaptureContext, CaptureSpanInput, User } from '../types.js'
import type { MobileEvent } from '../protocol/types.js'
import type { NativePendingEvent } from '../native/types.js'

export interface EngineEvent {
    readonly [key: string]: unknown
    readonly message?: string
    readonly exceptions?: MobileEvent['exceptions']
    readonly breadcrumbs?: ReadonlyArray<Readonly<Record<string, unknown>>>
    readonly contexts?: Readonly<Record<string, unknown>>
    readonly extra?: Readonly<Record<string, unknown>>
    readonly tags?: Readonly<Record<string, string>>
    readonly user?: Readonly<Record<string, unknown>>
    readonly span?: MobileEvent['span']
    readonly request?: unknown
    readonly server_name?: string
}

export interface ErrorUtilsLike {
    readonly getGlobalHandler: () => (error: Error, isFatal?: boolean) => void
    readonly setGlobalHandler: (handler: (error: Error, isFatal?: boolean) => void) => void
}

export interface UnhandledRejectionEventLike {
    readonly reason?: unknown
}

export interface BrowserEventTargetLike {
    readonly addEventListener: (type: string, listener: (event: UnhandledRejectionEventLike) => void) => void
    readonly removeEventListener: (type: string, listener: (event: UnhandledRejectionEventLike) => void) => void
}

export interface HermesInternalLike {
    readonly enablePromiseRejectionTracker?: (
        options: {
            readonly allRejections: boolean
            readonly onUnhandled: (id: number, rejection: unknown) => void
            readonly onHandled: (id: number) => void
        } | null,
    ) => void
}

export interface ResolvedEngineConfiguration {
    readonly beforeSend: EngineInitializeInput['beforeSend']
    readonly endpoint: string
    readonly projectId: string
    readonly publicIngestKey: string
    readonly maxBreadcrumbs: number
    readonly maxCacheItems: number
    readonly maxEventBytes: number
    readonly maxEnvelopeBytes: number
    readonly cacheItemTtlMs: number
    readonly retryBaseDelayMs: number
    readonly retryMaxDelayMs: number
    readonly dedupeWindowMs: number
}

export interface EngineInitializeInput {
    readonly collectorUrl: string
    readonly projectId: string
    readonly publicIngestKey: string
    readonly release?: string
    readonly dist?: string
    readonly environment?: string
    readonly maxBreadcrumbs: number
    readonly maxCacheItems: number
    readonly maxEventBytes: number
    readonly maxEnvelopeBytes: number
    readonly cacheItemTtlMs: number
    readonly retryBaseDelayMs: number
    readonly retryMaxDelayMs: number
    readonly dedupeWindowMs: number
    readonly debug: boolean
    readonly beforeSend: (event: EngineEvent) => EngineEvent | null
    readonly acknowledgeNativeEvents?: (eventIds: ReadonlyArray<string>) => Promise<boolean>
}

export interface EngineCaptureExceptionInput {
    readonly error: unknown
    readonly context: CaptureContext
}

export interface EngineCaptureMessageInput {
    readonly message: string
    readonly context: CaptureContext
}

export interface QueuedEvent {
    readonly event: MobileEvent
    readonly enqueuedAt: number
    readonly attempts: number
    readonly nextAttemptAt: number
    readonly nativeEventId?: string
}

export interface DedupeRecord {
    readonly capturedAt: number
    readonly eventId: string
}

export interface BuildEventInput {
    readonly context: CaptureContext
    readonly exceptions?: MobileEvent['exceptions']
    readonly kind: MobileEvent['kind']
    readonly message: string
    readonly span?: MobileEvent['span']
}

export interface EnqueueInput {
    readonly event: MobileEvent
    readonly nativeEventId?: string
}

export interface FlushQueueInput {
    readonly ignoreBackoff: boolean
    readonly timeoutMs: number
}

export interface BatchSelection {
    readonly items: ReadonlyArray<QueuedEvent>
    readonly body: string
}

export interface SelectBatchInput {
    readonly configuration: ResolvedEngineConfiguration
    readonly ignoreBackoff: boolean
    readonly now: number
}

export interface EngineSetTagInput {
    readonly key: string
    readonly value: string
}

export interface EngineSetContextInput {
    readonly name: string
    readonly value: Readonly<Record<string, unknown>>
}

export interface Engine {
    readonly initialize: (input: EngineInitializeInput) => void
    readonly captureException: (input: EngineCaptureExceptionInput) => string
    readonly captureMessage: (input: EngineCaptureMessageInput) => string
    readonly captureSpan: (input: CaptureSpanInput) => string
    readonly captureNativeEvent: (input: NativePendingEvent) => string
    readonly setUser: (user: User | null) => void
    readonly setTag: (input: EngineSetTagInput) => void
    readonly setContext: (input: EngineSetContextInput) => void
    readonly addBreadcrumb: (breadcrumb: BreadcrumbInput) => void
    readonly flush: (timeoutMs: number) => Promise<boolean>
    readonly close: (timeoutMs: number) => Promise<boolean>
}
