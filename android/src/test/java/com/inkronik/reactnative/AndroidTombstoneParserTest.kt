package com.inkronik.reactnative

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidTombstoneParserTest {
  @Test
  fun parsesOnlyTheCrashedThreadAndMinimizesImagePaths() {
    val signal = message(
      varint(1, 11),
      string(2, "SIGSEGV"),
      varint(3, 1),
      string(4, "SEGV_MAPERR"),
      varint(9, 0x70120),
    )
    val applicationFrame = message(
      varint(1, 0x120),
      varint(2, 0x70120),
      string(4, "checkout::crash"),
      varint(5, 0x20),
      string(6, "/data/app/private.package/lib/arm64/libcheckout.so"),
      string(8, "abcdef0123456789abcdef0123456789"),
    )
    val systemFrame = message(
      varint(1, 0x50),
      varint(2, 0x90050),
      string(4, "abort"),
      string(6, "/apex/com.android.runtime/lib64/bionic/libc.so"),
    )
    val crashedThread = message(field(4, applicationFrame), field(4, systemFrame))
    val otherThread = message(field(4, message(string(4, "not_the_crashed_thread"))))
    val tombstone = message(
      varint(6, 42),
      field(10, signal),
      field(16, threadEntry(7, otherThread)),
      field(16, threadEntry(42, crashedThread)),
    )

    val result = AndroidTombstoneParser.parse(ByteArrayInputStream(tombstone))

    assertEquals("SIGSEGV", result?.signal?.name)
    assertEquals(11L, result?.signal?.number)
    assertEquals(2, result?.frames?.size)
    val frame = result!!.frames.first()
    assertEquals("checkout::crash", frame.function)
    assertEquals("libcheckout.so", frame.filename)
    assertFalse(frame.filename.contains("private.package"))
    assertTrue(frame.inApp)
    assertEquals("0x70120", frame.instructionAddress)
    assertEquals("0x70000", frame.imageAddress)
    assertEquals("0x70100", frame.symbolAddress)
    assertEquals("abcdef0123456789abcdef0123456789", frame.imageUuid)
    assertFalse(result.frames.last().inApp)
  }

  @Test
  fun rejectsMalformedLengthDelimitedFields() {
    val malformed = byteArrayOf((16 shl 3 or 2).toByte(), 100, 1)
    assertNull(AndroidTombstoneParser.parse(ByteArrayInputStream(malformed)))
  }

  @Test
  fun containsInputFailuresAndRejectsOversizedReports() {
    val failingInput = object : InputStream() {
      override fun read(): Int = throw IOException("fixture failure")
    }

    assertNull(AndroidTombstoneParser.parse(failingInput))
    assertNull(AndroidTombstoneParser.parse(ByteArrayInputStream(ByteArray(4 * 1024 * 1024 + 1))))
  }

  private fun threadEntry(id: Long, thread: ByteArray): ByteArray = message(varint(1, id), field(2, thread))

  private fun string(fieldNumber: Int, value: String): ByteArray = field(fieldNumber, value.toByteArray(Charsets.UTF_8))

  private fun field(fieldNumber: Int, value: ByteArray): ByteArray = message(varintValue((fieldNumber shl 3 or 2).toLong()), varintValue(value.size.toLong()), value)

  private fun varint(fieldNumber: Int, value: Long): ByteArray = message(varintValue((fieldNumber shl 3).toLong()), varintValue(value))

  private fun varintValue(value: Long): ByteArray {
    val output = ByteArrayOutputStream()
    var remaining = value.toULong()
    do {
      val byte = (remaining and 0x7fuL).toInt()
      remaining = remaining shr 7
      output.write(if (remaining == 0uL) byte else byte or 0x80)
    } while (remaining != 0uL)
    return output.toByteArray()
  }

  private fun message(vararg fields: ByteArray): ByteArray {
    val output = ByteArrayOutputStream()
    fields.forEach { field -> output.write(field) }
    return output.toByteArray()
  }
}
