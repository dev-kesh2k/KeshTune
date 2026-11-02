package br.com.centralappshub.keshtune.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.DownloadDone
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Repeat
import androidx.compose.material.icons.filled.RepeatOne
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.min
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.media3.common.Player
import br.com.centralappshub.keshtune.playback.ConvertState

/** Fundo do mini player, criado uma vez só. */
private val MiniBrush = Brush.horizontalGradient(listOf(Color(0xFF2B1D52), Color(0xFF1C1830), Kesh.surface2))

/** Cartão flutuante com a música atual; tocar abre o player em tela cheia. */
@Composable
fun MiniPlayer(vm: PlayerViewModel, onOpen: () -> Unit) {
    val s by vm.state.collectAsStateWithLifecycle()
    val item = s.current ?: return
    val converting by vm.converting.collectAsStateWithLifecycle()
    val meta = item.mediaMetadata
    val shape = RoundedCornerShape(24.dp)

    Box(
        Modifier
            .padding(horizontal = 12.dp, vertical = 8.dp)
            .fillMaxWidth()
            .shadow(4.dp, shape)
            .clip(shape)
            .background(MiniBrush)
            .clickable(onClick = onOpen),
    ) {
        Column {
            Row(Modifier.padding(start = 10.dp, end = 10.dp, top = 10.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Cover(meta.artworkUri?.toString(), 56.dp, shape = RoundedCornerShape(14.dp))
                Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        meta.title?.toString().orEmpty(), style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold,
                        maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        converting.takeIf { it?.trackId == item.mediaId }?.let(::convertText) ?: meta.artist?.toString().orEmpty(),
                        style = MaterialTheme.typography.bodyMedium,
                        color = if (converting?.trackId == item.mediaId) Kesh.accentSoft else Kesh.muted,
                        maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                }
                IconButton(vm.player::previous, Modifier.size(56.dp)) { Icon(Icons.Default.SkipPrevious, "Anterior", Modifier.size(32.dp)) }
                PlayPause(s.isPlaying, s.buffering, 54.dp) { vm.player.toggle() }
                IconButton(vm.player::next, Modifier.size(56.dp)) { Icon(Icons.Default.SkipNext, "Próxima", Modifier.size(32.dp)) }
            }
            MiniProgress(vm, Modifier.padding(horizontal = 18.dp).padding(bottom = 8.dp))
        }
    }
}

/** Progresso do mini player isolado: a posição muda a cada meio segundo e só esta linha é redesenhada. */
@Composable
private fun MiniProgress(vm: PlayerViewModel, modifier: Modifier) {
    val progress = vm.progress.collectAsStateWithLifecycle(0L to 0L)
    ThinProgress({ val (p, d) = progress.value; if (d > 0) p.toFloat() / d else 0f }, modifier)
}

/** Botão branco redondo (tocar/pausar), com indicador enquanto carrega. */
@Composable
private fun PlayPause(playing: Boolean, buffering: Boolean, size: Dp, onClick: () -> Unit) {
    Box(
        Modifier.size(size).clip(CircleShape).background(Color.White).clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        if (buffering && !playing) {
            CircularProgressIndicator(Modifier.size(size * 0.5f), color = Kesh.accent, strokeWidth = 3.dp)
        } else {
            Icon(
                if (playing) Icons.Default.Pause else Icons.Default.PlayArrow, if (playing) "Pausar" else "Tocar",
                tint = Kesh.bg, modifier = Modifier.size(size * 0.58f),
            )
        }
    }
}

