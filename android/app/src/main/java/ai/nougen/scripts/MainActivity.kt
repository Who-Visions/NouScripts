package ai.nougen.scripts

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.documentfile.provider.DocumentFile
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.security.MessageDigest
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

private val Accent = Color(0xFFBC8CFF)
private val Gold = Color(0xFFE7B65A)
private val Warning = Color(0xFFF4C86A)

private data class ScriptVersion(val version: Int, val name: String, val body: String)
private data class Cue(val number: Int, val kind: String, val hint: String, val text: String, val seconds: Int, val flags: List<String>)
private data class Approval(val version: Int, val file: String, val sha256: String, val whenText: String)
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
            primary = Accent,
            secondary = Gold,
            background = Color(0xFF0D0D12),
            surface = Color(0xFF15151D),
            onBackground = Color(0xFFF1F0F5),
            onSurface = Color(0xFFF1F0F5),
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
    var refreshTick by remember { mutableStateOf(0) }

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
                Approval(it.optInt("version"), it.optString("file"), it.optString("sha256"), it.optString("approved_at_eastern", it.optString("approved_at")))
            }
            approvalCurrent = loaded.isCurrent
        }.onFailure { loadError = it.message ?: "Could not read the selected folder" }
        busy = false
    }

    val selected = versions.firstOrNull { it.version == selectedVersion }
    val cues = remember(selected?.body) { selected?.let { parseCues(it.body, context.assets.open("banlist.txt").bufferedReader().use { r -> r.readLines() }) } ?: emptyList() }
    val approvedSelected = approvalCurrent && approval?.version == selected?.version

    if (askApprove && selected != null) {
        AlertDialog(
            onDismissRequest = { askApprove = false },
            title = { Text("Approve v${selected.version}?") },
            text = { Text("This writes a SHA-256 approval record beside ${selected.name}. Any edit to the file makes that approval stale.") },
            confirmButton = {
                TextButton(onClick = {
                    askApprove = false
                    val uri = folderUri ?: return@TextButton
                    scope.launch {
                        val result = withContext(Dispatchers.IO) { runCatching { writeApproval(context, uri, selected) } }
                        result.onFailure { loadError = it.message ?: "Approval could not be saved" }
                        // Reloading the folder recomputes the approval hash from the saved file.
                        folderUri = uri
                        if (result.isSuccess) {
                            val saved = result.getOrNull()
                            approval = saved
                            approvalCurrent = saved?.sha256 == sha256(selected.body)
                        }
                    }
                }) { Text("Approve this version") }
            },
            dismissButton = { TextButton(onClick = { askApprove = false }) { Text("Cancel") } },
        )
    }

    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(modifier = Modifier.fillMaxSize().padding(horizontal = 18.dp, vertical = 16.dp)) {
            Text("Nou Scripts", style = MaterialTheme.typography.labelLarge, color = Accent, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(5.dp))
            Text(selected?.let { titleOf(it.body) } ?: "Review a script", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
            Text(folderName, style = MaterialTheme.typography.bodySmall, color = Color(0xFFAAA8B7))
            Spacer(Modifier.height(14.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                Button(onClick = { folderPicker.launch(folderUri) }) { Text(if (folderUri == null) "Open story folder" else "Change folder") }
                if (folderUri != null) OutlinedButton(onClick = { refreshTick++ }, enabled = !busy) { Text("Refresh") }
                if (busy) Text("Loading…", color = Color(0xFFAAA8B7))
            }
            if (loadError != null) Text(loadError!!, color = Warning, modifier = Modifier.padding(top = 8.dp))
            if (versions.isNotEmpty()) {
                Spacer(Modifier.height(13.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    versions.forEach { v ->
                        if (v.version == selectedVersion) Button(onClick = { selectedVersion = v.version }) { Text("v${v.version}") }
                        else OutlinedButton(onClick = { selectedVersion = v.version }) { Text("v${v.version}") }
                    }
                }
            }
            if (selected != null) {
                val totalWords = cues.sumOf { countWords(it.text) }
                val runtime = (totalWords / 2.8).toInt()
                Spacer(Modifier.height(12.dp))
                Card(colors = CardDefaults.cardColors(containerColor = Color(0xFF17171F))) {
                    Column(Modifier.fillMaxWidth().padding(13.dp)) {
                        Text("${formatTime(runtime)}  ·  $totalWords words  ·  ${cues.size} cues", fontWeight = FontWeight.SemiBold)
                        Spacer(Modifier.height(3.dp))
                        val status = when {
                            approvedSelected -> "v${selected.version} approved for render"
                            approval != null && !approvalCurrent -> "Approval is stale; review and approve again"
                            approval != null -> "v${approval!!.version} approved; v${selected.version} is not approved"
                            else -> "Not approved · rendering stays gated"
                        }
                        Text(status, color = if (approvedSelected) Color(0xFF77D89B) else Warning, style = MaterialTheme.typography.bodySmall)
                    }
                }
                Spacer(Modifier.height(10.dp))
                Button(onClick = { askApprove = true }, enabled = !approvedSelected && !busy, modifier = Modifier.fillMaxWidth()) {
                    Text(if (approvedSelected) "Approved" else "Approve v${selected.version} for render")
                }
                Spacer(Modifier.height(10.dp))
                LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(cues, key = { it.number }) { cue -> CueCard(cue) }
                    if (cues.isEmpty()) item { Text("No numbered cue cards were found in this script.", color = Color(0xFFAAA8B7)) }
                }
            } else if (!busy && loadError == null) {
                Spacer(Modifier.height(18.dp))
                Text("Choose the story folder containing script_v1.md, script_v2.md, and approval.json. The folder stays on this device; no upload occurs.", color = Color(0xFFAAA8B7))
            }
        }
    }
}

