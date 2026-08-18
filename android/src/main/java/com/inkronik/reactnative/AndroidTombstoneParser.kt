package com.inkronik.reactnative

import java.io.InputStream

internal object AndroidTombstoneParser {
  private const val MAX_TOMBSTONE_BYTES = 4 * 1024 * 1024
  private const val MAX_FRAMES = 200
  private const val MAX_THREADS = 128

  fun parse(input: InputStream?): AndroidTombstone? {
    if (input == null) return null
    val bytes = runCatching { input.use(::readBounded) }.getOrNull()?.takeIf(ByteArray::isNotEmpty) ?: return null
    return runCatching { parseTombstone(ProtoReader(bytes)) }.getOrNull()
  }

  private fun readBounded(input: InputStream): ByteArray? {
    val output = java.io.ByteArrayOutputStream()
    val buffer = ByteArray(8_192)
    var total = 0
    while (true) {
      val count = input.read(buffer)
      if (count < 0) return output.toByteArray()
      if (count == 0) return null
      total += count
      if (total > MAX_TOMBSTONE_BYTES) return null
      output.write(buffer, 0, count)
    }
  }

  private fun parseTombstone(reader: ProtoReader): AndroidTombstone {
    var crashedThreadId: Long? = null
    var signal: AndroidTombstoneSignal? = null
    // Mutation is bounded and local because protobuf input is consumed as a stream.
    val threads = mutableListOf<Pair<Long?, List<NativeStackFrame>>>()
    while (reader.hasRemaining()) {
      val tag = reader.readTag()
      when (tag.fieldNumber) {
        6 -> crashedThreadId = reader.readVarintFor(tag)
        10 -> signal = parseSignal(reader.readMessageFor(tag))
        16 -> if (threads.size < MAX_THREADS) threads.add(parseThreadEntry(reader.readMessageFor(tag))) else reader.skipField(tag)
        else -> reader.skipField(tag)
      }
    }
    val frames = threads.firstOrNull { thread -> thread.first == crashedThreadId }?.second ?: emptyList()
    return AndroidTombstone(signal = signal, frames = frames)
  }

  private fun parseSignal(reader: ProtoReader): AndroidTombstoneSignal {
    var number: Long? = null
    var name: String? = null
    var code: Long? = null
    var codeName: String? = null
    var faultAddress: Long? = null
    while (reader.hasRemaining()) {
      val tag = reader.readTag()
      when (tag.fieldNumber) {
        1 -> number = reader.readVarintFor(tag)
        2 -> name = reader.readStringFor(tag, 64)
        3 -> code = reader.readVarintFor(tag)
        4 -> codeName = reader.readStringFor(tag, 64)
        9 -> faultAddress = reader.readVarintFor(tag)
        else -> reader.skipField(tag)
      }
    }
    return AndroidTombstoneSignal(number, name, code, codeName, faultAddress)
  }

  private fun parseThreadEntry(reader: ProtoReader): Pair<Long?, List<NativeStackFrame>> {
    var threadId: Long? = null
    var frames = emptyList<NativeStackFrame>()
    while (reader.hasRemaining()) {
      val tag = reader.readTag()
      when (tag.fieldNumber) {
        1 -> threadId = reader.readVarintFor(tag)
        2 -> frames = parseThread(reader.readMessageFor(tag))
        else -> reader.skipField(tag)
      }
    }
    return threadId to frames
  }

  private fun parseThread(reader: ProtoReader): List<NativeStackFrame> {
    // Mutation is bounded and local because protobuf input is consumed as a stream.
    val frames = mutableListOf<NativeStackFrame>()
    while (reader.hasRemaining()) {
      val tag = reader.readTag()
      if (tag.fieldNumber == 4 && frames.size < MAX_FRAMES) {
        frames.add(parseFrame(reader.readMessageFor(tag)))
      } else {
        reader.skipField(tag)
      }
    }
    return frames
  }

