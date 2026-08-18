export type CrashCaseId =
    | 'android.anr'
    | 'android.jvm-uncaught'
    | 'android.native-abort'
    | 'android.native-cpp'
    | 'android.native-sigsegv'
    | 'ios.hang'
    | 'ios.native-abort'
    | 'ios.native-cpp'
    | 'ios.native-nsexception'
    | 'ios.native-sigsegv'

export interface CrashCaseDefinition {
    readonly id: CrashCaseId
    readonly platform: 'android' | 'ios'
    readonly expectedMechanism: string
    readonly alternateMechanisms?: ReadonlyArray<string>
    readonly expectsFrames: boolean
    readonly delivery: 'immediate-after-restart' | 'os-delayed'
}

export interface CrashFixtureModule {
    readonly prepareCase: (caseId: CrashCaseId) => Promise<boolean>
    readonly getPendingCase: () => Promise<string | null | undefined>
    readonly getRequestedCase: () => Promise<string | null | undefined>
    readonly clearPendingCase: () => Promise<boolean>
    readonly writeResult: (resultJson: string) => Promise<boolean>
    readonly trigger: (caseId: CrashCaseId) => void
}

export interface HarnessResult {
    readonly caseId: CrashCaseId
    readonly message: string
    readonly status: 'failed' | 'passed'
}

export interface NativeQueueModule {
    readonly drainPendingEvents: () => Promise<string>
}

export interface ValidateDeliveredEnvelopeInput {
    readonly body: string
    readonly crashCase: CrashCaseDefinition
    readonly expectedRelease: string
    readonly expectedUserId: string
}

export interface DeliveredCrashResult {
    readonly eventId: string
    readonly mechanism: string
    readonly frameCount: number
}

export interface ValidateAcknowledgementInput {
    readonly eventId: string
    readonly pendingEventsJson: string
}

export interface AwaitAcknowledgementInput {
    readonly eventId: string
    readonly nativeQueue: NativeQueueModule
    readonly maximumAttempts?: number
}

export type HarnessStatus =
    | { readonly kind: 'ready'; readonly message: string }
    | { readonly kind: 'armed'; readonly message: string }
    | { readonly kind: 'waiting'; readonly message: string }
    | { readonly kind: 'passed'; readonly message: string }
    | { readonly kind: 'failed'; readonly message: string }
