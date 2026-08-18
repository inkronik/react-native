import type { DeliveredCrashResult, ValidateAcknowledgementInput, ValidateDeliveredEnvelopeInput } from './types'

const eventIdPattern = /^[0-9a-f]{32}$/u
const addressPattern = /^0x[0-9a-f]{1,16}$/u
const addressKeys = ['instruction_addr', 'image_addr', 'symbol_addr'] as const
const forbiddenKeyPattern = /(?:register|memory|open_fds|log_buffers|stack_dump|notable_addresses)/iu
const privatePathPattern = /(?:\/data\/(?:app|data|user)\/[^/\s]+\/|\/private\/var\/containers\/Bundle\/Application\/)/u

const record = (value: unknown, message: string): Readonly<Record<string, unknown>> => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(message)
    return value as Readonly<Record<string, unknown>>
}

const array = (value: unknown, message: string): ReadonlyArray<unknown> => {
    if (!Array.isArray(value)) throw new Error(message)
    return value
}

const assertMinimized = (value: unknown): void => {
    if (Array.isArray(value)) {
        value.forEach(assertMinimized)
        return
    }
    if (typeof value !== 'object' || value === null) return

    Object.entries(value).forEach(([key, nestedValue]) => {
        if (forbiddenKeyPattern.test(key)) throw new Error(`Forbidden native field reached the envelope: ${key}`)
        assertMinimized(nestedValue)
    })
}

export const validateDeliveredEnvelope = ({
    body,
    crashCase,
    expectedRelease,
    expectedUserId,
}: ValidateDeliveredEnvelopeInput): DeliveredCrashResult => {
    if (privatePathPattern.test(body)) throw new Error('A private native image path reached the envelope')
    const envelope = record(JSON.parse(body) as unknown, 'Collector body must be an object')
    const events = array(envelope.events, 'Collector body must contain events')
    const event = events
        .map(candidate => record(candidate, 'Envelope event must be an object'))
        .find(candidate => candidate.platform === crashCase.platform)
    if (event === undefined) throw new Error(`No ${crashCase.platform} event was delivered`)
    if (typeof event.event_id !== 'string' || !eventIdPattern.test(event.event_id)) throw new Error('Native event ID is invalid')

    const user = record(event.user, 'Native event must contain its crash-time user snapshot')
    if (user.id !== expectedUserId) throw new Error('Crash-time user snapshot does not match')
    const contexts = record(event.contexts, 'Native event contexts are missing')
    const release = record(contexts.release, 'Release context is missing')
    if (release.value !== expectedRelease) throw new Error('Release context does not match')

    const exceptions = array(event.exceptions, 'Native event exceptions are missing')
    const exception = record(exceptions[0], 'Native event exception is missing')
    const acceptedMechanisms = [crashCase.expectedMechanism, ...(crashCase.alternateMechanisms ?? [])]
    if (typeof exception.mechanism !== 'string' || !acceptedMechanisms.includes(exception.mechanism)) {
        throw new Error(`Unexpected mechanism: ${String(exception.mechanism)}`)
    }
    const frames = array(exception.frames, 'Native frame collection is missing')
    if (crashCase.expectsFrames && frames.length === 0) throw new Error('Decoded native frames are missing')
    frames.forEach(candidate => {
        const frame = record(candidate, 'Native frame must be an object')
        if (typeof frame.filename !== 'string' || frame.filename.includes('/')) throw new Error('Native frame filename is not minimized')
        addressKeys.forEach(key => {
            const address = frame[key]
            if (address !== undefined && (typeof address !== 'string' || !addressPattern.test(address))) {
                throw new Error(`Invalid native frame address: ${key}`)
            }
        })
    })
    assertMinimized(event)

    return { eventId: event.event_id, mechanism: exception.mechanism, frameCount: frames.length }
}

export const validateAcknowledgement = ({ eventId, pendingEventsJson }: ValidateAcknowledgementInput): void => {
    const pendingEvents = array(JSON.parse(pendingEventsJson) as unknown, 'Native pending queue must be an array')
    const isStillPending = pendingEvents.some(candidate => record(candidate, 'Native pending event must be an object').id === eventId)
    if (isStillPending) throw new Error('Accepted native event remains in the restart queue')
}
