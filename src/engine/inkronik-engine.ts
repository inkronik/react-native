/* eslint-disable functional/immutable-data -- The engine owns bounded lifecycle state and external timer/handler registrations. */
import { redactText, sanitizeRecord, toSafeErrorChain } from '../privacy/sanitize.js'
import type { MobileEnvelope, MobileEvent, MobileStackFrame } from '../protocol/types.js'
import { secureRandomBytes } from '../tracing/trace-context.js'
import type { BreadcrumbInput, CaptureContext, CaptureSpanInput, User } from '../types.js'
import type { NativePendingEvent } from '../native/types.js'
import { parseStack, sanitizeRawStack } from './stack.js'
import type {
    BatchSelection,
    BrowserEventTargetLike,
    BuildEventInput,
    DedupeRecord,
    Engine,
    EngineCaptureExceptionInput,
    EngineCaptureMessageInput,
    EngineEvent,
    EngineInitializeInput,
    EngineSetContextInput,
    EngineSetTagInput,
    EnqueueInput,
    ErrorUtilsLike,
    FlushQueueInput,
    HermesInternalLike,
    QueuedEvent,
    ResolvedEngineConfiguration,
    SelectBatchInput,
    UnhandledRejectionEventLike,
} from './types.js'

const SDK_VERSION = '0.1.0'
const MAX_CAUSE_CHAIN = 5

const toHex = (bytes: Uint8Array): string => Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('')

const createEventId = (): string => {
    const bytes = secureRandomBytes(16)

    if (bytes === undefined) {
        throw new Error('Secure randomness is unavailable; the event was not captured.')
    }

    return toHex(bytes)
}

const buildEndpoint = (collectorUrl: string): string => {
    const parsed = new URL(collectorUrl)
    const basePath = parsed.pathname.replace(/\/+$/u, '')
    return `${parsed.origin}${basePath}/v1/mobile/envelopes`
}

const mergeTags = ({
    context,
    tags,
}: {
    readonly context: CaptureContext
    readonly tags: Readonly<Record<string, string>>
}): Readonly<Record<string, string>> => ({
    ...tags,
    ...context.tags,
})

const mergeContexts = ({
    context,
    contexts,
}: {
    readonly context: CaptureContext
    readonly contexts: Readonly<Record<string, Readonly<Record<string, unknown>>>>
}): Readonly<Record<string, Readonly<Record<string, unknown>>>> => ({ ...contexts, ...context.contexts })

const utf8ByteLength = (value: string): number =>
    Array.from(value).reduce((bytes, character) => {
        const codePoint = character.codePointAt(0) ?? 0

        if (codePoint <= 0x7f) return bytes + 1
        if (codePoint <= 0x7ff) return bytes + 2
        if (codePoint <= 0xffff) return bytes + 3
        return bytes + 4
    }, 0)

const toEngineEvent = (event: MobileEvent): EngineEvent => event as unknown as EngineEvent
const fromEngineEvent = (event: EngineEvent): MobileEvent => event as unknown as MobileEvent

const createRejectionError = ({ id, rejection }: { readonly id?: number; readonly rejection: unknown }): Error =>
    new Error(id === undefined ? 'Unhandled promise rejection' : `Unhandled promise rejection (${id})`, { cause: rejection })

const toNativeFrames = (event: NativePendingEvent): ReadonlyArray<MobileStackFrame> =>
    (event.frames ?? []).map(frame => ({
        function: frame.function,
        filename: frame.filename,
        in_app: frame.inApp,
        ...(frame.instructionAddress === undefined ? {} : { instruction_addr: frame.instructionAddress }),
        ...(frame.imageAddress === undefined ? {} : { image_addr: frame.imageAddress }),
        ...(frame.imageUuid === undefined ? {} : { image_uuid: frame.imageUuid }),
        ...(frame.symbolAddress === undefined ? {} : { symbol_addr: frame.symbolAddress }),
    }))

