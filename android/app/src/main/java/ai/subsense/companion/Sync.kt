package ai.subsense.companion

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

data class SyncResult(val ok: Boolean, val message: String, val today: List<Pair<TrackedApp, Int>> = emptyList())

object Sync {

    /** One full sync: ask the server what to measure, read it locally, upload daily totals. */
    suspend fun run(context: Context): SyncResult {
        val prefs = Prefs(context)
        if (!UsageReader.hasAccess(context)) return SyncResult(false, "Usage access has not been granted yet.")
        return try {
            val tracked = Api.trackedApps(prefs.serverUrl)
            val usage = UsageReader.dailyMinutes(context, tracked.map { it.packageName }.toSet())
            val accepted = Api.postUsage(prefs.serverUrl, usage)
            val newest = usage.maxOfOrNull { it.date }
            val today = tracked
                .map { app -> app to (usage.firstOrNull { it.packageName == app.packageName && it.date == newest }?.minutes ?: 0) }
                .sortedByDescending { it.second }
            prefs.lastSyncAt = System.currentTimeMillis()
            prefs.lastSyncMessage = "Sent $accepted daily totals for ${tracked.size} apps."
            SyncResult(true, prefs.lastSyncMessage, today)
        } catch (e: Exception) {
            val message = "Could not sync: ${e.message ?: e.javaClass.simpleName}"
            prefs.lastSyncMessage = message
            SyncResult(false, message)
        }
    }

    /** Keeps usage fresh in the background, a few times a day, only when online. */
    fun schedule(context: Context) {
        val request = PeriodicWorkRequestBuilder<SyncWorker>(6, TimeUnit.HOURS)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork("subsense-usage-sync", ExistingPeriodicWorkPolicy.KEEP, request)
    }
}

class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = if (Sync.run(applicationContext).ok) Result.success() else Result.retry()
}