@Composable
fun NowPlayingScreen(vm: PlayerViewModel, onClose: () -> Unit) {
    val s by vm.state.collectAsStateWithLifecycle()
    val liked by vm.liked.collectAsStateWithLifecycle()
    val converting by vm.converting.collectAsStateWithLifecycle()
    val item = s.current
    if (item == null) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("Nada tocando", color = Kesh.muted) }
        return
    }
    val meta = item.mediaMetadata
    val artUrl = meta.artworkUri?.toString()

    Box(Modifier.fillMaxSize()) {
        BlurredBackdrop(artUrl, Modifier.fillMaxSize(), strength = 0.7f)
        BoxWithConstraints(Modifier.fillMaxSize().padding(horizontal = 28.dp, vertical = 12.dp)) {
            val w = maxWidth
            val h = maxHeight
            val wide = w > h
            val art: @Composable (Dp) -> Unit = { side ->
                Cover(artUrl, side, modifier = Modifier.shadow(8.dp, RoundedCornerShape(28.dp)), shape = RoundedCornerShape(28.dp))
            }
            val controls: @Composable (Modifier) -> Unit = { mod ->
                Column(mod, verticalArrangement = Arrangement.Center) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(
                                meta.title?.toString().orEmpty(), style = MaterialTheme.typography.headlineLarge,
                                maxLines = 2, overflow = TextOverflow.Ellipsis,
                            )
                            Spacer(Modifier.height(4.dp))
                            Text(
                                meta.artist?.toString().orEmpty(), style = MaterialTheme.typography.titleMedium, color = Kesh.muted,
                                maxLines = 1, overflow = TextOverflow.Ellipsis,
                            )
                        }
                        NowPlayingDownload(item.mediaId, vm)
                        Spacer(Modifier.width(8.dp))
                        Box(
                            Modifier.size(56.dp).clip(CircleShape).background(Color.White.copy(alpha = 0.08f)).clickable(onClick = vm::toggleLike),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(
                                if (liked) Icons.Default.Favorite else Icons.Default.FavoriteBorder,
                                if (liked) "Descurtir" else "Curtir",
                                tint = if (liked) Kesh.accentSoft else Color.White,
                                modifier = Modifier.size(28.dp),
                            )
                        }
                    }
                    converting?.takeIf { it.trackId == item.mediaId }?.let {
                        Text(convertText(it), color = Kesh.accentSoft, modifier = Modifier.padding(top = 8.dp))
                    }
                    Spacer(Modifier.height(18.dp))
                    Seekbar(vm)
                    Spacer(Modifier.height(8.dp))
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly, verticalAlignment = Alignment.CenterVertically) {
                        ToggleIcon(Icons.Default.Shuffle, "Aleatório", s.shuffle, vm.player::toggleShuffle)
                        IconButton(vm.player::previous, Modifier.size(72.dp)) { Icon(Icons.Default.SkipPrevious, "Anterior", Modifier.size(44.dp)) }
                        BigPlay(s.isPlaying, s.buffering) { vm.player.toggle() }
                        IconButton(vm.player::next, Modifier.size(72.dp)) { Icon(Icons.Default.SkipNext, "Próxima", Modifier.size(44.dp)) }
                        ToggleIcon(
                            if (s.repeatMode == Player.REPEAT_MODE_ONE) Icons.Default.RepeatOne else Icons.Default.Repeat,
                            "Repetir", s.repeatMode != Player.REPEAT_MODE_OFF, vm.player::cycleRepeat,
                        )
                    }
                }
            }

            Column(Modifier.fillMaxSize()) {
                Box(
                    Modifier.size(52.dp).clip(CircleShape).background(Color.White.copy(alpha = 0.08f)).clickable(onClick = onClose),
                    contentAlignment = Alignment.Center,
                ) { Icon(Icons.Default.KeyboardArrowDown, "Fechar", Modifier.size(32.dp)) }
                if (wide) {
                    // Tela de carro (deitada): capa à esquerda, controles à direita
                    Row(Modifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) {
                        art(min(h - 80.dp, w * 0.4f))
                        Spacer(Modifier.width(48.dp))
                        controls(Modifier.weight(1f))
                    }
                } else {
                    Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
                        Spacer(Modifier.height(16.dp))
                        art(min(w, h * 0.48f))
                        Spacer(Modifier.height(28.dp))
                        controls(Modifier.fillMaxWidth())
                    }
                }
            }
        }
    }
}

/** Faixa do YouTube: o servidor baixa e converte o áudio antes de tocar (só na primeira vez). */
private fun convertText(c: ConvertState) =
    if (c.queued) "Na fila do servidor, esperando outra conversão…" else "Convertendo a música do YouTube…"

