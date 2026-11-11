package ai.subster.companion

import android.app.AppOpsManager
import android.app.usage.UsageStatsManager
import android.content.Context
import android.os.Build
import android.os.Process
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

data class DayUsage(val packageName: String, val date: LocalDate, val minutes: Int)

/**
 * Reads foreground time per app per day from Android's UsageStatsManager.
 *
 * Privacy: only the packages the server says are tracked subscriptions are read out, and only
 * daily totals leave this class. No titles, no content, no other apps.
 */
object UsageReader {

    /** True once the user has granted "Usage access" to this app in system settings. */
    fun hasAccess(context: Context): Boolean {
        val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
        val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            appOps.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName)
        } else {
            @Suppress("DEPRECATION")
            appOps.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName)
        }
        return mode == AppOpsManager.MODE_ALLOWED
    }

    /** Daily foreground minutes for [packages] over the last [days] days, today included. */
    fun dailyMinutes(context: Context, packages: Set<String>, days: Int = 7): List<DayUsage> {
        if (packages.isEmpty()) return emptyList()
        val manager = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
        val zone = ZoneId.systemDefault()
        val today = LocalDate.now(zone)
        val result = mutableListOf<DayUsage>()

        // One query per calendar day keeps each total aligned to the user's local midnight.
        for (offset in 0 until days) {
            val day = today.minusDays(offset.toLong())
            val start = day.atStartOfDay(zone).toInstant().toEpochMilli()
            val end = minOf(day.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli(), Instant.now().toEpochMilli())
            val totals = manager.queryAndAggregateUsageStats(start, end)
            for (pkg in packages) {
                val millis = totals[pkg]?.totalTimeInForeground ?: 0L
                // Zero is reported too: "not opened today" is exactly the signal the agent needs.
                result += DayUsage(pkg, day, (millis / 60_000L).toInt().coerceIn(0, 1440))
            }
        }
        return result
    }
}
