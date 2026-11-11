package ai.subster.companion

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

data class TrackedApp(val packageName: String, val name: String)

/** The two calls the companion makes to the Subster server. */
object Api {

    private fun open(url: String, method: String): HttpURLConnection =
        (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 10_000
            readTimeout = 20_000
            setRequestProperty("Accept", "application/json")
        }

    private fun HttpURLConnection.readBody(): String {
        val stream = if (responseCode in 200..299) inputStream else (errorStream ?: inputStream)
        return stream.bufferedReader().use { it.readText() }
    }

    /** Which apps belong to subscriptions the user tracks. Nothing else is ever read. */
    suspend fun trackedApps(serverUrl: String): List<TrackedApp> = withContext(Dispatchers.IO) {
        val connection = open("$serverUrl/api/usage", "GET")
        try {
            val body = connection.readBody()
            if (connection.responseCode !in 200..299) error("Server answered ${connection.responseCode}")
            val packages = JSONObject(body).getJSONArray("packages")
            (0 until packages.length()).map { i ->
                val item = packages.getJSONObject(i)
                TrackedApp(item.getString("package"), item.getString("name"))
            }
        } finally {
            connection.disconnect()
        }
    }

    /** Uploads daily totals. Returns how many the server accepted. */
    suspend fun postUsage(serverUrl: String, days: List<DayUsage>): Int = withContext(Dispatchers.IO) {
        val payload = JSONObject().apply {
            put("source", "android")
            put("days", JSONArray().apply {
                days.forEach { day ->
                    put(JSONObject().apply {
                        put("package", day.packageName)
                        put("date", day.date.toString())
                        put("minutes", day.minutes)
                    })
                }
            })
        }
        val connection = open("$serverUrl/api/usage", "POST").apply {
            doOutput = true
            setRequestProperty("Content-Type", "application/json")
        }
        try {
            connection.outputStream.use { it.write(payload.toString().toByteArray()) }
            val body = connection.readBody()
            if (connection.responseCode !in 200..299) error("Server answered ${connection.responseCode}")
            JSONObject(body).optInt("accepted", 0)
        } finally {
            connection.disconnect()
        }
    }
}
