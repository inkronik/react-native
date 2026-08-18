import type { SafeError, SafeErrorChainInput, SafeErrorInput, SanitizeRecordInput, SanitizeUrlInput, SanitizeValueInput } from './types.js'

const REDACTED = '[REDACTED]'
const MAX_DEPTH = 4
const MAX_ENTRIES = 50
const MAX_STRING_LENGTH = 1024
const MAX_STACK_LENGTH = 16384
const MAX_KEY_LENGTH = 128
const sensitiveKeyPattern =
    /(?:authorization|cookie|pass(?:word|code)?|pin|secret|token|private.?key|api.?key|client.?secret|setup.?token|card.?number|credit.?card|cvv|cvc|track.?data|merchant.?private)/iu
const bearerPattern = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/giu
const jwtPattern = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu
const sensitiveAssignmentPattern =
    /\b(authorization|password|passcode|secret|token|access_?token|refresh_?token|setup_?token|api_?key|private_?key|cvv|cvc|pin)\b\s*[:=]\s*([^\s,;}&]+)/giu
const absoluteUrlPattern = /https?:\/\/[^\s)]+/giu
const stackLocationSuffixPattern = /:\d+:\d+$/u

const truncate = (value: string, maxLength: number): string => (value.length <= maxLength ? value : `${value.slice(0, maxLength)}…`)

export const sanitizeKey = (value: string): string => truncate(value.replace(/[^A-Za-z0-9_.-]/gu, '_'), MAX_KEY_LENGTH)

const redactWithLimit = ({ maxLength, value }: { readonly maxLength: number; readonly value: string }): string =>
    truncate(
        value
            .replace(absoluteUrlPattern, url => {
                const suffix = stackLocationSuffixPattern.exec(url)?.[0] ?? ''
                const urlWithoutLocation = suffix === '' ? url : url.slice(0, -suffix.length)
                return `${sanitizeUrl({ value: urlWithoutLocation })}${suffix}`
            })
            .replace(bearerPattern, `Bearer ${REDACTED}`)
            .replace(jwtPattern, REDACTED)
            .replace(sensitiveAssignmentPattern, (_match, key: string) => `${key}=${REDACTED}`),
        maxLength,
    )

export const redactText = (value: string): string => redactWithLimit({ maxLength: MAX_STRING_LENGTH, value })
export const redactStack = (value: string): string => redactWithLimit({ maxLength: MAX_STACK_LENGTH, value })

export const sanitizeUrl = ({ value }: SanitizeUrlInput): string => {
    const parsed = (() => {
        try {
            return new URL(value)
        } catch {
            return undefined
        }
    })()

    if (parsed === undefined) {
        return redactText(value.split(/[?#]/u, 1)[0] ?? '')
    }

    const path = parsed.pathname
        .split('/')
        .map(segment => {
            if (/^[0-9]{4,}$/u.test(segment) || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/iu.test(segment)) {
                return ':id'
            }

            return truncate(segment, 128)
        })
        .join('/')

    return `${parsed.origin}${path}`
}

const sanitizeObjectEntries = ({ depth, value }: Required<SanitizeRecordInput>): Readonly<Record<string, unknown>> => {
    const entries = (() => {
        try {
            return Object.entries(value).slice(0, MAX_ENTRIES)
        } catch {
            return []
        }
    })()

    return Object.fromEntries(
        entries.map(([rawKey, item]) => {
            const key = sanitizeKey(rawKey)

            return [key, sensitiveKeyPattern.test(key) ? REDACTED : sanitizeValue({ depth: depth + 1, key, value: item })]
        }),
    )
}

export const sanitizeValue = ({ depth = 0, key = '', value }: SanitizeValueInput): unknown => {
    if (sensitiveKeyPattern.test(key)) {
        return REDACTED
    }

    if (value === null || typeof value === 'boolean') {
        return value
    }

    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : String(value)
    }

    if (typeof value === 'string') {
        return /url|uri|href/iu.test(key) ? sanitizeUrl({ value }) : redactText(value)
    }

    if (typeof value === 'bigint' || typeof value === 'symbol' || typeof value === 'function' || typeof value === 'undefined') {
        return String(value)
    }

    if (depth >= MAX_DEPTH) {
        return '[Truncated]'
    }

    if (Array.isArray(value)) {
        return value.slice(0, MAX_ENTRIES).map(item => sanitizeValue({ depth: depth + 1, key, value: item }))
    }

    return sanitizeObjectEntries({ depth, value: value as Readonly<Record<string, unknown>> })
}

export const sanitizeRecord = ({ depth = 0, value }: SanitizeRecordInput): Readonly<Record<string, unknown>> =>
    sanitizeObjectEntries({ depth, value })

const isError = (value: unknown): value is Error => {
    try {
        return value instanceof Error || Object.prototype.toString.call(value) === '[object Error]'
    } catch {
        return false
    }
}

const readProperty = ({ key, value }: { readonly key: string; readonly value: object }): unknown => {
    try {
        return Reflect.get(value, key)
    } catch {
        return undefined
    }
}

export const toSafeError = ({ error }: SafeErrorInput): SafeError => {
    if (isError(error)) {
        const rawName = readProperty({ key: 'name', value: error })
        const rawMessage = readProperty({ key: 'message', value: error })
        const rawStack = readProperty({ key: 'stack', value: error })
        const name = typeof rawName === 'string' && rawName !== '' ? rawName : 'Error'
        const message = typeof rawMessage === 'string' ? rawMessage : ''

        return {
            name: redactText(name),
            message: redactText(message),
            ...(typeof rawStack === 'string' ? { stack: redactStack(rawStack) } : {}),
        }
    }

    return { name: 'NonErrorThrown', message: redactText(String(sanitizeValue({ value: error }))) }
}

const buildSafeErrorChain = ({
    error,
    remaining,
    seen,
}: {
    readonly error: unknown
    readonly remaining: number
    readonly seen: ReadonlyArray<object>
}): ReadonlyArray<SafeError> => {
    const safeError = toSafeError({ error })

    if (remaining <= 1 || !isError(error)) {
        return [safeError]
    }

    const cause = readProperty({ key: 'cause', value: error })
    if (cause === undefined || (typeof cause === 'object' && cause !== null && seen.includes(cause))) {
        return [safeError]
    }

    const nextSeen = typeof cause === 'object' && cause !== null ? [...seen, cause] : seen
    return [safeError, ...buildSafeErrorChain({ error: cause, remaining: remaining - 1, seen: nextSeen })]
}

export const toSafeErrorChain = ({ error, maxCauses = 5 }: SafeErrorChainInput): ReadonlyArray<SafeError> => {
    const initialSeen = typeof error === 'object' && error !== null ? [error] : []
    return buildSafeErrorChain({ error, remaining: Math.max(1, Math.min(maxCauses, 5)), seen: initialSeen })
}

export const isSensitiveKey = (value: string): boolean => sensitiveKeyPattern.test(value)
