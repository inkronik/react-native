package com.inkronik.crashfixture

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class InkronikCrashFixturePackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    if (name == InkronikCrashFixtureModule.NAME) InkronikCrashFixtureModule(reactContext) else null

  override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
    mapOf(
      InkronikCrashFixtureModule.NAME to ReactModuleInfo(
        name = InkronikCrashFixtureModule.NAME,
        className = InkronikCrashFixtureModule.NAME,
        canOverrideExistingModule = false,
        needsEagerInit = false,
        isCxxModule = false,
        isTurboModule = false,
      )
    )
  }
}
