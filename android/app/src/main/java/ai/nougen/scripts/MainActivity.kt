package ai.nougen.scripts

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.documentfile.provider.DocumentFile
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.security.MessageDigest
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

// NouGenDesign & Stitch DESIGN.md canonical token palette
private val Bg = Color(0xFF141414)
private val Panel = Color(0xFF1D1D23)
private val Panel2 = Color(0xFF25252E)
private val Line = Color(0xFF2E2E3A)
private val TextColor = Color(0xFFF2EEE6)
private val MutedColor = Color(0xFFBDB8AD)
private val FaintColor = Color(0xFF7A766F)
private val AccentGold = Color(0xFFE8B86D) // Matte amber anchor for ON CAM
private val AccentIris = Color(0xFFBC8CFF) // Matte iris for VO
private val VerifiedGreen = Color(0xFFA9C79B) // Cryptographic approval seal
private val DangerColor = Color(0xFFFFB4AB) // Wording lint alerts

private data class ScriptVersion(val version: Int, val name: String, val body: String)
private data class Cue(val number: Int, val kind: String, val hint: String, val text: String, val seconds: Int, val flags: List<String>)
private data class Approval(val version: Int, val file: String, val sha256: String, val whenText: String, val note: String)
private data class LoadedStory(val name: String, val versions: List<ScriptVersion>, val savedJson: JSONObject?, val isCurrent: Boolean)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { NouScriptsTheme { ScriptReviewScreen() } }
    }
}

@Composable
private fun NouScriptsTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = AccentGold,
            secondary = AccentIris,
            background = Bg,
            surface = Panel,
            onBackground = TextColor,
            onSurface = TextColor,
        ),
        content = content,
    )
}

