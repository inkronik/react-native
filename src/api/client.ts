import type { Engine } from '../engine/types.js'
import { sanitizeEngineEvent } from '../engine/sanitize-event.js'
import { isSensitiveKey, redactText, sanitizeKey, sanitizeRecord } from '../privacy/sanitize.js'
import { installGlobalFetchInstrumentation } from '../tracing/fetch.js'
import { installGlobalXhrInstrumentation } from '../tracing/xhr.js'
import { parseNativePendingEvents } from '../native/parser.js'
import { getNativeCaptureModule } from '../native/registry.js'
import type {
    BreadcrumbInput,
    CaptureContext,
    CaptureExceptionInput,
    CaptureMessageInput,
    FlushInput,
    InkronikOptions,
    SetContextInput,
    SetTagInput,
    User,
} from '../types.js'
import { resolveConfiguration } from './configuration.js'
import { reportInternalError, runSafely } from './safety.js'
import type { CreateInkronikClientInput } from './types.js'

const MAX_USER_ID_LENGTH = 128
const MAX_FINGERPRINT_PARTS = 10
const MAX_FINGERPRINT_PART_LENGTH = 256

const sanitizeTags = (tags: Readonly<Record<string, string>> | undefined): Readonly<Record<string, string>> | undefined => {
    if (tags === undefined) {
        return undefined
    }

    return Object.fromEntries(
        Object.entries(tags)
            .slice(0, 50)
            .map(([key, value]) => {
                const safeKey = sanitizeKey(key)
                return [safeKey, isSensitiveKey(safeKey) ? '[REDACTED]' : redactText(value)]
            }),
    )
}

const sanitizeContexts = (
    contexts: Readonly<Record<string, Readonly<Record<string, unknown>>>> | undefined,
): Readonly<Record<string, Readonly<Record<string, unknown>>>> | undefined => {
    if (contexts === undefined) {
        return undefined
    }

    return Object.fromEntries(
        Object.entries(contexts)
            .slice(0, 20)
            .map(([key, value]) => [sanitizeKey(key), sanitizeRecord({ value })]),
    )
}

const sanitizeCaptureContext = (context: CaptureContext | undefined): CaptureContext => ({
    ...(context?.level === undefined ? {} : { level: context.level }),
    ...(context?.tags === undefined ? {} : { tags: sanitizeTags(context.tags) }),
    ...(context?.contexts === undefined ? {} : { contexts: sanitizeContexts(context.contexts) }),
    ...(context?.fingerprint === undefined
        ? {}
        : { fingerprint: context.fingerprint.slice(0, MAX_FINGERPRINT_PARTS).map(value => redactText(value).slice(0, MAX_FINGERPRINT_PART_LENGTH)) }),
})

const validateUserId = (id: string): string => {
    const value = id.trim()

    const hasControlCharacter = Array.from(value).some(character => {
        const codePoint = character.codePointAt(0) ?? 0
        return codePoint <= 31 || codePoint === 127
    })

    if (value.length === 0 || value.length > MAX_USER_ID_LENGTH || hasControlCharacter) {
        throw new Error(`user.id must contain 1-${MAX_USER_ID_LENGTH} printable characters.`)
    }

    return value
}

const validateTimeout = (timeoutMs: number): number => {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 30000) {
        throw new Error('timeoutMs must be an integer between 0 and 30000.')
    }

    return timeoutMs
}

export class InkronikClient {
    private readonly engine: Engine
    private readonly onError: InkronikOptions['onError']
    private restoreGlobalFetch?: () => void
    private restoreGlobalXhr?: () => void

