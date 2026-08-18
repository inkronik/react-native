import { createInkronikEngine } from '../engine/inkronik-engine.js'
import type {
    BreadcrumbInput,
    CaptureExceptionInput,
    CaptureMessageInput,
    FlushInput,
    InkronikOptions,
    SetContextInput,
    SetTagInput,
    User,
} from '../types.js'
import { InkronikClient } from './client.js'

// The default SDK instance is application-lifecycle state managed by init/shutdown.
// eslint-disable-next-line functional/no-let
let defaultClient: InkronikClient | undefined

const getClient = (): InkronikClient | undefined => defaultClient

export const init = (options: InkronikOptions): InkronikClient => {
    if (defaultClient !== undefined) {
        throw new Error('Inkronik React Native SDK is already initialized. Call shutdown before initializing it again.')
    }

    const client = new InkronikClient({ engine: createInkronikEngine(), options })

    // The default SDK instance is application-lifecycle state.
    defaultClient = client
    return client
}

export const isInitialized = (): boolean => defaultClient !== undefined

export const captureException = (input: CaptureExceptionInput): string => getClient()?.captureException(input) ?? ''
export const captureMessage = (input: CaptureMessageInput): string => getClient()?.captureMessage(input) ?? ''
export const setUser = (user: User): void => getClient()?.setUser(user)
export const clearUser = (): void => getClient()?.clearUser()
export const setTag = (input: SetTagInput): void => getClient()?.setTag(input)
export const setContext = (input: SetContextInput): void => getClient()?.setContext(input)
export const addBreadcrumb = (input: BreadcrumbInput): void => getClient()?.addBreadcrumb(input)
export const flush = (input: FlushInput): Promise<boolean> => getClient()?.flush(input) ?? Promise.resolve(true)

export const shutdown = async (input: FlushInput): Promise<boolean> => {
    const client = getClient()

    if (client === undefined) {
        return true
    }

    const result = await client.shutdown(input)
    defaultClient = undefined
    return result
}
