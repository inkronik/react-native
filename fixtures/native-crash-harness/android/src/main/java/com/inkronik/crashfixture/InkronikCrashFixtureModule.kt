package com.inkronik.crashfixture

import android.content.Context
import android.content.Intent
import java.io.File
import org.json.JSONObject
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class InkronikCrashFixtureModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  private val preferences = reactContext.getSharedPreferences(STATE_NAME, Context.MODE_PRIVATE)

  override fun getName(): String = NAME

  @ReactMethod
  fun prepareCase(caseId: String, promise: Promise) {
    if (!BuildConfig.DEBUG) {
      promise.reject("INKRONIK_FIXTURE_DISABLED", "Crash fixtures are disabled outside debug builds")
      return
    }
    resultFile().delete()
    val accepted = caseId in CASE_IDS && preferences.edit().putString(PENDING_CASE_KEY, caseId).commit()
    if (!accepted) {
      promise.reject("INKRONIK_FIXTURE_CASE", "Unknown or unpersisted crash fixture case")
      return
    }
    requestFile().delete()
    promise.resolve(true)
  }

  @ReactMethod
  fun getPendingCase(promise: Promise) {
    promise.resolve(preferences.getString(PENDING_CASE_KEY, null))
  }

  @ReactMethod
  fun getRequestedCase(promise: Promise) {
    val request = requestFile()
    val caseId = request.takeIf(File::isFile)?.readText(Charsets.UTF_8)?.trim()
      ?: reactContext.currentActivity?.intent?.getStringExtra(LAUNCH_CASE_KEY)
    if (caseId == null || caseId in CASE_IDS) {
      promise.resolve(caseId)
      return
    }
    promise.reject("INKRONIK_FIXTURE_CASE", "Unknown requested crash fixture case")
  }

  @ReactMethod
  fun clearPendingCase(promise: Promise) {
    promise.resolve(preferences.edit().remove(PENDING_CASE_KEY).commit())
  }

  @ReactMethod
  fun writeResult(resultJson: String, promise: Promise) {
    if (!BuildConfig.DEBUG) {
      promise.reject("INKRONIK_FIXTURE_DISABLED", "Crash fixtures are disabled outside debug builds")
      return
    }
    runCatching {
      val input = JSONObject(resultJson)
      val caseId = input.getString("caseId")
      val status = input.getString("status")
      require(caseId in CASE_IDS) { "Unknown crash fixture result case" }
      require(status in RESULT_STATUSES) { "Unknown crash fixture result status" }
      val normalized = JSONObject()
        .put("caseId", caseId)
        .put("message", input.optString("message").take(MAX_RESULT_MESSAGE_LENGTH))
        .put("status", status)
      resultFile().writeText(normalized.toString(), Charsets.UTF_8)
      true
    }.fold(promise::resolve) { error -> promise.reject("INKRONIK_FIXTURE_RESULT", error) }
  }

  @ReactMethod
  fun trigger(caseId: String) {
    require(BuildConfig.DEBUG) { "Crash fixtures are disabled outside debug builds" }
    require(caseId in CASE_IDS) { "Unknown crash fixture case" }
    when (caseId) {
      "android.jvm-uncaught" -> Thread(
        { throw IllegalStateException("Inkronik destructive fixture JVM exception") },
        "inkronik-crash-fixture",
      ).start()
      "android.native-sigsegv" -> nativeSegmentationFault()
      "android.native-abort" -> nativeAbort()
      "android.native-cpp" -> nativeCppException()
      "android.anr" -> reactContext.sendBroadcast(
        Intent(reactContext, InkronikAnrReceiver::class.java).addFlags(Intent.FLAG_RECEIVER_FOREGROUND)
      )
    }
  }

  private external fun nativeSegmentationFault()
  private external fun nativeAbort()
  private external fun nativeCppException()

  private fun resultFile(): File = File(reactContext.cacheDir, RESULT_FILE_NAME)

  private fun requestFile(): File = File(reactContext.cacheDir, REQUEST_FILE_NAME)

  companion object {
    const val NAME = "InkronikCrashFixture"
    private const val STATE_NAME = "inkronik-crash-fixture"
    private const val PENDING_CASE_KEY = "pendingCase"
    private const val LAUNCH_CASE_KEY = "inkronik_crash_case"
    private const val RESULT_FILE_NAME = "inkronik-native-crash-harness-result.json"
    private const val REQUEST_FILE_NAME = "inkronik-native-crash-harness-request.txt"
    private const val MAX_RESULT_MESSAGE_LENGTH = 512
    private val RESULT_STATUSES = setOf("failed", "passed")
    private val CASE_IDS = setOf(
      "android.jvm-uncaught",
      "android.native-sigsegv",
      "android.native-abort",
      "android.native-cpp",
      "android.anr",
    )

    init {
      System.loadLibrary("inkronik_crash_fixture")
    }
  }
}