export class InkronikEngine implements Engine {
    private acknowledgeNativeEvents?: EngineInitializeInput['acknowledgeNativeEvents']
    private breadcrumbs: ReadonlyArray<BreadcrumbInput> = []
    private configuration?: ResolvedEngineConfiguration
    private contexts: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {}
    private readonly dedupeRecords = new WeakMap<object, DedupeRecord>()
    private inFlight?: Promise<boolean>
    private isClosed = false
    private queue: ReadonlyArray<QueuedEvent> = []
    private removeGlobalHandlers?: () => void
    private retryTimer?: ReturnType<typeof setTimeout>
    private tags: Readonly<Record<string, string>> = {}
    private user?: User

    public initialize(input: EngineInitializeInput): void {
        if (this.configuration !== undefined) {
            throw new Error('Inkronik capture engine is already initialized.')
        }

        this.configuration = {
            beforeSend: input.beforeSend,
            endpoint: buildEndpoint(input.collectorUrl),
            projectId: input.projectId,
            publicIngestKey: input.publicIngestKey,
            maxBreadcrumbs: input.maxBreadcrumbs,
            maxCacheItems: input.maxCacheItems,
            maxEventBytes: input.maxEventBytes,
            maxEnvelopeBytes: input.maxEnvelopeBytes,
            cacheItemTtlMs: input.cacheItemTtlMs,
            retryBaseDelayMs: input.retryBaseDelayMs,
            retryMaxDelayMs: input.retryMaxDelayMs,
            dedupeWindowMs: input.dedupeWindowMs,
        }
        this.acknowledgeNativeEvents = input.acknowledgeNativeEvents
        this.isClosed = false
        this.contexts = {
            sdk: { name: '@inkronik/react-native', version: SDK_VERSION },
            ...(input.release === undefined ? {} : { release: { value: input.release } }),
            ...(input.dist === undefined ? {} : { distribution: { value: input.dist } }),
            ...(input.environment === undefined ? {} : { environment: { value: input.environment } }),
        }
        this.removeGlobalHandlers = this.installGlobalHandlers()
    }

    public captureException({ context, error }: EngineCaptureExceptionInput): string {
        const now = Date.now()
        const errorObject = typeof error === 'object' && error !== null ? error : undefined
        const duplicate = errorObject === undefined ? undefined : this.dedupeRecords.get(errorObject)
        const dedupeWindowMs = this.configuration?.dedupeWindowMs ?? 0

        if (duplicate !== undefined && now - duplicate.capturedAt <= dedupeWindowMs) {
            return duplicate.eventId
        }

        const handled = context.tags?.['inkronik.handled'] !== 'false'
        const mechanism = context.tags?.['inkronik.mechanism'] ?? 'manual'
        const safeErrors = toSafeErrorChain({ error, maxCauses: MAX_CAUSE_CHAIN })
        const exceptions = safeErrors.map((safeError, index) => ({
            type: safeError.name,
            value: safeError.message,
            handled,
            mechanism: index === 0 ? mechanism : 'cause',
            ...(safeError.stack === undefined ? {} : { raw_stack: sanitizeRawStack(safeError.stack) }),
            frames: parseStack(safeError.stack),
        }))
        const primaryError = safeErrors[0] as (typeof safeErrors)[number]

        const event = this.buildEvent({ context, exceptions, kind: 'error', message: primaryError.message })
        const eventId = this.enqueue({ event })

        if (eventId !== '' && errorObject !== undefined) {
            this.dedupeRecords.set(errorObject, { capturedAt: now, eventId })
        }

        return eventId
    }

    public captureMessage({ context, message }: EngineCaptureMessageInput): string {
        return this.enqueue({ event: this.buildEvent({ context, kind: 'message', message: redactText(message) }) })
    }

