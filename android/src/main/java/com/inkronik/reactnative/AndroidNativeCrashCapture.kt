package com.inkronik.reactnative

import android.content.Context
import android.os.Build
import java.io.File

internal object AndroidNativeCrashCapture {
  private const val MAX_JOURNAL_FILES = 8
  private const val MAX_JOURNAL_BYTES = 20_000L
  private val journalNamePattern = Regex("pending-[0-9]+-[0-9]+\\.bin")

  @Volatile
  private var nativeAvailable = false

  fun initialize(context: Context, store: InkronikStore) {
    val directory = File(context.noBackupFilesDir, "inkronik-native-crash-journal")
    importPending(directory, store)
    if (Build.VERSION.SDK_INT > 30 || !directory.mkdirsOrExists()) return

    nativeAvailable = runCatching {
      System.loadLibrary("inkronik_crash")
      nativeInstall(directory.absolutePath, Build.VERSION.SDK_INT)
    }.getOrDefault(false)
    configure(store.nativeCrashSnapshot())
  }

  fun configure(snapshot: NativeCrashSnapshot) {
    if (!nativeAvailable) return
    val values = arrayOf(
      if (snapshot.enabled) "1" else "0",
      snapshot.userId,
      snapshot.release,
      snapshot.dist,
      snapshot.environment,
    )
    runCatching { nativeConfigure(values) }
  }

  private fun importPending(directory: File, store: InkronikStore) {
    val files = directory.listFiles()
      ?.filter { file -> file.isFile && journalNamePattern.matches(file.name) && file.length() in 1..MAX_JOURNAL_BYTES }
      ?.sortedBy(File::lastModified)
      ?.takeLast(MAX_JOURNAL_FILES)
      ?: emptyList()

    directory.listFiles()
      ?.filterNot { file -> file in files }
      ?.forEach(File::delete)

    files.forEach { file ->
      val event = runCatching { AndroidNativeCrashJournal.parse(file.readBytes()) }.getOrNull()
      if (event == null || store.hasJvmEventNear(event.timestampMs)) {
        file.delete()
        return@forEach
      }
      if (store.capture(event).isNotEmpty()) file.delete()
    }
  }

  private fun File.mkdirsOrExists(): Boolean = isDirectory || mkdirs()

  private external fun nativeInstall(directoryPath: String, sdkInt: Int): Boolean

  private external fun nativeConfigure(values: Array<String?>)
}