@Composable
private fun CueCard(cue: Cue) {
    Card(colors = CardDefaults.cardColors(containerColor = Color(0xFF15151D)), shape = RoundedCornerShape(13.dp)) {
        Column(Modifier.fillMaxWidth().padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("${cue.number}  ·  ${cue.kind}", color = if (cue.kind == "ON CAM") Gold else Accent, fontWeight = FontWeight.Bold)
                Spacer(Modifier.weight(1f))
                Text("${countWords(cue.text)} words · ~${cue.seconds}s", color = Color(0xFFAAA8B7), style = MaterialTheme.typography.labelSmall)
            }
            if (cue.hint.isNotBlank()) Text(cue.hint, color = Color(0xFFAAA8B7), style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(top = 3.dp))
            Spacer(Modifier.height(8.dp))
            Text(cue.text, style = MaterialTheme.typography.bodyLarge, lineHeight = MaterialTheme.typography.bodyLarge.lineHeight * 1.25f)
            if (cue.flags.isNotEmpty()) {
                Spacer(Modifier.height(8.dp))
                Text("Review wording: ${cue.flags.joinToString()}", color = Warning, style = MaterialTheme.typography.labelSmall,
                    modifier = Modifier.background(Color(0x22F4C86A), RoundedCornerShape(6.dp)).padding(horizontal = 8.dp, vertical = 5.dp))
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
        val flags = terms.filter { term -> Regex("""(?i)(?<![\p{L}\p{N}])${Regex.escape(term.trim())}(?![\p{L}\p{N}])""").containsMatchIn(text) }.distinct()
        Cue(cue.number, if (cue.kind.contains("ON CAM")) "ON CAM" else cue.kind, cue.hint, text,
            (countWords(text) / 2.8).toInt().coerceAtLeast(1), flags)
    }
}

private data class MutableCue(val number: Int, val kind: String, val hint: String, val text: MutableList<String> = mutableListOf())

private fun writeApproval(context: android.content.Context, folderUri: Uri, script: ScriptVersion): Approval {
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
        .put("note", "")
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
    return Approval(script.version, script.name, hash, record.getString("approved_at"))
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