@Composable
private fun BigPlay(playing: Boolean, buffering: Boolean, onClick: () -> Unit) {
    if (buffering && !playing) {
        Box(
            Modifier.size(88.dp).clip(CircleShape).background(Brush.linearGradient(listOf(Kesh.accentSoft, Kesh.accent, Kesh.accentDeep))),
            contentAlignment = Alignment.Center,
        ) { CircularProgressIndicator(Modifier.size(40.dp), color = Color.White, strokeWidth = 3.dp) }
    } else {
        PlayCircle(88.dp, playing = playing, onClick = onClick)
    }
}

@Composable
private fun NowPlayingDownload(trackId: String, vm: PlayerViewModel) {
    val dl = LocalDownloads.current ?: return
    val active by dl.active.collectAsStateWithLifecycle()
    val done by dl.downloaded.collectAsStateWithLifecycle()
    val progress = active[trackId]
    Box(
        Modifier.size(56.dp).clip(CircleShape).background(Color.White.copy(alpha = 0.08f))
            .clickable(enabled = progress == null && trackId !in done, onClick = vm::download),
        contentAlignment = Alignment.Center,
    ) {
        when {
            trackId in done -> Icon(Icons.Default.DownloadDone, "Baixada", tint = Kesh.accentSoft, modifier = Modifier.size(28.dp))
            progress != null && progress > 0f ->
                CircularProgressIndicator(progress = { progress }, modifier = Modifier.size(28.dp), strokeWidth = 3.dp, trackColor = Kesh.line)
            // Mesma regra do DownloadButton: -1f baixando sem porcentagem, 0f na fila
            progress != null && progress < 0f -> CircularProgressIndicator(Modifier.size(28.dp), strokeWidth = 3.dp)
            progress != null -> Icon(Icons.Default.Schedule, "Na fila", tint = Kesh.muted, modifier = Modifier.size(28.dp))
            else -> Icon(Icons.Default.Download, "Baixar", Modifier.size(28.dp))
        }
    }
}

/**
 * Barra e tempos do player. A posição (a cada meio segundo) só é lida no draw da barra e no texto do tempo
 * atual, que recompõe uma vez por segundo; o resto só recompõe quando a duração muda.
 */
@Composable
private fun Seekbar(vm: PlayerViewModel) {
    val progress = vm.progress.collectAsStateWithLifecycle(0L to 0L)
    val dur by remember { derivedStateOf { progress.value.second } }
    var dragging by remember { mutableStateOf<Float?>(null) }
    SeekBar(
        fraction = { val (p, d) = progress.value; if (d > 0) p.toFloat() / d else 0f },
        enabled = dur > 0,
        onSeek = { vm.player.seekTo((it * dur).toLong()) },
        onDrag = { dragging = it },
    )
    Row(Modifier.fillMaxWidth()) {
        CurrentTime(progress) { dragging }
        Spacer(Modifier.weight(1f))
        Text(fmtTime(dur), color = Kesh.muted, style = MaterialTheme.typography.bodyMedium)
    }
}

/** Tempo atual (ou o do ponto arrastado), em segundos inteiros: só recompõe quando o segundo muda. */
@Composable
private fun CurrentTime(progress: State<Pair<Long, Long>>, dragging: () -> Float?) {
    val sec by remember { derivedStateOf { (dragging()?.let { (it * progress.value.second).toLong() } ?: progress.value.first) / 1000 } }
    Text(fmtTime(sec * 1000), color = Kesh.muted, style = MaterialTheme.typography.bodyMedium)
}

@Composable
private fun ToggleIcon(icon: ImageVector, label: String, on: Boolean, onClick: () -> Unit) {
    Box(
        Modifier.size(60.dp).clip(CircleShape).background(if (on) Kesh.accent.copy(alpha = 0.18f) else Color.Transparent).clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, label, tint = if (on) Kesh.accentSoft else Kesh.muted, modifier = Modifier.size(30.dp))
    }
}
