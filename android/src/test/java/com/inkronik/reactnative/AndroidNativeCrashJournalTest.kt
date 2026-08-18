package com.inkronik.reactnative

import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.zip.CRC32
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidNativeCrashJournalTest {
  @Test
  fun parsesOnlyTheMinimizedSignalFramesAndCrashTimeIdentity() {
    val journal = validJournal()

    val event = AndroidNativeCrashJournal.parse(journal)

    assertEquals("android.native-signal", event.mechanism)
    assertEquals("SIGSEGV", event.type)
    assertEquals(1_765_000_000_123, event.timestampMs)
    assertEquals("opaque-user", event.metadata?.userId)
    assertEquals("app@1.2.3+42", event.metadata?.release)
    assertEquals(1, event.frames.size)
    assertEquals("libcheckout.so", event.frames.first().filename)
    assertEquals("0x70120", event.frames.first().instructionAddress)
    assertEquals("0x70000", event.frames.first().imageAddress)
    assertEquals("abcdef0123456789abcdef0123456789", event.frames.first().imageUuid)
    assertTrue(event.frames.first().inApp)
    assertFalse(event.frames.first().filename.contains("private.package"))
    assertNull(event.stack)
  }

  @Test
  fun rejectsTamperingAndUnterminatedStrings() {
    val tampered = validJournal().also { bytes -> bytes[bytes.lastIndex] = 1 }
    assertTrue(runCatching { AndroidNativeCrashJournal.parse(tampered) }.isFailure)

    val unterminated = validJournal().also { bytes ->
      val userOffset = 48
      repeat(513) { index -> bytes[userOffset + index] = 'x'.code.toByte() }
      updateChecksum(bytes)
    }
    assertTrue(runCatching { AndroidNativeCrashJournal.parse(unterminated) }.isFailure)
  }

  @Test
  fun rejectsInvalidUtf8AndHiddenDataAfterDeclaredFrames() {
    val invalidUtf8 = validJournal().also { bytes ->
      bytes[48] = 0xc3.toByte()
      bytes[49] = 0
      updateChecksum(bytes)
    }
    assertTrue(runCatching { AndroidNativeCrashJournal.parse(invalidUtf8) }.isFailure)

    val hiddenFrameData = validJournal().also { bytes ->
      val firstFrameOffset = 48 + 513 + (1_025 * 3)
      bytes[firstFrameOffset + 219] = 1
      updateChecksum(bytes)
    }
    assertTrue(runCatching { AndroidNativeCrashJournal.parse(hiddenFrameData) }.isFailure)
  }

  private fun validJournal(): ByteArray {
    val bytes = ByteArray(17_652)
    val buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
    buffer.put(byteArrayOf('I'.code.toByte(), 'N'.code.toByte(), 'K'.code.toByte(), 'N'.code.toByte(), 'C'.code.toByte(), 'R'.code.toByte(), '1'.code.toByte(), 0))
    buffer.putInt(1)
    buffer.putInt(bytes.size)
    buffer.putInt(0)
    buffer.putInt(11)
    buffer.putInt(1)
    buffer.putLong(0x70120)
    buffer.putLong(1_765_000_000_123)
    buffer.putInt(1)
    putString(buffer, "opaque-user", 513)
    putString(buffer, "app@1.2.3+42", 1_025)
    putString(buffer, "42", 1_025)
    putString(buffer, "production", 1_025)
    buffer.putLong(0x70120)
    buffer.putLong(0x70000)
    buffer.putLong(0x120)
    buffer.put(1)
    putString(buffer, "abcdef0123456789abcdef0123456789", 65)
    putString(buffer, "libcheckout.so", 129)
    repeat(63) {
      buffer.put(ByteArray(219))
    }
    assertEquals(bytes.size, buffer.position())
    updateChecksum(bytes)
    return bytes
  }

  private fun putString(buffer: ByteBuffer, value: String, byteCount: Int) {
    val bytes = value.toByteArray(Charsets.UTF_8)
    require(bytes.size < byteCount)
    buffer.put(bytes)
    buffer.put(ByteArray(byteCount - bytes.size))
  }

  private fun updateChecksum(bytes: ByteArray) {
    val checksum = CRC32().apply { update(bytes, 20, bytes.size - 20) }.value.toInt()
    ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).putInt(16, checksum)
  }
}
