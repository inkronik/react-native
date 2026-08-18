package com.inkronik.crashfixture

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.SystemClock

class InkronikAnrReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    require(BuildConfig.DEBUG) { "ANR fixture is disabled outside debug builds" }
    SystemClock.sleep(60_000)
  }
}