@Composable
private fun ScriptReviewScreen() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val prefs = remember { context.getSharedPreferences("nou-scripts", 0) }
    var folderUri by remember { mutableStateOf(prefs.getString("storyFolder", null)?.let { Uri.parse(it) }) }
    var folderName by remember { mutableStateOf("Choose a story folder") }
    var versions by remember { mutableStateOf<List<ScriptVersion>>(emptyList()) }
    var selectedVersion by remember { mutableStateOf<Int?>(null) }
    var approval by remember { mutableStateOf<Approval?>(null) }
    var approvalCurrent by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var askApprove by remember { mutableStateOf(false) }
    var approvalNote by remember { mutableStateOf("") }
    var refreshTick by remember { mutableStateOf(0) }
    var inPrompter by remember { mutableStateOf(false) }
    var inspectingCue by remember { mutableStateOf<Cue?>(null) }

    val folderPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
        if (uri != null) {
            val flags = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            runCatching { context.contentResolver.takePersistableUriPermission(uri, flags) }
            folderUri = uri
            prefs.edit().putString("storyFolder", uri.toString()).apply()
        }
    }

    LaunchedEffect(folderUri, refreshTick) {
        val uri = folderUri ?: return@LaunchedEffect
        busy = true
        loadError = null
        val result = withContext(Dispatchers.IO) {
            runCatching {
                val dir = DocumentFile.fromTreeUri(context, uri) ?: error("Can't open that folder")
                val found = dir.listFiles().mapNotNull { doc ->
                    val match = Regex("^script_v(\\d+)\\.md$", RegexOption.IGNORE_CASE).matchEntire(doc.name ?: "")
                    if (match == null || !doc.isFile) null else {
                        val text = context.contentResolver.openInputStream(doc.uri)?.bufferedReader()?.use { it.readText() }
                            ?: error("Can't read ${doc.name}")
                        ScriptVersion(match.groupValues[1].toInt(), doc.name!!, text)
                    }
                }.sortedBy { it.version }
                val approvalDoc = dir.findFile("approval.json")
                val saved = approvalDoc?.let { file ->
                    context.contentResolver.openInputStream(file.uri)?.bufferedReader()?.use { JSONObject(it.readText()) }
                }
                val approvedFile = dir.findFile(saved?.optString("file").orEmpty())
                val approvedBytes = approvedFile?.let { file -> context.contentResolver.openInputStream(file.uri)?.use { it.readBytes() } }
                val isCurrent = approvedBytes != null && sha256(approvedBytes) == saved?.optString("sha256")
                LoadedStory(dir.name ?: "Story folder", found, saved, isCurrent)
            }
        }
        result.onSuccess { loaded ->
            folderName = loaded.name
            versions = loaded.versions
            if (selectedVersion == null || loaded.versions.none { it.version == selectedVersion }) selectedVersion = loaded.versions.lastOrNull()?.version
            approval = loaded.savedJson?.let {
                Approval(
                    it.optInt("version"),
                    it.optString("file"),
                    it.optString("sha256"),
                    it.optString("approved_at_eastern", it.optString("approved_at")),
                    it.optString("note")
                )
            }
            approvalCurrent = loaded.isCurrent
        }.onFailure { loadError = it.message ?: "Could not read the selected folder" }
        busy = false
    }

    val selected = versions.firstOrNull { it.version == selectedVersion }
    val cues = remember(selected?.body) {
        selected?.let {
            val terms = runCatching {
                context.assets.open("banlist.txt").bufferedReader().use { r -> r.readLines() }
            }.getOrDefault(emptyList())
            parseCues(it.body, terms)
        } ?: emptyList()
    }
    val approvedSelected = approvalCurrent && approval?.version == selected?.version

    if (inPrompter && selected != null) {
        TeleprompterScreen(
            script = selected,
            cues = cues,
            onExit = { inPrompter = false },
        )
        return
    }

    if (inspectingCue != null) {
        val cue = inspectingCue!!
        AlertDialog(
            onDismissRequest = { inspectingCue = null },
            title = { Text("Wording Flag · Cue ${cue.number}", color = AccentGold, fontWeight = FontWeight.Bold) },
            text = {
                Column {
                    Text("Detected AI cliché / banned term:", fontWeight = FontWeight.SemiBold, color = DangerColor)
                    Spacer(Modifier.height(4.dp))
                    Text(cue.flags.joinToString(", "), style = MaterialTheme.typography.bodyLarge, color = AccentIris, fontFamily = FontFamily.Monospace)
                    Spacer(Modifier.height(10.dp))
                    Text(
                        "Per NouGen voice doctrine, scripts must use direct, active reporting language. Clichés (e.g. delve, tapestry, testament, vibrant realm) reduce audience retention. Replace with concrete verbs and straightforward facts.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MutedColor
                    )
                }
            },
            confirmButton = { TextButton(onClick = { inspectingCue = null }) { Text("Understood", color = AccentGold) } }
        )
    }

    if (askApprove && selected != null) {
        AlertDialog(
            onDismissRequest = { askApprove = false },
            title = { Text("Approve v${selected.version} for render?", color = TextColor, fontWeight = FontWeight.Bold) },
            text = {
                Column {
                    Text("This signs an immutable SHA-256 seal beside ${selected.name}. Any later file edit invalidates the signature and halts the render queue.", color = MutedColor)
                    Spacer(Modifier.height(10.dp))
                    OutlinedTextField(
                        value = approvalNote,
                        onValueChange = { approvalNote = it },
                        label = { Text("Director's note (optional)") },
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    val note = approvalNote.trim()
                    askApprove = false
                    val uri = folderUri ?: return@TextButton
                    scope.launch {
                        val result = withContext(Dispatchers.IO) { runCatching { writeApproval(context, uri, selected, note) } }
                        result.onFailure { loadError = it.message ?: "Approval could not be saved" }
                        folderUri = uri
                        if (result.isSuccess) {
                            val saved = result.getOrNull()
                            approval = saved
                            approvalCurrent = saved?.sha256 == sha256(selected.body)
                        }
                    }
                }) { Text("Sign & Approve", color = AccentGold, fontWeight = FontWeight.Bold) }
            },
            dismissButton = { TextButton(onClick = { askApprove = false }) { Text("Cancel", color = MutedColor) } },
        )
    }

    Surface(modifier = Modifier.fillMaxSize(), color = Bg) {
        Column(modifier = Modifier.fillMaxSize().padding(horizontal = 18.dp, vertical = 16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(modifier = Modifier.width(8.dp).height(8.dp).background(AccentGold, RoundedCornerShape(4.dp)))
                Spacer(Modifier.width(8.dp))
                Text("Nou Scripts", style = MaterialTheme.typography.labelLarge, color = AccentGold, fontWeight = FontWeight.Bold)
                Spacer(Modifier.width(8.dp))
                Text("· Broadcast Review & Gate", style = MaterialTheme.typography.labelSmall, color = FaintColor)
            }
            Spacer(Modifier.height(6.dp))
            Text(
                selected?.let { titleOf(it.body) } ?: "Review a script",
                style = MaterialTheme.typography.headlineMedium,
                color = TextColor,
                fontWeight = FontWeight.Bold
            )
            Text(folderName, style = MaterialTheme.typography.bodySmall, color = MutedColor, fontFamily = FontFamily.Monospace)
            Spacer(Modifier.height(14.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                Button(
                    onClick = { folderPicker.launch(folderUri) },
                    modifier = Modifier.defaultMinSize(minHeight = 44.dp),
                    shape = RoundedCornerShape(8.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Panel2, contentColor = TextColor)
                ) { Text(if (folderUri == null) "Open story folder" else "Change folder") }
                if (folderUri != null) {
                    OutlinedButton(
                        onClick = { refreshTick++ },
                        enabled = !busy,
                        modifier = Modifier.defaultMinSize(minHeight = 44.dp),
                        shape = RoundedCornerShape(8.dp),
                        border = BorderStroke(1.dp, Line)
                    ) { Text("Refresh") }
                }
                if (busy) Text("Loading…", color = MutedColor, fontFamily = FontFamily.Monospace)
            }
            if (loadError != null) Text(loadError!!, color = DangerColor, modifier = Modifier.padding(top = 8.dp))
            if (versions.isNotEmpty()) {
                Spacer(Modifier.height(13.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    versions.forEach { v ->
                        val isSelected = v.version == selectedVersion
                        if (isSelected) {
                            Button(
                                onClick = { selectedVersion = v.version },
                                modifier = Modifier.defaultMinSize(minHeight = 44.dp),
                                shape = RoundedCornerShape(8.dp),
                                colors = ButtonDefaults.buttonColors(containerColor = AccentGold, contentColor = Color(0xFF141414))
                            ) { Text("v${v.version}", fontWeight = FontWeight.Bold) }
                        } else {
                            OutlinedButton(
                                onClick = { selectedVersion = v.version },
                                modifier = Modifier.defaultMinSize(minHeight = 44.dp),
                                shape = RoundedCornerShape(8.dp),
                                border = BorderStroke(1.dp, Line)
                            ) { Text("v${v.version}") }
                        }
                    }
                }
            }
            if (selected != null) {
                val totalWords = cues.sumOf { countWords(it.text) }
                val runtime = (totalWords / 2.8).toInt()
                val flaggedCount = cues.count { it.flags.isNotEmpty() }
                Spacer(Modifier.height(12.dp))
                Card(
                    colors = CardDefaults.cardColors(containerColor = Panel),
                    border = BorderStroke(1.dp, Line),
                    shape = RoundedCornerShape(8.dp)
                ) {
                    Column(Modifier.fillMaxWidth().padding(14.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                "${formatTime(runtime)}  ·  $totalWords words  ·  ${cues.size} cues",
                                fontWeight = FontWeight.SemiBold,
                                color = TextColor,
                                fontFamily = FontFamily.Monospace
                            )
                        }
                        Spacer(Modifier.height(5.dp))
                        val status = when {
                            approvedSelected -> "v${selected.version} approved for render" + if (approval?.note.isNullOrBlank()) "" else " · “${approval?.note}”"
                            approval != null && !approvalCurrent -> "Approval is stale; file edited since signature"
                            approval != null -> "v${approval!!.version} approved; v${selected.version} unapproved"
                            else -> "Not approved · rendering gated"
                        }
                        Text(
                            status,
                            color = if (approvedSelected) VerifiedGreen else AccentGold,
                            style = MaterialTheme.typography.bodySmall,
                            fontWeight = FontWeight.Medium
                        )
                        if (flaggedCount > 0) {
                            Spacer(Modifier.height(4.dp))
                            Text(
                                "$flaggedCount cue(s) flagged for AI clichés / banlist wording",
                                color = DangerColor,
                                style = MaterialTheme.typography.labelSmall
                            )
                        }
                    }
                }
                Spacer(Modifier.height(10.dp))
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        onClick = { askApprove = true },
                        enabled = !approvedSelected && !busy,
                        modifier = Modifier.weight(1f).defaultMinSize(minHeight = 48.dp),
                        shape = RoundedCornerShape(8.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = AccentGold,
                            contentColor = Color(0xFF141414),
                            disabledContainerColor = Panel2,
                            disabledContentColor = FaintColor
                        )
                    ) {
                        Text(if (approvedSelected) "Approved" else "Approve v${selected.version}", fontWeight = FontWeight.Bold)
                    }
                    OutlinedButton(
                        onClick = { inPrompter = true },
                        modifier = Modifier.weight(1f).defaultMinSize(minHeight = 48.dp),
                        shape = RoundedCornerShape(8.dp),
                        border = BorderStroke(1.dp, Line)
                    ) {
                        Text("Teleprompter", color = TextColor, fontWeight = FontWeight.SemiBold)
                    }
                }
                Spacer(Modifier.height(10.dp))
                LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(cues, key = { it.number }) { cue ->
                        CueCard(cue = cue, onFlagClick = { inspectingCue = cue })
                    }
                    if (cues.isEmpty()) item { Text("No numbered cue cards found in this script.", color = MutedColor) }
                }
            } else if (!busy && loadError == null) {
                Spacer(Modifier.height(18.dp))
                Text(
                    "Choose a story folder containing script_v1.md and approval.json. All state remains strictly on this device.",
                    color = MutedColor
                )
            }
        }
    }
}

