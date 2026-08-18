package com.inkronik.reactnative

import android.content.Context
import android.util.AtomicFile
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject

internal class InkronikStore(context: Context) {
  private val applicationContext = context.applicationContext
  private val directory = File(applicationContext.noBackupFilesDir, "inkronik-native-events")
  private val preferences = applicationContext.getSharedPreferences("inkronik-native-state", Context.MODE_PRIVATE)
  private val lock = Any()

  init {
    directory.mkdirs()
  }

  fun configure(configurationJson: String) {
    val input = JSONObject(configurationJson)
    val configuration = NativeStoreConfiguration(
      cacheItemTtlMs = input.optLong("cacheItemTtlMs", 86_400_000).coerceIn(1_000, 604_800_000),
      maxCacheItems = input.optInt("maxCacheItems", 30).coerceIn(0, 100),
      release = input.optStringOrNull("release"),
      dist = input.optStringOrNull("dist"),
      environment = input.optStringOrNull("environment"),
    )

    preferences.edit()
      .putLong("cacheItemTtlMs", configuration.cacheItemTtlMs)
      .putInt("maxCacheItems", configuration.maxCacheItems)
      .putNullableString("release", configuration.release)
      .putNullableString("dist", configuration.dist)
      .putNullableString("environment", configuration.environment)
      .apply()
    AndroidNativeCrashCapture.configure(nativeCrashSnapshot())
    prune()
  }

  fun setUserId(userId: String?) {
    val sanitizedUserId = userId?.let { InkronikSanitizer.text(it, 128) }
    preferences.edit().putNullableString("userId", sanitizedUserId).apply()
    AndroidNativeCrashCapture.configure(nativeCrashSnapshot())
  }

  fun capture(input: NativeEventInput): String {
    if (preferences.getInt("maxCacheItems", 30) == 0) return ""
    val id = UUID.randomUUID().toString().replace("-", "")
    val eventUserId = if (input.metadata == null) preferences.getString("userId", null) else input.metadata.userId
    val event = JSONObject()
      .put("id", id)
      .put("timestamp", formatTimestamp(input.timestampMs))
      .put("timestampMs", input.timestampMs)
      .put("platform", "android")
      .put("level", input.level)
      .put("type", InkronikSanitizer.text(input.type, 256))
      .put("message", InkronikSanitizer.text(input.message))
      .put("handled", input.handled)
      .put("mechanism", InkronikSanitizer.mechanism(input.mechanism))
      .putOptional("stack", InkronikSanitizer.stack(input.stack))
      .putOptional("frames", buildFrames(input.frames))
      .putOptional("userId", eventUserId)
      .put("contexts", buildContexts(input.contexts, input.metadata))

    synchronized(lock) {
      val file = AtomicFile(File(directory, "$id.json"))
      val output = file.startWrite()
      try {
        output.write(event.toString().toByteArray(Charsets.UTF_8))
        file.finishWrite(output)
      } catch (error: Throwable) {
        file.failWrite(output)
        return ""
      }
      pruneLocked()
    }
    return id
  }

  fun drain(): String = synchronized(lock) {
    pruneLocked()
    val events = sortedEventFiles().mapNotNull { file ->
      runCatching { JSONObject(file.readText(Charsets.UTF_8)) }.getOrNull()
    }
    JSONArray(events).toString()
  }

  fun acknowledge(eventIdsJson: String): Boolean = synchronized(lock) {
    val eventIds = JSONArray(eventIdsJson)
    val acceptedIds = (0 until eventIds.length())
      .mapNotNull { index -> eventIds.optString(index).takeIf { id -> id.matches(Regex("[0-9a-f]{32}")) } }
      .toSet()
    directory.listFiles()
      ?.filter { file -> file.name.removeSuffix(".json") in acceptedIds }
      ?.forEach(File::delete)
    true
  }

  fun getLastExitTimestamp(): Long = preferences.getLong("lastExitTimestamp", 0)

  fun hasLastExitTimestamp(): Boolean = preferences.contains("lastExitTimestamp")

  fun setLastExitTimestamp(timestamp: Long) {
    preferences.edit().putLong("lastExitTimestamp", timestamp).apply()
  }