    public constructor({ engine, options }: CreateInkronikClientInput) {
        const configuration = resolveConfiguration({ options })

        this.engine = engine
        this.onError = options.onError
        const nativeCaptureModule = getNativeCaptureModule()

        engine.initialize({
            collectorUrl: configuration.collectorUrl.toString(),
            projectId: options.projectId,
            publicIngestKey: options.publicIngestKey,
            ...(options.release === undefined ? {} : { release: options.release }),
            ...(options.dist === undefined ? {} : { dist: options.dist }),
            ...(options.environment === undefined ? {} : { environment: options.environment }),
            maxBreadcrumbs: configuration.maxBreadcrumbs,
            maxCacheItems: configuration.maxCacheItems,
            maxEventBytes: configuration.maxEventBytes,
            maxEnvelopeBytes: configuration.maxEnvelopeBytes,
            cacheItemTtlMs: configuration.cacheItemTtlMs,
            retryBaseDelayMs: configuration.retryBaseDelayMs,
            retryMaxDelayMs: configuration.retryMaxDelayMs,
            dedupeWindowMs: configuration.dedupeWindowMs,
            debug: options.debug === true,
            beforeSend: sanitizeEngineEvent,
            ...(nativeCaptureModule === undefined
                ? {}
                : {
                      acknowledgeNativeEvents: eventIds => nativeCaptureModule.acknowledgeEvents(JSON.stringify(eventIds)),
                  }),
        })

        if (nativeCaptureModule !== undefined) {
            nativeCaptureModule.configure(
                JSON.stringify({
                    cacheItemTtlMs: configuration.cacheItemTtlMs,
                    maxCacheItems: configuration.maxCacheItems,
                    ...(options.release === undefined ? {} : { release: options.release }),
                    ...(options.dist === undefined ? {} : { dist: options.dist }),
                    ...(options.environment === undefined ? {} : { environment: options.environment }),
                }),
            )
            void nativeCaptureModule
                .drainPendingEvents()
                .then(parseNativePendingEvents)
                .then(events => events.forEach(event => engine.captureNativeEvent(event)))
                .catch(error => reportInternalError({ error, onError: this.onError }))
        }

        if (configuration.autoInstrumentFetch && configuration.traceOrigins.size > 0) {
            this.restoreGlobalFetch = installGlobalFetchInstrumentation({
                addBreadcrumb: breadcrumb => this.addBreadcrumb(breadcrumb),
                captureSpan: span => {
                    this.engine.captureSpan(span)
                },
                collectorUrl: configuration.collectorUrl,
                onError: this.onError,
                traceOrigins: configuration.traceOrigins,
            })
        }

        if (configuration.autoInstrumentXhr && configuration.traceOrigins.size > 0) {
            this.restoreGlobalXhr = installGlobalXhrInstrumentation({
                addBreadcrumb: breadcrumb => this.addBreadcrumb(breadcrumb),
                captureSpan: span => {
                    this.engine.captureSpan(span)
                },
                collectorUrl: configuration.collectorUrl,
                onError: this.onError,
                traceOrigins: configuration.traceOrigins,
            })
        }
    }

    public captureException({ context, error }: CaptureExceptionInput): string {
        return runSafely({
            callback: () => this.engine.captureException({ context: sanitizeCaptureContext(context), error }),
            fallback: '',
            onError: this.onError,
        })
    }

    public captureMessage({ context, message }: CaptureMessageInput): string {
        return runSafely({
            callback: () => this.engine.captureMessage({ context: sanitizeCaptureContext(context), message: redactText(message) }),
            fallback: '',
            onError: this.onError,
        })
    }

    public setUser(user: User): void {
        runSafely({
            callback: () => {
                const id = validateUserId(user.id)
                this.engine.setUser({ id })
                getNativeCaptureModule()?.setUserId(id)
            },
            fallback: undefined,
            onError: this.onError,
        })
    }

    public clearUser(): void {
        runSafely({
            callback: () => {
                this.engine.setUser(null)
                getNativeCaptureModule()?.setUserId(null)
            },
            fallback: undefined,
            onError: this.onError,
        })
    }

    public setTag({ key, value }: SetTagInput): void {
        runSafely({
            callback: () => this.engine.setTag({ key: sanitizeKey(key), value: redactText(value) }),
            fallback: undefined,
            onError: this.onError,
        })
    }

    public setContext({ name, value }: SetContextInput): void {
        runSafely({
            callback: () => this.engine.setContext({ name: sanitizeKey(name), value: sanitizeRecord({ value }) }),
            fallback: undefined,
            onError: this.onError,
        })
    }

    public addBreadcrumb(breadcrumb: BreadcrumbInput): void {
        runSafely({
            callback: () =>
                this.engine.addBreadcrumb({
                    category: sanitizeKey(breadcrumb.category),
                    ...(breadcrumb.message === undefined ? {} : { message: redactText(breadcrumb.message) }),
                    ...(breadcrumb.level === undefined ? {} : { level: breadcrumb.level }),
                    ...(breadcrumb.data === undefined ? {} : { data: sanitizeRecord({ value: breadcrumb.data }) }),
                    ...(breadcrumb.timestamp === undefined ? {} : { timestamp: breadcrumb.timestamp }),
                }),
            fallback: undefined,
            onError: this.onError,
        })
    }

    public flush({ timeoutMs }: FlushInput): Promise<boolean> {
        const timeout = runSafely({ callback: () => validateTimeout(timeoutMs), fallback: 0, onError: this.onError })
        return this.engine.flush(timeout).catch(error => {
            reportInternalError({ error, onError: this.onError })
            return false
        })
    }

    public shutdown({ timeoutMs }: FlushInput): Promise<boolean> {
        this.restoreGlobalFetch?.()
        this.restoreGlobalXhr?.()
        // Restoring global fetch is an external instrumentation lifecycle boundary.
        // eslint-disable-next-line functional/immutable-data -- Lifecycle teardown releases the installed host patch.
        this.restoreGlobalFetch = undefined
        // eslint-disable-next-line functional/immutable-data -- Lifecycle teardown releases the installed host patch.
        this.restoreGlobalXhr = undefined

        const timeout = runSafely({ callback: () => validateTimeout(timeoutMs), fallback: 0, onError: this.onError })
        return this.engine.close(timeout).catch(error => {
            reportInternalError({ error, onError: this.onError })
            return false
        })
    }
}

export const createInkronikClient = (input: CreateInkronikClientInput): InkronikClient => new InkronikClient(input)
