export type NativePlatform = 'android' | 'ios'

export interface NativeStackFrame {
    readonly function: string
    readonly filename: string
    readonly inApp: boolean
    readonly instructionAddress?: string
    readonly imageAddress?: string
    readonly imageUuid?: string
    readonly symbolAddress?: string
}

export interface NativePendingEvent {
    readonly id: string
    readonly timestamp: string
    readonly platform: NativePlatform
    readonly level: 'error' | 'fatal'
    readonly type: string
    readonly message: string
    readonly handled: boolean
    readonly mechanism: string
    readonly stack?: string
    readonly frames?: ReadonlyArray<NativeStackFrame>
    readonly userId?: string
    readonly contexts?: Readonly<Record<string, Readonly<Record<string, unknown>>>>
}

export interface NativeCaptureModule {
    readonly configure: (configurationJson: string) => void
    readonly drainPendingEvents: () => Promise<string>
    readonly acknowledgeEvents: (eventIdsJson: string) => Promise<boolean>
    readonly setUserId: (userId: string | null) => void
}

export interface NativeConfiguration {
    readonly cacheItemTtlMs: number
    readonly maxCacheItems: number
    readonly release?: string
    readonly dist?: string
    readonly environment?: string
}

export interface NativeCaptureRegistration {
    readonly module: NativeCaptureModule
}
