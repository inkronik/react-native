/* eslint-disable functional/immutable-data -- React Native exposes registration without an unregister API, so the active lifecycle callback must be replaced in place. */
import type {
    EngineCaptureExceptionInput,
    InstallReactNativeExceptionListenerInput,
    ReactNativeExceptionData,
    ReactNativeExceptionListener,
    ReactNativeExceptionListenerState,
    ReactNativeRegisterExceptionListener,
    ReactNativeStackFrame,
} from './types.js'

export const REACT_NATIVE_MECHANISM_EXTRA_KEY = '__inkronik_mechanism'
export const REACT_NATIVE_REJECTION_MECHANISM = 'unhandledrejection'

// React Native retains registered listeners for the lifetime of its runtime and does not expose unregister.
// Keep one bridge listener per React Native runtime and swap only the active SDK lifecycle callback.
const listenerState: ReactNativeExceptionListenerState = {}

const readRecord = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
    typeof value === 'object' && value !== null ? (value as Readonly<Record<string, unknown>>) : undefined

const readString = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined)

const readSafeInteger = (value: unknown): number | undefined => (Number.isSafeInteger(value) ? (value as number) : undefined)

const toStackLine = (value: unknown): string | undefined => {
    const frame = readRecord(value) as ReactNativeStackFrame | undefined
    const filename = readString(frame?.file)

    if (filename === undefined) {
        return undefined
    }

    const methodName = readString(frame?.methodName) ?? '<anonymous>'
    const line = readSafeInteger(frame?.lineNumber)
    const column = readSafeInteger(frame?.column)
    const location = line === undefined ? filename : `${filename}:${line}${column === undefined ? '' : `:${column}`}`

    return `    at ${methodName} (${location})`
}

const toFallbackStack = ({
    data,
    message,
    name,
}: {
    readonly data: ReactNativeExceptionData
    readonly message: string
    readonly name: string
}): string => {
    const frames = Array.isArray(data.stack) ? data.stack.map(toStackLine).filter((line): line is string => line !== undefined) : []
    return [`${name}: ${message}`, ...frames].join('\n')
}

const toReportedError = (data: ReactNativeExceptionData): Error => {
    const name = readString(data.name) ?? 'Error'
    const originalMessage = readString(data.originalMessage)
    const reportedMessage = readString(data.message) ?? 'Unhandled React Native exception'
    const namePrefix = `${name}: `
    const message = originalMessage ?? (reportedMessage.startsWith(namePrefix) ? reportedMessage.slice(namePrefix.length) : reportedMessage)
    const extraData = readRecord(data.extraData)
    const stack = readString(extraData?.rawStack) ?? toFallbackStack({ data, message, name })

    return Object.create(Error.prototype, {
        message: { configurable: true, value: message },
        name: { configurable: true, value: name },
        stack: { configurable: true, value: stack },
    }) as Error
}

const toCaptureInput = (value: unknown): EngineCaptureExceptionInput | undefined => {
    const data = readRecord(value) as ReactNativeExceptionData | undefined

    if (data === undefined) {
        return undefined
    }

    const componentStack = readString(data.componentStack)
    const extraData = readRecord(data.extraData)
    const reportedMechanism = readString(extraData?.[REACT_NATIVE_MECHANISM_EXTRA_KEY])
    const mechanism = reportedMechanism === REACT_NATIVE_REJECTION_MECHANISM ? REACT_NATIVE_REJECTION_MECHANISM : 'react-native.exception-listener'

    return {
        error: toReportedError(data),
        context: {
            level: data.isFatal === true ? 'fatal' : 'error',
            tags: { 'inkronik.handled': 'false', 'inkronik.mechanism': mechanism },
            ...(componentStack === undefined ? {} : { contexts: { react: { component_stack: componentStack } } }),
        },
    }
}

const registeredListener: ReactNativeExceptionListener = value => {
    const captureException = listenerState.activeCaptureException

    if (captureException === undefined) {
        return
    }

    try {
        const input = toCaptureInput(value)
        if (input === undefined) return
        captureException(input)
    } catch {
        // Exception listeners must never interfere with React Native's default fatal-error path.
    }
}

export const installReactNativeExceptionListener = ({ captureException }: InstallReactNativeExceptionListenerInput): (() => void) | undefined => {
    if (Reflect.get(globalThis, 'RN$useAlwaysAvailableJSErrorHandling') !== true) {
        return undefined
    }

    const registerExceptionListener = Reflect.get(globalThis, 'RN$registerExceptionListener')

    if (typeof registerExceptionListener !== 'function') {
        return undefined
    }

    const register = registerExceptionListener as ReactNativeRegisterExceptionListener
    const previousCaptureException = listenerState.activeCaptureException
    listenerState.activeCaptureException = captureException

    if (listenerState.registeredWith !== register) {
        const previousRegister = listenerState.registeredWith
        const listener: ReactNativeExceptionListener = value => {
            if (listenerState.registeredWith === register) registeredListener(value)
        }

        listenerState.registeredWith = register
        try {
            register(listener)
        } catch {
            listenerState.registeredWith = previousRegister
            if (listenerState.activeCaptureException === captureException) listenerState.activeCaptureException = previousCaptureException
            return undefined
        }
    }

    return () => {
        if (listenerState.activeCaptureException === captureException) listenerState.activeCaptureException = undefined
    }
}
