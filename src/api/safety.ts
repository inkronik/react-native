import { toSafeError } from '../privacy/sanitize.js'
import type { ReportInternalErrorInput, RunSafelyInput } from './types.js'

export const reportInternalError = ({ error, onError }: ReportInternalErrorInput): void => {
    if (onError === undefined) {
        return
    }

    try {
        onError(Object.assign(new Error(toSafeError({ error }).message), { name: 'InkronikSdkError' }))
    } catch {
        // SDK diagnostics must never escape into the host application.
    }
}

export const runSafely = <TResult>({ callback, fallback, onError }: RunSafelyInput<TResult>): TResult => {
    try {
        return callback()
    } catch (error) {
        reportInternalError({ error, onError })
        return fallback
    }
}
