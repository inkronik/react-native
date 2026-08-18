export interface ReactNavigationRouteLike {
    readonly name: string
}

export interface CreateReactNavigationInstrumentationInput {
    readonly getCurrentRoute: () => ReactNavigationRouteLike | undefined
}

export interface ReactNavigationInstrumentation {
    readonly onReady: () => void
    readonly onStateChange: () => void
}

export interface CreateReactNavigationAdapterInput extends CreateReactNavigationInstrumentationInput {
    readonly addBreadcrumb: (input: BreadcrumbInput) => void
    readonly setContext: (input: SetContextInput) => void
}
import type { BreadcrumbInput, SetContextInput } from '../types.js'