  private fun parseFrame(reader: ProtoReader): NativeStackFrame {
    var relativePc: Long? = null
    var pc: Long? = null
    var function = "<unknown>"
    var functionOffset: Long? = null
    var imagePath = "<unknown>"
    var buildId: String? = null
    while (reader.hasRemaining()) {
      val tag = reader.readTag()
      when (tag.fieldNumber) {
        1 -> relativePc = reader.readVarintFor(tag)
        2 -> pc = reader.readVarintFor(tag)
        4 -> function = reader.readStringFor(tag, 512)
        5 -> functionOffset = reader.readVarintFor(tag)
        6 -> imagePath = reader.readStringFor(tag, 512)
        8 -> buildId = reader.readStringFor(tag, 64).lowercase().takeIf { value -> value.matches(Regex("[0-9a-f-]{8,64}")) }
        else -> reader.skipField(tag)
      }
    }
    return NativeStackFrame(
      function = function,
      filename = imagePath.substringAfterLast('/'),
      inApp = isApplicationImage(imagePath),
      instructionAddress = pc?.toHexAddress(),
      imageAddress = pc?.let { address -> relativePc?.let { offset -> (address - offset).takeIf { it >= 0 }?.toHexAddress() } },
      imageUuid = buildId,
      symbolAddress = pc?.let { address -> functionOffset?.let { offset -> (address - offset).takeIf { it >= 0 }?.toHexAddress() } },
    )
  }

  private fun isApplicationImage(imagePath: String): Boolean =
    imagePath.startsWith("/data/app/") ||
      imagePath.startsWith("/data/user/") ||
      imagePath.startsWith("/data/data/")
}

private data class ProtoTag(val fieldNumber: Int, val wireType: Int)

private class ProtoReader(
  private val bytes: ByteArray,
  private var position: Int = 0,
  private val limit: Int = bytes.size,
) {
  fun hasRemaining(): Boolean = position < limit

  fun readTag(): ProtoTag {
    val value = readVarint()
    val fieldNumber = (value ushr 3).toInt()
    val wireType = (value and 7).toInt()
    require(fieldNumber > 0)
    return ProtoTag(fieldNumber, wireType)
  }

  fun readVarintFor(tag: ProtoTag): Long {
    require(tag.wireType == 0)
    return readVarint()
  }

  fun readMessageFor(tag: ProtoTag): ProtoReader {
    require(tag.wireType == 2)
    val length = readLength()
    val end = position + length
    require(end >= position && end <= limit)
    val result = ProtoReader(bytes, position, end)
    position = end
    return result
  }

  fun readStringFor(tag: ProtoTag, maximumLength: Int): String {
    val message = readMessageFor(tag)
    return InkronikSanitizer.text(
      String(bytes, message.position, message.limit - message.position, Charsets.UTF_8),
      maximumLength,
    )
  }

  fun skipField(tag: ProtoTag) {
    when (tag.wireType) {
      0 -> readVarint()
      1 -> skip(8)
      2 -> skip(readLength())
      5 -> skip(4)
      else -> error("Unsupported protobuf wire type")
    }
  }

  private fun readLength(): Int {
    val value = readVarint()
    require(value in 0..Int.MAX_VALUE.toLong())
    return value.toInt()
  }

  private fun readVarint(): Long {
    var result = 0L
    for (shift in 0 until 64 step 7) {
      require(position < limit)
      val byte = bytes[position++].toInt() and 0xff
      if (shift == 63) require(byte and 0xfe == 0)
      result = result or ((byte and 0x7f).toLong() shl shift)
      if ((byte and 0x80) == 0) return result
    }
    error("Malformed protobuf varint")
  }

  private fun skip(count: Int) {
    require(count >= 0 && position + count >= position && position + count <= limit)
    position += count
  }
}

private fun Long.toHexAddress(): String = "0x${toULong().toString(16)}"
