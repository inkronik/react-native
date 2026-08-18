import NativeInkronik from './native/NativeInkronik.js'
import { registerNativeCaptureModule } from './native/registry.js'

registerNativeCaptureModule(NativeInkronik)

export * from './index.js'
