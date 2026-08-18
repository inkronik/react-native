import { redactStack, redactText, sanitizeRecord } from '../privacy/sanitize.js'
import type { NativePendingEvent, NativePlatform, NativeStackFrame } from './types.js'

const eventIdPattern = /^[0-9a-f]{32}$/u
const nativePlatforms = new Set<NativePlatform>(['android', 'ios'])
const addressPattern = /^0x[0-9a-f]{1,16}$/u
const imageUuidPattern = /^[0-9a-f-]{32,36}$/u

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === 'object' && value !== null && !Array.isArray(value)

const optionalAddress = (value: unknown): string | undefined =>
    typeof value === 'string' && addressPattern.test(value.toLowerCase()) ? value.toLowerCase() : undefined

const parseFrame = (value: unknown): NativeStackFrame | undefined => {
    if (!isRecord(value) || typeof value.function !== 'string' || typeof value.filename !== 'string' || typeof value.inApp !== 'boolean') {
        return undefined
    }

    const instructionAddress = optionalAddress(value.instructionAddress)
    const imageAddress = optionalAddress(value.imageAddress)
    const symbolAddress = optionalAddress(value.symbolAddress)
    const imageUuid =
        typeof value.imageUuid === 'string' && imageUuidPattern.test(value.imageUuid.toLowerCase()) ? value.imageUuid.toLowerCase() : undefined

    return {
        function: redactText(value.function),
        filename: redactText(value.filename),
        inApp: value.inApp,
        ...(instructionAddress === undefined ? {} : { instructionAddress }),
        ...(imageAddress === undefined ? {} : { imageAddress }),
        ...(imageUuid === undefined ? {} : { imageUuid }),
        ...(symbolAddress === undefined ? {} : { symbolAddress }),
    }
}

const parseEvent = (value: unknown): NativePendingEvent | undefined => {
    if (!isRecord(value)) return undefined

    const { handled, id, level, mechanism, message, platform, stack, timestamp, type, userId } = value
    const validPlatform = typeof platform === 'string' && nativePlatforms.has(platform as NativePlatform)
    const validTimestamp = typeof timestamp === 'string' && Number.isFinite(Date.parse(timestamp))

    if (
        typeof id !== 'string' ||
        !eventIdPattern.test(id) ||
        !validTimestamp ||
        !validPlatform ||
        (level !== 'error' && level !== 'fatal') ||
        typeof type !== 'string' ||
        typeof message !== 'string' ||
        typeof handled !== 'boolean' ||
        typeof mechanism !== 'string'
    ) {
        return undefined
    }

    const contexts = isRecord(value.contexts) ? (sanitizeRecord({ value: value.contexts }) as NativePendingEvent['contexts']) : undefined
    const frames = Array.isArray(value.frames)
        ? value.frames
              .slice(0, 200)
              .map(parseFrame)
              .filter(frame => frame !== undefined)
        : undefined

    return {
        id,
        timestamp: new Date(timestamp).toISOString(),
        platform: platform as NativePlatform,
        level,
        type: redactText(type),
        message: redactText(message),
        handled,
        mechanism: redactText(mechanism),
        ...(typeof stack === 'string' ? { stack: redactStack(stack) } : {}),
        ...(frames === undefined ? {} : { frames }),
        ...(typeof userId === 'string' ? { userId: redactText(userId) } : {}),
        ...(contexts === undefined ? {} : { contexts }),
    }
}

export const parseNativePendingEvents = (value: string): ReadonlyArray<NativePendingEvent> => {
    const parsed = JSON.parse(value) as unknown

    if (!Array.isArray(parsed)) return []
    return parsed
        .slice(0, 100)
        .map(parseEvent)
        .filter(event => event !== undefined)
}
