package com.inkronik.reactnative

internal data class NativeEventInput(
  val level: String,
  val type: String,
  val message: String,
  val handled: Boolean,
  val mechanism: String,
  val stack: String?,
  val timestampMs: Long,
  val frames: List<NativeStackFrame> = emptyList(),
  val contexts: Map<String, Map<String, Any>> = emptyMap(),
  val metadata: NativeEventMetadata? = null,
)

internal data class NativeEventMetadata(
  val userId: String?,
  val release: String?,
  val dist: String?,
  val environment: String?,
)

internal data class NativeStackFrame(
  val function: String,
  val filename: String,
  val inApp: Boolean,
  val instructionAddress: String? = null,
  val imageAddress: String? = null,
  val imageUuid: String? = null,
  val symbolAddress: String? = null,
)

internal data class AndroidTombstone(
  val signal: AndroidTombstoneSignal?,
  val frames: List<NativeStackFrame>,
)

internal data class AndroidTombstoneSignal(
  val number: Long?,
  val name: String?,
  val code: Long?,
  val codeName: String?,
  val faultAddress: Long?,
)

internal data class NativeStoreConfiguration(
  val cacheItemTtlMs: Long = 86_400_000,
  val maxCacheItems: Int = 30,
  val release: String? = null,
  val dist: String? = null,
  val environment: String? = null,
)

internal data class NativeCrashSnapshot(
  val enabled: Boolean,
  val userId: String?,
  val release: String?,
  val dist: String?,
  val environment: String?,
)
