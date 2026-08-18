import { NativeModules } from 'react-native'

import type { NativeCaptureModule } from './types.js'

const nativeInkronik = NativeModules.Inkronik as NativeCaptureModule | undefined

export default nativeInkronik ?? null
