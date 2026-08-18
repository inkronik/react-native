package com.inkronik.reactnative

import android.content.Context

object InkronikNative {
  @JvmStatic
  fun captureHandledException(context: Context, error: Throwable, mechanism: String): String =
    InkronikRuntime.initialize(context).capture(
      NativeEventInput(
        level = "error",
        type = error.javaClass.name,
        message = error.message ?: "Handled native exception",
        handled = true,
        mechanism = mechanism,
        stack = error.stackTraceToString(),
        timestampMs = System.currentTimeMillis(),
      )
    )
}
