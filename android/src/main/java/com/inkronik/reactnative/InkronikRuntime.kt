package com.inkronik.reactnative

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.Context
import android.os.Build
import android.os.Process
import java.io.ByteArrayOutputStream
import java.io.InputStream
import kotlin.system.exitProcess

internal object InkronikRuntime {
  private const val MAX_TRACE_BYTES = 100_000
  private val lock = Any()

  @Volatile
  private var storeValue: InkronikStore? = null

  fun initialize(context: Context): InkronikStore {
    storeValue?.let { return it }

    return synchronized(lock) {
      storeValue ?: InkronikStore(context).also { store ->
        storeValue = store
        AndroidNativeCrashCapture.initialize(context.applicationContext, store)
        installJvmHandler(store)
        captureHistoricalExits(context.applicationContext, store)
      }
    }
  }

  private fun installJvmHandler(store: InkronikStore) {
    val previous = Thread.getDefaultUncaughtExceptionHandler()
    Thread.setDefaultUncaughtExceptionHandler { thread, error ->
      runCatching {
        store.capture(
          NativeEventInput(
            level = "fatal",
            type = error.javaClass.name,
            message = error.message ?: "Unhandled JVM exception",
            handled = false,
            mechanism = "android.jvm-uncaught",
            stack = error.stackTraceToString(),
            timestampMs = System.currentTimeMillis(),
            contexts = mapOf("thread" to mapOf("name" to InkronikSanitizer.text(thread.name, 128))),
          )
        )
      }
      if (previous != null) {
        previous.uncaughtException(thread, error)
      } else {
        Process.killProcess(Process.myPid())
        exitProcess(10)
      }
    }
  }

  private fun captureHistoricalExits(context: Context, store: InkronikStore) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return
    val activityManager = context.getSystemService(ActivityManager::class.java) ?: return
    if (!store.hasLastExitTimestamp()) {
      store.setLastExitTimestamp(System.currentTimeMillis())
      return
    }
    val lastTimestamp = store.getLastExitTimestamp()
    val exits = activityManager
      .getHistoricalProcessExitReasons(null, 0, 20)
      .filter { exit -> exit.timestamp > lastTimestamp && isCapturedReason(exit.reason) }
      .sortedBy(ApplicationExitInfo::getTimestamp)

    exits.forEach { exit ->
      val isDuplicateJvmExit = exit.reason == ApplicationExitInfo.REASON_CRASH && store.hasJvmEventNear(exit.timestamp)
      if (!isDuplicateJvmExit) captureExit(store, exit)
      store.setLastExitTimestamp(exit.timestamp)
    }
  }

  private fun captureExit(store: InkronikStore, exit: ApplicationExitInfo) {
    val reason = reasonName(exit.reason)
    val traceInput = runCatching { exit.traceInputStream }.getOrNull()
    val isNativeCrash = exit.reason == ApplicationExitInfo.REASON_CRASH_NATIVE
    if (isNativeCrash && store.hasImmediateNativeEventNear(exit.timestamp)) return
    val tombstone = if (isNativeCrash && Build.VERSION.SDK_INT >= 31) AndroidTombstoneParser.parse(traceInput) else null
    val trace = if (exit.reason == ApplicationExitInfo.REASON_ANR) readBounded(traceInput) else null
    val exitContext = mapOf(
      "reason" to reason,
      "status" to exit.status,
      "importance" to exit.importance,
      "process" to InkronikSanitizer.text(exit.processName ?: "", 256),
      "trace_available" to (traceInput != null),
    )
    val contexts = mapOf("android_exit" to exitContext) + tombstoneContext(tombstone)
    store.capture(
      NativeEventInput(
        level = "fatal",
        type = tombstone?.signal?.name ?: reason,
        message = exit.description ?: reason,
        handled = false,
        mechanism = if (tombstone == null) "android.application-exit" else "android.native-tombstone",
        stack = trace,
        timestampMs = exit.timestamp,
        frames = tombstone?.frames ?: emptyList(),
        contexts = contexts,
      )
    )
  }

  private fun tombstoneContext(tombstone: AndroidTombstone?): Map<String, Map<String, Any>> {
    val signal = tombstone?.signal ?: return emptyMap()
    val values = listOfNotNull(
      signal.number?.let { "number" to it },
      signal.name?.let { "name" to InkronikSanitizer.text(it, 64) },
      signal.code?.let { "code" to it },
      signal.codeName?.let { "code_name" to InkronikSanitizer.text(it, 64) },
      signal.faultAddress?.let { "fault_address" to "0x${it.toULong().toString(16)}" },
    ).toMap()
    return mapOf("android_tombstone" to values)
  }

  private fun isCapturedReason(reason: Int): Boolean =
    reason == ApplicationExitInfo.REASON_CRASH ||
      reason == ApplicationExitInfo.REASON_CRASH_NATIVE ||
      reason == ApplicationExitInfo.REASON_ANR

  private fun reasonName(reason: Int): String = when (reason) {
    ApplicationExitInfo.REASON_CRASH -> "JvmCrash"
    ApplicationExitInfo.REASON_CRASH_NATIVE -> "NativeCrash"
    ApplicationExitInfo.REASON_ANR -> "ApplicationNotResponding"
    else -> "AbnormalExit"
  }

  private fun readBounded(input: InputStream?): String? {
    if (input == null) return null
    return input.use { stream ->
      val output = ByteArrayOutputStream()
      val buffer = ByteArray(8_192)
      while (output.size() < MAX_TRACE_BYTES) {
        val count = stream.read(buffer, 0, minOf(buffer.size, MAX_TRACE_BYTES - output.size()))
        if (count < 0) break
        if (count == 0) break
        if (count > 0) output.write(buffer, 0, count)
      }
      output.toByteArray().takeIf(ByteArray::isNotEmpty)?.let { bytes -> InkronikSanitizer.stack(String(bytes, Charsets.UTF_8)) }
    }
  }
}
