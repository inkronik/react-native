import type { BreadcrumbInput, EventLevel, TraceIdentifiers, User } from '../types.js'

export interface MobileStackFrame {
    readonly function: string
    readonly filename: string
    readonly in_app: boolean
    readonly line?: number
    readonly column?: number
    readonly instruction_addr?: string
    readonly image_addr?: string
    readonly image_uuid?: string
    readonly symbol_addr?: string
}

export interface MobileException {
    readonly type: string
    readonly value: string
    readonly handled: boolean
    readonly mechanism: string
    readonly raw_stack?: string
    readonly frames: ReadonlyArray<MobileStackFrame>
}

export interface MobileEvent {
    readonly schema_version: 1
    readonly event_id: string
    readonly project_id: string
    readonly timestamp: string
    readonly platform: 'javascript' | 'android' | 'ios'
    readonly runtime: 'react-native'
    readonly kind: 'error' | 'message' | 'span'
    readonly level: EventLevel
    readonly message: string
    readonly exceptions?: ReadonlyArray<MobileException>
    readonly span?: {
        readonly name: string
        readonly started_at: string
        readonly ended_at: string
        readonly duration_ms: number
        readonly status: 'ok' | 'error'
        readonly trace: TraceIdentifiers
        readonly attributes: Readonly<Record<string, unknown>>
    }
    readonly user?: User
    readonly tags: Readonly<Record<string, string>>
    readonly contexts: Readonly<Record<string, Readonly<Record<string, unknown>>>>
    readonly breadcrumbs: ReadonlyArray<BreadcrumbInput>
    readonly fingerprint: ReadonlyArray<string>
}

export interface MobileEnvelope {
    readonly schema_version: 1
    readonly sent_at: string
    readonly events: ReadonlyArray<MobileEvent>
}
