package br.com.centralappshub.keshtune.ui

import android.os.Build
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.DownloadDone
import androidx.compose.material.icons.filled.GraphicEq
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import br.com.centralappshub.keshtune.data.AlbumCard
import br.com.centralappshub.keshtune.data.ArtistCard
import br.com.centralappshub.keshtune.data.PlaylistCard
import br.com.centralappshub.keshtune.data.Track
import br.com.centralappshub.keshtune.data.mediaUrl
import br.com.centralappshub.keshtune.playback.DownloadManager
import coil3.compose.AsyncImage

/** Capa arredondada. As do YouTube vêm 4:3 com faixas pretas: amplia para recortar (como o app web). */
@Composable
fun Cover(url: String?, size: Dp, modifier: Modifier = Modifier, shape: Shape = RoundedCornerShape(14.dp)) {
    Box(
        modifier.size(size).clip(shape).background(Brush.linearGradient(listOf(Kesh.surface2, Kesh.accentDeep.copy(alpha = 0.35f)))),
        contentAlignment = Alignment.Center,
    ) {
        Icon(Icons.Default.MusicNote, null, tint = Kesh.muted, modifier = Modifier.size(size / 3))
        CoverImage(url, Modifier.fillMaxSize())
    }
}

@Composable
fun CoverImage(url: String?, modifier: Modifier = Modifier) {
    val full = mediaUrl(url)
    val zoom = if (full?.contains("i.ytimg.com") == true) 1.34f else 1f
    AsyncImage(
        model = full,
        contentDescription = null,
        contentScale = ContentScale.Crop,
        modifier = modifier.graphicsLayer(scaleX = zoom, scaleY = zoom),
    )
}

/** Fundo com a capa desfocada (Android 12+) e um degradê até a cor do app. */
@Composable
fun BlurredBackdrop(url: String?, modifier: Modifier = Modifier, strength: Float = 0.55f) {
    Box(modifier) {
        if (Build.VERSION.SDK_INT >= 31) {
            CoverImage(url, Modifier.matchParentSize().blur(70.dp).graphicsLayer(alpha = strength))
        }
        Box(
            Modifier.matchParentSize().background(
                Brush.verticalGradient(
                    listOf(Kesh.accentDeep.copy(alpha = if (Build.VERSION.SDK_INT >= 31) 0.25f else 0.45f), Kesh.bg.copy(alpha = 0.7f), Kesh.bg),
                )
            )
        )
    }
}

fun fmtTime(ms: Long): String {
    val s = (ms.coerceAtLeast(0) / 1000).toInt()
    return "%d:%02d".format(s / 60, s % 60)
}

/** Fila de downloads, disponível para qualquer tela (vem da MainActivity). */
val LocalDownloads = staticCompositionLocalOf<DownloadManager?> { null }

/** Baixar / baixando (com progresso) / baixada. */
@Composable
fun DownloadButton(track: Track, size: Dp = 48.dp) {
    val dl = LocalDownloads.current ?: return
    if (!track.playable) return
    val active by dl.active.collectAsStateWithLifecycle()
    val done by dl.downloaded.collectAsStateWithLifecycle()
    val progress = active[track.id]
    Box(Modifier.size(size), contentAlignment = Alignment.Center) {
        when {
            track.id in done -> Icon(Icons.Default.DownloadDone, "Baixada", tint = Kesh.accentSoft, modifier = Modifier.size(size / 2))
            progress != null && progress > 0f ->
                CircularProgressIndicator(progress = { progress }, modifier = Modifier.size(size / 2), strokeWidth = 3.dp, trackColor = Kesh.line)
            progress != null -> CircularProgressIndicator(Modifier.size(size / 2), strokeWidth = 3.dp)
            else -> IconButton({ dl.enqueue(listOf(track)) }, Modifier.size(size)) {
                Icon(Icons.Default.Download, "Baixar", tint = Kesh.muted, modifier = Modifier.size(size / 2))
            }
        }
    }
}