  fun hasJvmEventNear(timestampMs: Long): Boolean = synchronized(lock) {
    sortedEventFiles().any { file ->
      val event = runCatching { JSONObject(file.readText(Charsets.UTF_8)) }.getOrNull() ?: return@any false
      val mechanism = event.optString("mechanism")
      val timestamp = event.optLong("timestampMs", 0)
      mechanism == "android.jvm-uncaught" && kotlin.math.abs(timestamp - timestampMs) <= 10_000
    }
  }

  fun hasImmediateNativeEventNear(timestampMs: Long): Boolean = synchronized(lock) {
    sortedEventFiles().any { file ->
      val event = runCatching { JSONObject(file.readText(Charsets.UTF_8)) }.getOrNull() ?: return@any false
      val mechanism = event.optString("mechanism")
      val eventTimestamp = event.optLong("timestampMs", 0)
      mechanism == "android.native-signal" && kotlin.math.abs(eventTimestamp - timestampMs) <= 10_000
    }
  }

  fun nativeCrashSnapshot(): NativeCrashSnapshot = NativeCrashSnapshot(
    enabled = preferences.getInt("maxCacheItems", 30) > 0,
    userId = preferences.getString("userId", null),
    release = preferences.getString("release", null),
    dist = preferences.getString("dist", null),
    environment = preferences.getString("environment", null),
  )

  private fun buildContexts(contexts: Map<String, Map<String, Any>>, metadata: NativeEventMetadata?): JSONObject {
    val appContext = JSONObject()
      .putOptional("release", metadata?.release ?: if (metadata == null) preferences.getString("release", null) else null)
      .putOptional("dist", metadata?.dist ?: if (metadata == null) preferences.getString("dist", null) else null)
      .putOptional("environment", metadata?.environment ?: if (metadata == null) preferences.getString("environment", null) else null)
    val result = JSONObject().put("app", appContext)
    contexts.forEach { (name, values) -> result.put(name, JSONObject(values)) }
    return result
  }

  private fun buildFrames(frames: List<NativeStackFrame>): JSONArray? {
    if (frames.isEmpty()) return null
    return JSONArray(
      frames.take(200).map { frame ->
        JSONObject()
          .put("function", InkronikSanitizer.text(frame.function, 512))
          .put("filename", InkronikSanitizer.text(frame.filename, 512))
          .put("inApp", frame.inApp)
          .putOptional("instructionAddress", frame.instructionAddress)
          .putOptional("imageAddress", frame.imageAddress)
          .putOptional("imageUuid", frame.imageUuid)
          .putOptional("symbolAddress", frame.symbolAddress)
      }
    )
  }

  private fun prune() = synchronized(lock) { pruneLocked() }

  private fun pruneLocked() {
    val now = System.currentTimeMillis()
    val ttlMs = preferences.getLong("cacheItemTtlMs", 86_400_000)
    val maxItems = preferences.getInt("maxCacheItems", 30)
    val retained = sortedEventFiles().filter { file -> now - file.lastModified() <= ttlMs }
    directory.listFiles()?.filterNot(retained::contains)?.forEach(File::delete)
    retained.dropLast(maxItems).forEach(File::delete)
  }

  private fun sortedEventFiles(): List<File> =
    directory.listFiles()
      ?.filter { file -> file.isFile && file.name.matches(Regex("[0-9a-f]{32}\\.json")) && file.length() <= 200_000 }
      ?.sortedBy(File::lastModified)
      ?: emptyList()
}

private fun JSONObject.optStringOrNull(name: String): String? =
  optString(name).takeIf(String::isNotBlank)?.let { InkronikSanitizer.text(it, 256) }

private fun JSONObject.putOptional(name: String, value: String?): JSONObject =
  if (value == null) this else put(name, value)

private fun JSONObject.putOptional(name: String, value: JSONArray?): JSONObject =
  if (value == null) this else put(name, value)

private fun android.content.SharedPreferences.Editor.putNullableString(
  name: String,
  value: String?,
): android.content.SharedPreferences.Editor = if (value == null) remove(name) else putString(name, value)

private fun formatTimestamp(timestampMs: Long): String =
  SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
    timeZone = TimeZone.getTimeZone("UTC")
  }.format(Date(timestampMs))
