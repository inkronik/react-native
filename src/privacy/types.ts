export interface SanitizeValueInput {
    readonly value: unknown
    readonly key?: string
    readonly depth?: number
}

export interface SanitizeRecordInput {
    readonly value: Readonly<Record<string, unknown>>
    readonly depth?: number
}

export interface SanitizeUrlInput {
    readonly value: string
}

export interface SafeErrorInput {
    readonly error: unknown
}

export interface SafeErrorChainInput extends SafeErrorInput {
    readonly maxCauses?: number
}

export interface SafeError {
    readonly name: string
    readonly message: string
    readonly stack?: string
}
