package ai.subsense.companion

import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Sync
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.LifecycleResumeEffect
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Date

// Same palette as the web app (src/app/globals.css).
private val Canvas = Color(0xFF030407)
private val Ink = Color(0xFFEEF1F7)
private val Muted = Color(0xFF9AA4B8)
private val Faint = Color(0xFF677188)
private val Accent = Color(0xFFD4FF24)
private val Good = Color(0xFFD4FF24)
private val Warn = Color(0xFFF0B560)
private val Bad = Color(0xFFF08585)
private val Glass = Color(0x0FFFFFFF)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Sync.schedule(applicationContext)
        setContent {
            MaterialTheme(colorScheme = darkColorScheme(primary = Accent, background = Canvas, surface = Canvas, onSurface = Ink, onBackground = Ink)) {
                CompanionScreen()
            }
        }
    }
}

@Composable
private fun CompanionScreen() {
    val context = LocalContext.current
    val prefs = remember { Prefs(context) }
    val scope = rememberCoroutineScope()

    var hasAccess by remember { mutableStateOf(UsageReader.hasAccess(context)) }
    var serverUrl by remember { mutableStateOf(prefs.serverUrl) }
    var syncing by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf(prefs.lastSyncMessage) }
    var ok by remember { mutableStateOf(true) }
    var lastSyncAt by remember { mutableStateOf(prefs.lastSyncAt) }
    var today by remember { mutableStateOf(emptyList<Pair<TrackedApp, Int>>()) }

    // The user grants access in system settings; re-check when they come back.
    LifecycleResumeEffect(Unit) {
        hasAccess = UsageReader.hasAccess(context)
        onPauseOrDispose { }
    }

    fun sync() {
        prefs.serverUrl = serverUrl
        syncing = true
        scope.launch {
            val result = Sync.run(context)
            ok = result.ok
            message = result.message
            if (result.ok) {
                today = result.today
                lastSyncAt = prefs.lastSyncAt
            }
            syncing = false
        }
    }

    Box(
        Modifier
            .fillMaxSize()
            .background(Brush.verticalGradient(listOf(Color(0xFF0B2A63), Canvas, Canvas)))
            .systemBarsPadding(),
    ) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Column {
                Text("SubSense", color = Ink, fontSize = 26.sp, fontWeight = FontWeight.SemiBold)
                Text("Usage companion", color = Faint, fontSize = 13.sp)
            }

            Card {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        if (hasAccess) Icons.Outlined.CheckCircle else Icons.Outlined.Lock,
                        contentDescription = null,
                        tint = if (hasAccess) Good else Warn,
                    )
                    Spacer(Modifier.width(10.dp))
                    Text(if (hasAccess) "Usage access granted" else "Usage access needed", color = Ink, fontWeight = FontWeight.Medium)
                }
                Spacer(Modifier.height(8.dp))
                Text(
                    "SubSense reads how long each subscription app was on screen per day. It reads only apps that belong to " +
                        "subscriptions you track and sends daily totals: no titles, no content, no passwords.",
                    color = Muted,
                    fontSize = 13.sp,
                    lineHeight = 19.sp,
                )
                if (!hasAccess) {
                    Spacer(Modifier.height(12.dp))
                    Button(
                        onClick = { context.startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)) },
                        colors = ButtonDefaults.buttonColors(containerColor = Accent, contentColor = Canvas),
                    ) { Text("Open usage access settings") }
                }
            }

            Card {
                Text("Server", color = Faint, fontSize = 12.sp)
                Spacer(Modifier.height(6.dp))
                OutlinedTextField(
                    value = serverUrl,
                    onValueChange = { serverUrl = it },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    supportingText = { Text("Emulator: http://10.0.2.2:3000. A phone needs your deployed https URL.", color = Faint) },
                )
                Spacer(Modifier.height(8.dp))
                Button(
                    onClick = { sync() },
                    enabled = hasAccess && !syncing,
                    colors = ButtonDefaults.buttonColors(containerColor = Accent, contentColor = Canvas),
                ) {
                    Icon(Icons.Outlined.Sync, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(if (syncing) "Syncing" else "Sync now")
                }
                if (message.isNotEmpty()) {
                    Spacer(Modifier.height(10.dp))
                    Text(message, color = if (ok) Muted else Bad, fontSize = 13.sp)
                }
                if (lastSyncAt > 0) {
                    Text(
                        "Last sync ${DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(lastSyncAt))}. Repeats in the background every 6 hours.",
                        color = Faint,
                        fontSize = 12.sp,
                    )
                }
            }

            if (today.isNotEmpty()) {
                Card {
                    Text("Today on this phone", color = Faint, fontSize = 12.sp)
                    Spacer(Modifier.height(8.dp))
                    val max = (today.maxOf { it.second }).coerceAtLeast(1)
                    today.forEach { (app, minutes) ->
                        Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(app.name, color = Ink, fontSize = 14.sp, modifier = Modifier.weight(1f))
                            Box(
                                Modifier
                                    .width(90.dp)
                                    .height(6.dp)
                                    .clip(CircleShape)
                                    .background(Glass),
                            ) {
                                Box(
                                    Modifier
                                        .fillMaxWidth(minutes / max.toFloat())
                                        .height(6.dp)
                                        .clip(CircleShape)
                                        .background(if (minutes == 0) Bad else Accent),
                                )
                            }
                            Spacer(Modifier.width(10.dp))
                            Text(
                                if (minutes >= 60) "${minutes / 60}h ${minutes % 60}m" else "${minutes}m",
                                color = if (minutes == 0) Bad else Muted,
                                fontSize = 13.sp,
                                modifier = Modifier.width(64.dp),
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Card(content: @Composable () -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(Glass)
            .padding(18.dp),
    ) { content() }
}