@Composable
private fun CueCard(cue: Cue, onFlagClick: () -> Unit) {
    val isCam = cue.kind.contains("ON CAM", ignoreCase = true)
    val indicatorColor = if (isCam) AccentGold else AccentIris

    Card(
        colors = CardDefaults.cardColors(containerColor = Panel),
        border = BorderStroke(1.dp, Line),
        shape = RoundedCornerShape(8.dp)
    ) {
        Row(modifier = Modifier.fillMaxWidth()) {
            // Left camera indicator anchor stripe
            Box(
                modifier = Modifier
                    .width(4.dp)
                    .height(96.dp)
                    .background(indicatorColor)
            )
            Column(Modifier.fillMaxWidth().padding(14.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        "${cue.number}  ·  ${cue.kind}",
                        color = indicatorColor,
                        fontWeight = FontWeight.Bold,
                        style = MaterialTheme.typography.labelLarge
                    )
                    Spacer(Modifier.weight(1f))
                    Text(
                        "${countWords(cue.text)}w · ~${cue.seconds}s",
                        color = MutedColor,
                        style = MaterialTheme.typography.labelSmall,
                        fontFamily = FontFamily.Monospace
                    )
                }
                if (cue.hint.isNotBlank()) {
                    Text(cue.hint, color = MutedColor, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(top = 2.dp))
                }
                Spacer(Modifier.height(8.dp))
                Text(
                    cue.text,
                    style = MaterialTheme.typography.bodyLarge,
                    color = TextColor,
                    lineHeight = MaterialTheme.typography.bodyLarge.lineHeight * 1.3f
                )
                if (cue.flags.isNotEmpty()) {
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "Review wording: ${cue.flags.joinToString()} ⓘ",
                        color = DangerColor,
                        style = MaterialTheme.typography.labelSmall,
                        modifier = Modifier
                            .background(Color(0x22FFB4AB), RoundedCornerShape(4.dp))
                            .clickable { onFlagClick() }
                            .padding(horizontal = 8.dp, vertical = 6.dp)
                    )
                }
            }
        }
    }
}

