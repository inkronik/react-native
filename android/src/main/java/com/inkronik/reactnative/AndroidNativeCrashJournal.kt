package com.inkronik.reactnative

import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.charset.CodingErrorAction
import java.util.zip.CRC32

internal object AndroidNativeCrashJournal {
  private const val VERSION = 1
  private const val BODY_OFFSET = 20
  private const val MAX_FRAMES = 64
  private const val USER_BYTES = 513
  private const val RELEASE_BYTES = 1_025
  private const val DIST_BYTES = 1_025
  private const val ENVIRONMENT_BYTES = 1_025
  private const val BUILD_ID_BYTES = 65
  private const val FILENAME_BYTES = 129
  private const val FRAME_BYTES = (Long.SIZE_BYTES * 3) + 1 + BUILD_ID_BYTES + FILENAME_BYTES
  private const val EXPECTED_BYTES = BODY_OFFSET + (Int.SIZE_BYTES * 3) + (Long.SIZE_BYTES * 2) +
    USER_BYTES + RELEASE_BYTES + DIST_BYTES + ENVIRONMENT_BYTES + (MAX_FRAMES * FRAME_BYTES)
  private val magic = byteArrayOf('I'.code.toByte(), 'N'.code.toByte(), 'K'.code.toByte(), 'N'.code.toByte(), 'C'.code.toByte(), 'R'.code.toByte(), '1'.code.toByte(), 0)
  private val capturedSignals = setOf(4, 5, 6, 7, 8, 11)

  fun parse(bytes: ByteArray): NativeEventInput {
    require(bytes.size == EXPECTED_BYTES) { "Unexpected native crash journal size" }
    val buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
    val journalMagic = ByteArray(magic.size).also(buffer::get)
    require(journalMagic.contentEquals(magic)) { "Invalid native crash journal magic" }
    require(buffer.int == VERSION) { "Unsupported native crash journal version" }
    require(buffer.int == EXPECTED_BYTES) { "Invalid native crash journal length" }
    val expectedChecksum = buffer.int.toUInt().toLong()
    val actualChecksum = CRC32().apply { update(bytes, BODY_OFFSET, bytes.size - BODY_OFFSET) }.value
    require(expectedChecksum == actualChecksum) { "Invalid native crash journal checksum" }

    val signal = buffer.int
    val signalCode = buffer.int
    val faultAddress = buffer.long
    val timestampMs = buffer.long
    val frameCount = buffer.int
    require(signal in capturedSignals && timestampMs > 0 && frameCount in 1..MAX_FRAMES) { "Invalid native crash journal metadata" }

    val metadata = NativeEventMetadata(
      userId = readString(buffer, USER_BYTES, 128),
      release = readString(buffer, RELEASE_BYTES, 256),
      dist = readString(buffer, DIST_BYTES, 256),
      environment = readString(buffer, ENVIRONMENT_BYTES, 256),
    )
    val frames = (0 until MAX_FRAMES).mapNotNull { index ->
      val instructionAddress = buffer.long
      val imageAddress = buffer.long
      val relativePc = buffer.long
      val inAppValue = buffer.get().toInt()
      val buildId = readString(buffer, BUILD_ID_BYTES, 64)
      val filename = readString(buffer, FILENAME_BYTES, 128)
      if (index >= frameCount) {
        require(instructionAddress == 0L && imageAddress == 0L && relativePc == 0L && inAppValue == 0 && buildId == null && filename == null) {
          "Unexpected data after native crash frames"
        }
        return@mapNotNull null
      }
      require(instructionAddress != 0L && inAppValue in 0..1 && !filename.isNullOrBlank() && '/' !in filename) {
        "Invalid native crash frame"
      }
      require(buildId == null || buildId.matches(Regex("[0-9a-f]{8,64}"))) { "Invalid native crash build ID" }
      NativeStackFrame(
        function = "<unknown>",
        filename = filename,
        inApp = inAppValue == 1,
        instructionAddress = instructionAddress.toHexAddress(),
        imageAddress = imageAddress.takeIf { value -> value != 0L }?.toHexAddress(),
        imageUuid = buildId,
        symbolAddress = null,
      )
    }
    require(!buffer.hasRemaining() && frames.isNotEmpty()) { "Invalid native crash journal frames" }

    val signalName = signalName(signal)
    val signalContext = mapOf(
      "number" to signal,
      "code" to signalCode,
      "fault_address" to faultAddress.toHexAddress(),
    )
    return NativeEventInput(
      level = "fatal",
      type = signalName,
      message = "Native process crash ($signalName)",
      handled = false,
      mechanism = "android.native-signal",
      stack = null,
      timestampMs = timestampMs,
      frames = frames,
      contexts = mapOf("android_native_signal" to signalContext),
      metadata = metadata,
    )
  }

  private fun readString(buffer: ByteBuffer, byteCount: Int, maximumLength: Int): String? {
    val bytes = ByteArray(byteCount).also(buffer::get)
    val end = bytes.indexOf(0.toByte())
    require(end >= 0) { "Unterminated native crash journal string" }
    if (end == 0) return null
    require(bytes.copyOfRange(end, bytes.size).all { byte -> byte == 0.toByte() }) { "Unterminated native crash journal string" }
    val value = Charsets.UTF_8.newDecoder()
      .onMalformedInput(CodingErrorAction.REPORT)
      .onUnmappableCharacter(CodingErrorAction.REPORT)
      .decode(ByteBuffer.wrap(bytes, 0, end))
      .toString()
    return InkronikSanitizer.text(value, maximumLength).takeIf(String::isNotBlank)
  }

  private fun signalName(signal: Int): String = when (signal) {
    4 -> "SIGILL"
    5 -> "SIGTRAP"
    6 -> "SIGABRT"
    7 -> "SIGBUS"
    8 -> "SIGFPE"
    11 -> "SIGSEGV"
    else -> "NativeCrash"
  }

  private fun Long.toHexAddress(): String = "0x${toULong().toString(16)}"
}