    public captureSpan(input: CaptureSpanInput): string {
        if (!input.trace.sampled) {
            return ''
        }

        const durationMs = Math.max(0, input.endedAt - input.startedAt)
        return this.enqueue({
            event: this.buildEvent({
                context: { level: input.status === 'error' ? 'error' : 'info' },
                kind: 'span',
                message: redactText(input.name),
                span: {
                    name: redactText(input.name),
                    started_at: new Date(input.startedAt).toISOString(),
                    ended_at: new Date(input.endedAt).toISOString(),
                    duration_ms: durationMs,
                    status: input.status,
                    trace: input.trace,
                    attributes: sanitizeRecord({ value: input.attributes ?? {} }),
                },
            }),
        })
    }

    public captureNativeEvent(input: NativePendingEvent): string {
        const configuration = this.configuration
        if (configuration === undefined) throw new Error('Inkronik capture engine is not initialized.')

        const event: MobileEvent = {
            schema_version: 1,
            event_id: input.id,
            project_id: configuration.projectId,
            timestamp: input.timestamp,
            platform: input.platform,
            runtime: 'react-native',
            kind: 'error',
            level: input.level,
            message: input.message,
            exceptions: [
                {
                    type: input.type,
                    value: input.message,
                    handled: input.handled,
                    mechanism: input.mechanism,
                    ...(input.stack === undefined ? {} : { raw_stack: input.stack }),
                    frames: toNativeFrames(input),
                },
            ],
            ...(input.userId === undefined ? {} : { user: { id: input.userId } }),
            tags: this.tags,
            contexts: { ...this.contexts, ...(input.contexts ?? {}) },
            breadcrumbs: this.breadcrumbs,
            fingerprint: [],
        }

        return this.enqueue({ event, nativeEventId: input.id })
    }

    public setUser(user: User | null): void {
        this.user = user ?? undefined
    }

    public setTag({ key, value }: EngineSetTagInput): void {
        this.tags = { ...this.tags, [key]: value }
    }

    public setContext({ name, value }: EngineSetContextInput): void {
        this.contexts = { ...this.contexts, [name]: sanitizeRecord({ value }) }
    }

    public addBreadcrumb(breadcrumb: BreadcrumbInput): void {
        const maxBreadcrumbs = this.configuration?.maxBreadcrumbs ?? 0
        this.breadcrumbs = maxBreadcrumbs === 0 ? [] : [...this.breadcrumbs, breadcrumb].slice(-maxBreadcrumbs)
    }

    public flush(timeoutMs: number): Promise<boolean> {
        const deadline = Date.now() + timeoutMs
        const drain = (): Promise<boolean> => {
            const remainingMs = Math.max(0, deadline - Date.now())
            return this.flushQueue({ ignoreBackoff: true, timeoutMs: remainingMs }).then(success => {
                if (!success || this.queue.length === 0) {
                    return success && this.queue.length === 0
                }

                return Date.now() >= deadline ? false : drain()
            })
        }

        return drain()
    }

    public close(timeoutMs: number): Promise<boolean> {
        this.removeGlobalHandlers?.()
        this.removeGlobalHandlers = undefined
        this.isClosed = true

        if (this.retryTimer !== undefined) {
            clearTimeout(this.retryTimer)
            this.retryTimer = undefined
        }

        return this.flush(timeoutMs)
    }

    private buildEvent({ context, exceptions, kind, message, span }: BuildEventInput): MobileEvent {
        const configuration = this.configuration

        if (configuration === undefined) {
            throw new Error('Inkronik capture engine is not initialized.')
        }

        return {
            schema_version: 1,
            event_id: createEventId(),
            project_id: configuration.projectId,
            timestamp: new Date().toISOString(),
            platform: 'javascript',
            runtime: 'react-native',
            kind,
            level: context.level ?? (kind === 'error' ? 'error' : 'info'),
            message,
            ...(exceptions === undefined ? {} : { exceptions }),
            ...(span === undefined ? {} : { span }),
            ...(this.user === undefined ? {} : { user: this.user }),
            tags: mergeTags({ context, tags: this.tags }),
            contexts: mergeContexts({ context, contexts: this.contexts }),
            breadcrumbs: this.breadcrumbs,
            fingerprint: context.fingerprint ?? [],
        }
    }