@Composable
fun TrackRow(track: Track, playing: Boolean, trailing: (@Composable () -> Unit)? = null, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 10.dp, vertical = 2.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(if (playing) Kesh.accent.copy(alpha = 0.14f) else Color.Transparent)
            .clickable(enabled = track.playable, onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(contentAlignment = Alignment.Center) {
            Cover(track.coverUrl, 56.dp, shape = RoundedCornerShape(12.dp))
            if (playing) {
                Box(Modifier.size(56.dp).clip(RoundedCornerShape(12.dp)).background(Color.Black.copy(alpha = 0.45f)))
                Icon(Icons.Default.GraphicEq, "Tocando", tint = Kesh.accentSoft, modifier = Modifier.size(28.dp))
            }
        }
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(
                track.title,
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.SemiBold,
                color = when {
                    !track.playable -> Kesh.muted
                    playing -> Kesh.accentSoft
                    else -> MaterialTheme.colorScheme.onBackground
                },
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (track.isYoutube) {
                    // Do YouTube: o servidor converte na primeira vez que toca
                    Icon(Icons.Default.Cloud, "Online", tint = Kesh.muted, modifier = Modifier.size(14.dp))
                    Spacer(Modifier.width(4.dp))
                }
                Text(
                    track.unavailableReason ?: track.artistNames,
                    style = MaterialTheme.typography.bodyMedium,
                    color = Kesh.muted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        if (track.durationMs > 0) {
            Text(fmtTime(track.durationMs), color = Kesh.muted, style = MaterialTheme.typography.bodyMedium)
        }
        Spacer(Modifier.width(4.dp))
        if (trailing != null) trailing() else DownloadButton(track)
    }
}

@Composable
private fun Card(image: String?, title: String, subtitle: String?, round: Boolean = false, onClick: () -> Unit) {
    Column(
        Modifier
            .width(172.dp)
            .clip(RoundedCornerShape(20.dp))
            .clickable(onClick = onClick)
            .padding(8.dp),
        horizontalAlignment = if (round) Alignment.CenterHorizontally else Alignment.Start,
    ) {
        Cover(
            image, 156.dp,
            modifier = Modifier.shadow(10.dp, if (round) CircleShape else RoundedCornerShape(18.dp)),
            shape = if (round) CircleShape else RoundedCornerShape(18.dp),
        )
        Spacer(Modifier.height(10.dp))
        Text(title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (!subtitle.isNullOrBlank()) {
            Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = Kesh.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
fun TrackCard(t: Track, onClick: () -> Unit) = Card(t.coverUrl, t.title, t.artistNames, onClick = onClick)

@Composable
fun AlbumCardView(a: AlbumCard, onClick: () -> Unit) = Card(a.coverUrl, a.title, a.artists.joinToString(", ") { it.name }, onClick = onClick)

@Composable
fun PlaylistCardView(p: PlaylistCard, onClick: () -> Unit) = Card(p.image, p.name, p.ownerName, onClick = onClick)

@Composable
fun ArtistCardView(a: ArtistCard, onClick: () -> Unit) = Card(a.imageUrl, a.name, "Artista", round = true, onClick = onClick)

/** Prateleira horizontal com título, usada na Início, na Busca e no artista. */
fun <T> LazyListScope.shelf(title: String, items: List<T>, card: @Composable (T) -> Unit) {
    if (items.isEmpty()) return
    item(key = "shelf:$title") {
        Column(Modifier.padding(bottom = 16.dp)) {
            SectionTitle(title)
            LazyRow(contentPadding = PaddingValues(horizontal = 10.dp)) {
                items(items) { card(it) }
            }
        }
    }
}

@Composable
fun SectionTitle(title: String) {
    Text(title, style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(start = 18.dp, end = 18.dp, top = 14.dp, bottom = 8.dp))
}

@Composable
fun Loading() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
}

@Composable
fun ErrorBox(message: String, onRetry: () -> Unit) {
    Column(
        Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(message, style = MaterialTheme.typography.bodyLarge, color = Kesh.muted)
        Spacer(Modifier.height(16.dp))
        Button(onClick = onRetry) { Text("Tentar de novo") }
    }
}

/** Botão redondo com degradê roxo (tocar). */
@Composable
fun PlayCircle(size: Dp, playing: Boolean = false, enabled: Boolean = true, onClick: () -> Unit) {
    Box(
        Modifier
            .size(size)
            .shadow(16.dp, CircleShape, ambientColor = Kesh.accent, spotColor = Kesh.accent)
            .clip(CircleShape)
            .background(Brush.linearGradient(listOf(Kesh.accentSoft, Kesh.accent, Kesh.accentDeep)))
            .clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            if (playing) Icons.Default.Pause else Icons.Default.PlayArrow,
            if (playing) "Pausar" else "Tocar",
            tint = Color.White,
            modifier = Modifier.size(size * 0.55f),
        )
    }
}

/** Botão redondo secundário (aleatório, baixar...). */
@Composable
fun RoundIconButton(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, size: Dp = 52.dp, enabled: Boolean = true, onClick: () -> Unit) {
    Box(
        Modifier
            .size(size)
            .clip(CircleShape)
            .background(Color.White.copy(alpha = 0.08f))
            .clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, label, tint = if (enabled) Color.White else Kesh.muted, modifier = Modifier.size(size * 0.48f))
    }
}

/** Cabeçalho de álbum, playlist ou curtidas: capa sobre fundo desfocado, título e botões. */
@Composable
fun CollectionHeader(
    image: String?,
    kind: String,
    title: String,
    subtitle: String?,
    enabled: Boolean,
    onPlay: () -> Unit,
    onShuffle: () -> Unit,
    onDownload: (() -> Unit)? = null,
    imageShape: Shape = RoundedCornerShape(22.dp),
    art: (@Composable (Dp) -> Unit)? = null,
) {
    Box(Modifier.fillMaxWidth()) {
        BlurredBackdrop(image, Modifier.matchParentSize())
        Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 22.dp), verticalAlignment = Alignment.CenterVertically) {
            if (art != null) {
                art(180.dp)
            } else {
                Cover(image, 180.dp, modifier = Modifier.shadow(24.dp, imageShape), shape = imageShape)
            }
            Spacer(Modifier.width(24.dp))
            Column(Modifier.weight(1f)) {
                Text(kind.uppercase(), style = MaterialTheme.typography.labelLarge, color = Kesh.accentSoft)
                Spacer(Modifier.height(4.dp))
                Text(title, style = MaterialTheme.typography.headlineLarge, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (!subtitle.isNullOrBlank()) {
                    Text(subtitle, style = MaterialTheme.typography.bodyLarge, color = Kesh.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Spacer(Modifier.height(18.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    PlayCircle(64.dp, enabled = enabled, onClick = onPlay)
                    RoundIconButton(Icons.Default.Shuffle, "Aleatório", enabled = enabled, onClick = onShuffle)
                    if (onDownload != null) RoundIconButton(Icons.Default.Download, "Baixar tudo", enabled = enabled, onClick = onDownload)
                }
            }
        }
    }
}

/** Barra de progresso arredondada e arrastável (o Slider padrão tem o marcador quadrado). */
@Composable
fun SeekBar(fraction: Float, enabled: Boolean, onSeek: (Float) -> Unit, modifier: Modifier = Modifier, onDrag: (Float?) -> Unit = {}) {
    var drag by remember { mutableStateOf<Float?>(null) }
    val shown = (drag ?: fraction).coerceIn(0f, 1f)
    BoxWithConstraints(
        modifier
            .fillMaxWidth()
            .height(32.dp)
            .pointerInput(enabled) {
                if (!enabled) return@pointerInput
                detectTapGestures { onSeek((it.x / size.width).coerceIn(0f, 1f)) }
            }
            .pointerInput(enabled) {
                if (!enabled) return@pointerInput
                detectHorizontalDragGestures(
                    onDragStart = { drag = (it.x / size.width).coerceIn(0f, 1f); onDrag(drag) },
                    onDragEnd = { drag?.let(onSeek); drag = null; onDrag(null) },
                    onDragCancel = { drag = null; onDrag(null) },
                ) { change, _ ->
                    drag = (change.position.x / size.width).coerceIn(0f, 1f)
                    onDrag(drag)
                }
            },
        contentAlignment = Alignment.CenterStart,
    ) {
        val thumb = if (drag != null) 20.dp else 14.dp
        Box(Modifier.fillMaxWidth().height(6.dp).clip(CircleShape).background(Color.White.copy(alpha = 0.16f)))
        Box(
            Modifier.fillMaxWidth(shown).height(6.dp).clip(CircleShape)
                .background(Brush.horizontalGradient(listOf(Kesh.accent, Kesh.accentSoft)))
        )
        val x = (maxWidth * shown - thumb / 2).coerceIn(0.dp, maxWidth - thumb)
        Box(Modifier.offset(x = x).size(thumb).shadow(6.dp, CircleShape).clip(CircleShape).background(Color.White))
    }
}

/** Linha fina de progresso (mini player). */
@Composable
fun ThinProgress(fraction: Float, modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().height(3.dp).clip(CircleShape).background(Color.White.copy(alpha = 0.12f))) {
        Box(
            Modifier.fillMaxWidth(fraction.coerceIn(0f, 1f)).fillMaxHeight()
                .background(Brush.horizontalGradient(listOf(Kesh.accent, Kesh.accentSoft)))
        )
    }
}
