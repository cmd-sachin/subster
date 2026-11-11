package ai.subster.companion

import android.content.Context

/** Small settings store: where the Subster server is, and how the last sync went. */
class Prefs(context: Context) {
    private val prefs = context.getSharedPreferences("subster", Context.MODE_PRIVATE)

    var serverUrl: String
        // 10.0.2.2 is the development machine as seen from the Android emulator.
        get() = prefs.getString("serverUrl", "http://10.0.2.2:3000") ?: "http://10.0.2.2:3000"
        set(value) = prefs.edit().putString("serverUrl", value.trim().trimEnd('/')).apply()

    var lastSyncAt: Long
        get() = prefs.getLong("lastSyncAt", 0L)
        set(value) = prefs.edit().putLong("lastSyncAt", value).apply()

    var lastSyncMessage: String
        get() = prefs.getString("lastSyncMessage", "") ?: ""
        set(value) = prefs.edit().putString("lastSyncMessage", value).apply()
}