    private enqueue({ event, nativeEventId }: EnqueueInput): string {
        const configuration = this.configuration

        if (configuration === undefined || configuration.maxCacheItems === 0 || this.isClosed) {
            return ''
        }

        if (nativeEventId !== undefined && this.queue.some(item => item.nativeEventId === nativeEventId)) {
            return nativeEventId
        }

        const safeEvent = configuration.beforeSend(toEngineEvent(event))
        if (safeEvent === null) {
            return ''
        }

        const resolvedEvent = fromEngineEvent(safeEvent)
        if (utf8ByteLength(JSON.stringify(resolvedEvent)) > configuration.maxEventBytes) {
            return ''
        }

        const now = Date.now()
        const item: QueuedEvent = {
            attempts: 0,
            enqueuedAt: now,
            event: resolvedEvent,
            nextAttemptAt: now,
            ...(nativeEventId === undefined ? {} : { nativeEventId }),
        }
        this.queue = [...this.pruneExpired(now), item].slice(-configuration.maxCacheItems)
        void this.flushQueue({ ignoreBackoff: false, timeoutMs: 2000 })
        return resolvedEvent.event_id
    }

    private pruneExpired(now: number): ReadonlyArray<QueuedEvent> {
        const ttlMs = this.configuration?.cacheItemTtlMs ?? 0
        const retained = this.queue.filter(item => now - item.enqueuedAt <= ttlMs)
        this.queue = retained
        return retained
    }

    private selectBatch({ configuration, ignoreBackoff, now }: SelectBatchInput): BatchSelection | undefined {
        const eligible = this.pruneExpired(now).filter(item => ignoreBackoff || item.nextAttemptAt <= now)
        const sentAt = new Date(now).toISOString()
        const selected = eligible.reduce<BatchSelection>(
            (batch, item) => {
                const candidateItems = [...batch.items, item]
                const envelope: MobileEnvelope = { schema_version: 1, sent_at: sentAt, events: candidateItems.map(candidate => candidate.event) }
                const body = JSON.stringify(envelope)
                return utf8ByteLength(body) <= configuration.maxEnvelopeBytes ? { body, items: candidateItems } : batch
            },
            { body: '', items: [] },
        )

        return selected.items.length === 0 ? undefined : selected
    }

    private flushQueue({ ignoreBackoff, timeoutMs }: FlushQueueInput): Promise<boolean> {
        if (this.inFlight !== undefined) {
            return this.inFlight
        }

        const configuration = this.configuration
        if (configuration === undefined) {
            return Promise.resolve(true)
        }

        const batch = this.selectBatch({ configuration, ignoreBackoff, now: Date.now() })
        if (batch === undefined) {
            return Promise.resolve(this.queue.length === 0)
        }

        const abortController = new AbortController()
        const timeout = setTimeout(() => abortController.abort(), timeoutMs)
        const request = fetch(configuration.endpoint, {
            body: batch.body,
            headers: {
                'content-type': 'application/json',
                'x-inkronik-project-id': configuration.projectId,
                'x-inkronik-public-key': configuration.publicIngestKey,
            },
            method: 'POST',
            signal: abortController.signal,
        })
            .then(response => this.handleResponse({ batch, configuration, status: response.status }))
            .catch(() => {
                this.markBatchForRetry({ batch, configuration })
                return false
            })
            .finally(() => clearTimeout(timeout))

        this.inFlight = request
        return request.finally(() => {
            if (this.inFlight === request) {
                this.inFlight = undefined
            }
        })
    }

    private handleResponse({
        batch,
        configuration,
        status,
    }: {
        readonly batch: BatchSelection
        readonly configuration: ResolvedEngineConfiguration
        readonly status: number
    }): boolean {
        if (status >= 200 && status < 300) {
            this.removeBatch(batch)
            this.acknowledgeNativeBatch(batch)
            return true
        }

        if (status === 408 || status === 425 || status === 429 || status >= 500) {
            this.markBatchForRetry({ batch, configuration })
            return false
        }

        this.removeBatch(batch)
        return false
    }

