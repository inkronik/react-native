package com.inkronik.reactnative

internal object InkronikSanitizer {
  private const val REDACTED = "[REDACTED]"
  private const val MAX_MESSAGE_LENGTH = 2_000
  private const val MAX_STACK_LENGTH = 100_000

  private val assignments = Regex(
    "(?i)(authorization|cookie|password|passwd|secret|token|api[_-]?key|access[_-]?token|refresh[_-]?token)\\s*[:=]\\s*([^\\s,;]+)"
  )
  private val bearer = Regex("(?i)bearer\\s+[A-Za-z0-9._~+/-]{8,}")
  private val urlQuery = Regex("([?&])[^#\\s]+")

  fun text(value: String, maximumLength: Int = MAX_MESSAGE_LENGTH): String =
    value
      .replace(assignments) { match -> "${match.groupValues[1]}=$REDACTED" }
      .replace(bearer, "Bearer $REDACTED")
      .replace(urlQuery, "")
      .take(maximumLength)

  fun stack(value: String?): String? = value?.let { text(it, MAX_STACK_LENGTH) }

  fun mechanism(value: String): String =
    value
      .filter { character -> character.isLetterOrDigit() || character == '.' || character == '_' || character == '-' }
      .take(128)
      .ifEmpty { "native" }
}