@Composable
private fun TeleprompterScreen(
    script: ScriptVersion,
    cues: List<Cue>,
    onExit: () -> Unit,
) {
    BackHandler { onExit() }

    val scrollState = rememberScrollState()
    var isScrolling by remember { mutableStateOf(false) }
    var mirrorMode by remember { mutableStateOf(false) }
    var speedPxPerSec by remember { mutableFloatStateOf(45f) }
    var fontSizeSp by remember { mutableIntStateOf(34) }
    var showControls by remember { mutableStateOf(true) }

    LaunchedEffect(isScrolling, speedPxPerSec) {
        if (!isScrolling) return@LaunchedEffect
        var prevNanos = 0L
        while (isActive && isScrolling) {
            withFrameNanos { now ->
                if (prevNanos != 0L) {
                    val dt = (now - prevNanos) / 1_000_000_000f
                    val delta = speedPxPerSec * dt
                    scrollState.dispatchRawDelta(delta)
                }
                prevNanos = now
            }
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF000000))
            .clickable { showControls = !showControls }
    ) {
        // Center reticle guide
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(2.dp)
                .background(AccentGold.copy(alpha = 0.35f))
                .align(Alignment.Center)
        )

        // Scrolling Cues Container
        Column(
            modifier = Modifier
                .fillMaxSize()
                .graphicsLayer {
                    if (mirrorMode) scaleX = -1f
                }
                .verticalScroll(scrollState)
                .padding(horizontal = 28.dp)
        ) {
            Spacer(Modifier.height(320.dp))
            cues.forEach { cue ->
                val isCam = cue.kind.contains("ON CAM", ignoreCase = true)
                Column(modifier = Modifier.padding(bottom = 36.dp)) {
                    Text(
                        text = "${cue.number} · ${cue.kind}",
                        color = if (isCam) AccentGold else AccentIris,
                        fontSize = (fontSizeSp * 0.45f).sp,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 1.sp
                    )
                    Spacer(Modifier.height(6.dp))
                    Text(
                        text = cue.text,
                        color = Color(0xFFF4F1FB),
                        fontSize = fontSizeSp.sp,
                        fontWeight = FontWeight.SemiBold,
                        lineHeight = (fontSizeSp * 1.45f).sp
                    )
                }
            }
            Spacer(Modifier.height(600.dp))
        }

        // Animated HUD Controls Bar
        AnimatedVisibility(
            visible = showControls,
            enter = fadeIn(),
            exit = fadeOut(),
            modifier = Modifier.align(Alignment.TopCenter)
        ) {
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(10.dp),
                colors = CardDefaults.cardColors(containerColor = Color(0xEE1A1A22)),
                border = BorderStroke(1.dp, Line),
                shape = RoundedCornerShape(8.dp)
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 10.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    OutlinedButton(
                        onClick = onExit,
                        modifier = Modifier.defaultMinSize(minHeight = 44.dp),
                        shape = RoundedCornerShape(6.dp),
                        border = BorderStroke(1.dp, Line)
                    ) { Text("Exit", color = TextColor) }

                    Button(
                        onClick = { isScrolling = !isScrolling },
                        modifier = Modifier.defaultMinSize(minHeight = 44.dp),
                        shape = RoundedCornerShape(6.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = AccentGold, contentColor = Color(0xFF141414))
                    ) {
                        Text(if (isScrolling) "Pause" else "Play", fontWeight = FontWeight.Bold)
                    }

                    OutlinedButton(
                        onClick = { mirrorMode = !mirrorMode },
                        modifier = Modifier.defaultMinSize(minHeight = 44.dp),
                        shape = RoundedCornerShape(6.dp),
                        border = BorderStroke(1.dp, if (mirrorMode) AccentGold else Line),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = if (mirrorMode) AccentGold else TextColor)
                    ) {
                        Text(if (mirrorMode) "Mirror: ON" else "Mirror: OFF")
                    }

                    Spacer(Modifier.weight(1f))

                    OutlinedButton(
                        onClick = { speedPxPerSec = (speedPxPerSec - 10f).coerceAtLeast(15f) },
                        modifier = Modifier.defaultMinSize(minHeight = 44.dp),
                        shape = RoundedCornerShape(6.dp),
                        border = BorderStroke(1.dp, Line)
                    ) { Text("-", color = TextColor, fontWeight = FontWeight.Bold) }

                    Text(
                        "${speedPxPerSec.toInt()} px/s",
                        color = MutedColor,
                        style = MaterialTheme.typography.labelSmall,
                        fontFamily = FontFamily.Monospace
                    )

                    OutlinedButton(
                        onClick = { speedPxPerSec = (speedPxPerSec + 10f).coerceAtMost(180f) },
                        modifier = Modifier.defaultMinSize(minHeight = 44.dp),
                        shape = RoundedCornerShape(6.dp),
                        border = BorderStroke(1.dp, Line)
                    ) { Text("+", color = TextColor, fontWeight = FontWeight.Bold) }

                    OutlinedButton(
                        onClick = { fontSizeSp = (fontSizeSp - 4).coerceAtLeast(22) },
                        modifier = Modifier.defaultMinSize(minHeight = 44.dp),
                        shape = RoundedCornerShape(6.dp),
                        border = BorderStroke(1.dp, Line)
                    ) { Text("A-", color = TextColor) }

                    OutlinedButton(
                        onClick = { fontSizeSp = (fontSizeSp + 4).coerceAtMost(56) },
                        modifier = Modifier.defaultMinSize(minHeight = 44.dp),
                        shape = RoundedCornerShape(6.dp),
                        border = BorderStroke(1.dp, Line)
                    ) { Text("A+", color = TextColor) }
                }
            }
        }
    }
}