    private acknowledgeNativeBatch(batch: BatchSelection): void {
        const nativeEventIds = batch.items.flatMap(item => (item.nativeEventId === undefined ? [] : [item.nativeEventId]))

        if (nativeEventIds.length === 0 || this.acknowledgeNativeEvents === undefined) return
        void this.acknowledgeNativeEvents(nativeEventIds).catch(() => false)
    }

    private removeBatch(batch: BatchSelection): void {
        const eventIds = new Set(batch.items.map(item => item.event.event_id))
        this.queue = this.queue.filter(item => !eventIds.has(item.event.event_id))

        if (this.queue.length === 0 && this.retryTimer !== undefined) {
            clearTimeout(this.retryTimer)
            this.retryTimer = undefined
        }
    }

    private markBatchForRetry({
        batch,
        configuration,
    }: {
        readonly batch: BatchSelection
        readonly configuration: ResolvedEngineConfiguration
    }): void {
        const eventIds = new Set(batch.items.map(item => item.event.event_id))
        const now = Date.now()
        const updatedQueue = this.queue.map(item => {
            if (!eventIds.has(item.event.event_id)) {
                return item
            }

            const attempts = item.attempts + 1
            const delay = Math.min(configuration.retryBaseDelayMs * 2 ** Math.min(attempts - 1, 20), configuration.retryMaxDelayMs)
            return { ...item, attempts, nextAttemptAt: now + delay }
        })
        const shortestDelay = Math.min(...updatedQueue.filter(item => eventIds.has(item.event.event_id)).map(item => item.nextAttemptAt - now))

        this.queue = updatedQueue
        this.scheduleRetry(shortestDelay)
    }

    private scheduleRetry(delayMs: number): void {
        if (this.retryTimer !== undefined || this.isClosed) {
            return
        }

        this.retryTimer = setTimeout(() => {
            this.retryTimer = undefined
            void this.flushQueue({ ignoreBackoff: false, timeoutMs: 2000 })
        }, delayMs)
    }

    private installGlobalHandlers(): () => void {
        const errorUtils = Reflect.get(globalThis, 'ErrorUtils') as ErrorUtilsLike | undefined
        const previousErrorHandler = errorUtils?.getGlobalHandler()
        const globalErrorHandler = (error: Error, isFatal = false): void => {
            this.captureException({
                error,
                context: {
                    level: isFatal ? 'fatal' : 'error',
                    tags: { 'inkronik.handled': 'false', 'inkronik.mechanism': 'react-native.error-utils' },
                },
            })
            previousErrorHandler?.(error, isFatal)
        }

        errorUtils?.setGlobalHandler(globalErrorHandler)

        const captureRejection = ({ id, rejection }: { readonly id?: number; readonly rejection: unknown }): void => {
            this.captureException({
                error: rejection,
                context: { level: 'error', tags: { 'inkronik.handled': 'false', 'inkronik.mechanism': 'unhandledrejection' } },
            })
            previousErrorHandler?.(createRejectionError({ id, rejection }), false)
        }
        const eventTarget = globalThis as unknown as Partial<BrowserEventTargetLike>
        const rejectionHandler = (event: UnhandledRejectionEventLike): void => captureRejection({ rejection: event.reason })
        eventTarget.addEventListener?.('unhandledrejection', rejectionHandler)

        const hermesInternal = Reflect.get(globalThis, 'HermesInternal') as HermesInternalLike | undefined
        hermesInternal?.enablePromiseRejectionTracker?.({
            allRejections: true,
            onUnhandled: (id, rejection) => captureRejection({ id, rejection }),
            onHandled: () => undefined,
        })

        return () => {
            if (errorUtils?.getGlobalHandler() === globalErrorHandler && previousErrorHandler !== undefined) {
                errorUtils.setGlobalHandler(previousErrorHandler)
            }
            eventTarget.removeEventListener?.('unhandledrejection', rejectionHandler)
        }
    }
}

export const createInkronikEngine = (): Engine => new InkronikEngine()
