import type { CreateTraceContextInput, TraceContext } from './types.js'

const traceparentPattern = /^00-([0-9a-f]{32})-([0-9a-f]{16})-(0[01])$/u

const toHex = (bytes: Uint8Array): string => Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('')

const isAllZero = (value: string): boolean => /^0+$/u.test(value)

export const parseTraceparent = (value: string): TraceContext | undefined => {
    const match = traceparentPattern.exec(value.trim().toLowerCase())

    if (match === null || isAllZero(match[1]) || isAllZero(match[2])) {
        return undefined
    }

    return { traceId: match[1], spanId: match[2], sampled: match[3] === '01' }
}

const createIdentifier = ({
    length,
    randomBytes,
}: {
    readonly length: number
    readonly randomBytes: CreateTraceContextInput['randomBytes']
}): string | undefined => {
    const bytes = randomBytes(length)

    if (bytes === undefined) {
        return undefined
    }

    const value = toHex(bytes)
    return isAllZero(value) ? undefined : value
}

export const createTraceContext = ({ parentTraceparent, randomBytes }: CreateTraceContextInput): TraceContext | undefined => {
    const parent = parentTraceparent === undefined ? undefined : parseTraceparent(parentTraceparent)
    const traceId = parent?.traceId ?? createIdentifier({ length: 16, randomBytes })
    const spanId = createIdentifier({ length: 8, randomBytes })

    if (traceId === undefined || spanId === undefined) {
        return undefined
    }

    return {
        traceId,
        spanId,
        ...(parent === undefined ? {} : { parentSpanId: parent.spanId }),
        sampled: parent?.sampled ?? true,
    }
}

export const toTraceparent = (context: TraceContext): string => `00-${context.traceId}-${context.spanId}-${context.sampled ? '01' : '00'}`

export const secureRandomBytes = (length: number): Uint8Array | undefined => {
    const cryptoValue = Reflect.get(globalThis, 'crypto') as Partial<Crypto> | undefined
    const getRandomValues = cryptoValue?.getRandomValues

    if (getRandomValues === undefined) {
        return undefined
    }

    return (getRandomValues.call(cryptoValue, new Uint8Array(length)) as Uint8Array | null) ?? undefined
}