private fun parseCues(markdown: String, terms: List<String>): List<Cue> {
    val header = Regex("""^\*\*(\d+)\.\s+([A-Z][A-Z /-]*?)(?:\s*\(([^)]*)\))?\*\*\s*$""")
    val found = mutableListOf<MutableCue>()
    var current: MutableCue? = null
    var inNotes = false
    markdown.lineSequence().forEach { raw ->
        val line = raw.trim()
        if (line.startsWith("## ")) { inNotes = true; current = null; return@forEach }
        if (inNotes || line.startsWith("# ")) return@forEach
        val match = header.matchEntire(line)
        if (match != null) {
            current = MutableCue(match.groupValues[1].toInt(), match.groupValues[2].trim(), match.groupValues[3].trim())
            found += current!!
            return@forEach
        }
        if (line.isNotBlank() && current != null && !line.startsWith("*") && !line.startsWith("**")) current!!.text.add(line)
    }
    return found.map { cue ->
        val text = cue.text.joinToString(" ")
        val flags = terms.filter { term ->
            val clean = term.trim()
            if (clean.isBlank()) false else {
                Regex("""(?i)(?<![\p{L}\p{N}])${Regex.escape(clean)}(?![\p{L}\p{N}])""").containsMatchIn(text)
            }
        }.distinct()
        Cue(cue.number, if (cue.kind.contains("ON CAM", ignoreCase = true)) "ON CAM" else cue.kind, cue.hint, text,
            (countWords(text) / 2.8).toInt().coerceAtLeast(1), flags)
    }
}

