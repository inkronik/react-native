import type { NativeCaptureModule } from './types.js'

// Native registration is process lifecycle state installed by the React Native entrypoint.
// eslint-disable-next-line functional/no-let
let registeredModule: NativeCaptureModule | undefined

export const registerNativeCaptureModule = (module: NativeCaptureModule | null): void => {
    registeredModule = module ?? undefined
}

export const getNativeCaptureModule = (): NativeCaptureModule | undefined => registeredModule
