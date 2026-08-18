package com.inkronik.reactnative

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class InkronikModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  private val store: InkronikStore
    get() = InkronikRuntime.initialize(reactContext)

  override fun getName(): String = NAME

  @ReactMethod
  fun configure(configurationJson: String) = store.configure(configurationJson)

  @ReactMethod
  fun drainPendingEvents(promise: Promise) {
    runCatching(store::drain).fold(promise::resolve) { error -> promise.reject("INKRONIK_NATIVE_DRAIN", error) }
  }

  @ReactMethod
  fun acknowledgeEvents(eventIdsJson: String, promise: Promise) {
    runCatching { store.acknowledge(eventIdsJson) }.fold(promise::resolve) { error -> promise.reject("INKRONIK_NATIVE_ACK", error) }
  }

  @ReactMethod
  fun setUserId(userId: String?) = store.setUserId(userId)

  companion object {
    const val NAME = "Inkronik"
  }
}