private data class MutableCue(val number: Int, val kind: String, val hint: String, val text: MutableList<String> = mutableListOf())

private fun writeApproval(context: android.content.Context, folderUri: Uri, script: ScriptVersion, note: String = ""): Approval {
    val dir = DocumentFile.fromTreeUri(context, folderUri) ?: error("Story folder is unavailable")
    val source = dir.findFile(script.name) ?: error("${script.name} is no longer in this story folder")
    val currentBytes = context.contentResolver.openInputStream(source.uri)?.use { it.readBytes() }
        ?: error("Can't recheck ${script.name} before approval")
    val hash = sha256(currentBytes)
    if (hash != sha256(script.body)) error("${script.name} changed during review. Refresh and approve the latest contents.")
    val now = Instant.now()
    val eastern = DateTimeFormatter.ofPattern("EEE, MMM d, h:mm a z", Locale.US)
        .withZone(ZoneId.of("America/New_York")).format(now)
    val record = JSONObject()
        .put("version", script.version)
        .put("file", script.name)
        .put("sha256", hash)
        .put("approved_at", now.toString())
        .put("approved_at_eastern", eastern)
        .put("note", note)
        .put("by", "Dave (Nou Scripts Android app)")
    val stamp = System.currentTimeMillis()
    val staged = dir.createFile("application/json", ".approval-$stamp.pending")
        ?: error("Can't stage approval.json in this folder")
    try {
        context.contentResolver.openOutputStream(staged.uri, "wt")?.bufferedWriter()?.use { it.write(record.toString(2) + "\n") }
            ?: error("Can't write approval.json in this folder")
    } catch (failure: Throwable) {
        staged.delete()
        throw failure
    }
    val existing = dir.findFile("approval.json")
    val backupName = ".approval-$stamp.previous"
    if (existing != null && !existing.renameTo(backupName)) {
        staged.delete()
        error("Can't replace approval.json safely; the existing approval was left intact")
    }
    if (!staged.renameTo("approval.json")) {
        dir.findFile(backupName)?.renameTo("approval.json")
        staged.delete()
        error("Can't finalize approval.json; the previous approval was restored when possible")
    }
    if (existing != null) dir.findFile(backupName)?.delete()
    return Approval(script.version, script.name, hash, record.getString("approved_at"), note)
}

private fun sha256(text: String): String = MessageDigest.getInstance("SHA-256")
    .digest(text.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(Locale.ROOT, it) }

private fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256")
    .digest(bytes).joinToString("") { "%02x".format(Locale.ROOT, it) }

private fun titleOf(markdown: String): String = markdown.lineSequence().firstOrNull { it.startsWith("# ") }
    ?.removePrefix("# ")?.replace(Regex("^Nou script v\\d+:\\s*", RegexOption.IGNORE_CASE), "")
    ?.replace(Regex("\\s*\\((?:draft|not rendered)[^)]*\\)\\s*$", RegexOption.IGNORE_CASE), "")?.trim().orEmpty().ifBlank { "Untitled script" }

private fun countWords(text: String): Int = Regex("[A-Za-z0-9][A-Za-z0-9'’.,-]*").findAll(text).count()
private fun formatTime(seconds: Int): String = if (seconds >= 60) "${seconds / 60}:${(seconds % 60).toString().padStart(2, '0')}" else "${seconds}s"
