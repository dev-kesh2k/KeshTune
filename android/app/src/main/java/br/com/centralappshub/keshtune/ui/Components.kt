package br.com.centralappshub.keshtune.ui

import android.graphics.Bitmap
import android.os.Build
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyListPrefetchStrategy
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
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
import androidx.compose.material.icons.filled.Schedule
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
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.ScaleFactor
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import br.com.centralappshub.keshtune.data.AlbumCard
import br.com.centralappshub.keshtune.data.ArtistCard
import br.com.centralappshub.keshtune.data.MixCard
import br.com.centralappshub.keshtune.data.PlaylistCard
import br.com.centralappshub.keshtune.data.Track
import br.com.centralappshub.keshtune.data.mediaUrl
import br.com.centralappshub.keshtune.data.ytSmallCover
import br.com.centralappshub.keshtune.playback.DownloadManager
import coil3.compose.AsyncImage
import coil3.compose.AsyncImagePainter
import coil3.compose.LocalPlatformContext
import coil3.request.ImageRequest
import coil3.request.transformations
import coil3.size.Precision
import coil3.transform.Transformation
import kotlin.math.max

// Pincéis e cores fixos, criados uma vez só e não a cada quadro ou recomposição
private val CoverBrush = Brush.linearGradient(listOf(Kesh.surface2, Kesh.accentDeep.copy(alpha = 0.35f)))
private val ThinTrack = Color.White.copy(alpha = 0.12f)
private val SeekTrack = Color.White.copy(alpha = 0.16f)
private val SeekFill = Brush.horizontalGradient(listOf(Kesh.accent, Kesh.accentSoft))

/**
 * Capa arredondada. O fundo em degradê com a nota só é desenhado enquanto a imagem não carregou,
 * e direto no draw (sem Icon nem Box a mais): numa lista cheia de capas isso pesa.
 */
@Composable
fun Cover(url: String?, size: Dp, modifier: Modifier = Modifier, shape: Shape = RoundedCornerShape(14.dp)) {
    val loaded = remember(url) { mutableStateOf(false) }
    val note = rememberVectorPainter(Icons.Default.MusicNote)
    val tint = remember { ColorFilter.tint(Kesh.muted) }
    Box(
        modifier.size(size).clip(shape).drawBehind {
            // Estado lido só aqui: a imagem carregar redesenha a capa, mas não recompõe
            if (!loaded.value) {
                drawRect(CoverBrush)
                val s = this.size.minDimension / 3f
                translate((this.size.width - s) / 2f, (this.size.height - s) / 2f) {
                    with(note) { draw(Size(s, s), colorFilter = tint) }
                }
            }
        },
    ) {
        CoverImage(url, Modifier.fillMaxSize(), small = size <= 64.dp, onLoaded = { loaded.value = it })
    }
}

/**
 * Recorte das capas hqdefault do YouTube: amplia 34% além do Crop para tirar as faixas pretas
 * (como o app web), sem o graphicsLayer de antes, que criava uma camada por capa.
 */
private object YtHqCrop : ContentScale {
    override fun computeScaleFactor(srcSize: Size, dstSize: Size): ScaleFactor {
        val s = max(dstSize.width / srcSize.width, dstSize.height / srcSize.height) * 1.34f
        return ScaleFactor(s, s)
    }
}

/**
 * Imagem da capa. Nas pequenas (listas, mini player), as do YouTube usam a mqdefault (320x180, já 16:9 e sem
 * faixas pretas): baixa e decodifica bem menos que a hqdefault. [onLoaded] diz se a imagem chegou.
 */
@Composable
fun CoverImage(url: String?, modifier: Modifier = Modifier, small: Boolean = false, onLoaded: ((Boolean) -> Unit)? = null) {
    val full = mediaUrl(url)
    // Mesma URL pequena que o DownloadManager e o preloadNext aquecem no disco (capa sem internet)
    val mq = remember(full) { ytSmallCover(full) }
    val hq = mq != null
    val model = if (small && mq != null) mq else full
    val onState: ((AsyncImagePainter.State) -> Unit)? = remember(onLoaded) {
        onLoaded?.let { cb -> { st: AsyncImagePainter.State -> cb(st is AsyncImagePainter.State.Success) } }
    }
    AsyncImage(
        model = model,
        contentDescription = null,
        contentScale = if (hq && !small) YtHqCrop else ContentScale.Crop,
        modifier = modifier,
        onState = onState,
    )
}

/**
 * Fundo com a capa desfocada (Android 12+) e um degradê até a cor do app.
 * Em vez do Modifier.blur (RenderEffect na área toda a cada quadro), a capa é decodificada com 64 px,
 * desfocada uma vez só na CPU e guardada no cache; ampliada na tela, fica tão borrada quanto antes.
 * O guard de versão continua só para manter o visual de antes no Android 7 a 11.
 */
@Composable
fun BlurredBackdrop(url: String?, modifier: Modifier = Modifier, strength: Float = 0.55f) {
    val withImage = Build.VERSION.SDK_INT >= 31 && !url.isNullOrBlank()
    Box(modifier) {
        if (withImage) {
            val ctx = LocalPlatformContext.current
            // Capa do YouTube: a mqdefault, já 16:9 e sem as faixas pretas da hqdefault (e de sobra para 64 px)
            val full = mediaUrl(url).let { ytSmallCover(it) ?: it }
            AsyncImage(
                model = remember(full) {
                    ImageRequest.Builder(ctx)
                        .data(full)
                        .size(64)
                        .precision(Precision.INEXACT)
                        .memoryCacheKey("$full#bg")
                        .transformations(TinyBlurTransformation)
                        .build()
                },
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.matchParentSize().graphicsLayer(alpha = strength),
            )
        }
        Box(
            Modifier.matchParentSize().background(
                Brush.verticalGradient(
                    listOf(Kesh.accentDeep.copy(alpha = if (withImage) 0.25f else 0.45f), Kesh.bg.copy(alpha = 0.7f), Kesh.bg),
                )
            )
        )
    }
}

/** Desfoque barato para imagens minúsculas: 3 passadas de box blur (raio 4) na horizontal e na vertical, quase um gaussiano. */
private object TinyBlurTransformation : Transformation() {
    private const val RADIUS = 4
    override val cacheKey = "tinyBlur8"

    override suspend fun transform(input: Bitmap, size: coil3.size.Size): Bitmap {
        val bmp = if (input.config == Bitmap.Config.ARGB_8888 && input.isMutable) input else input.copy(Bitmap.Config.ARGB_8888, true)
        val w = bmp.width
        val h = bmp.height
        if (w < 2 || h < 2) return bmp
        val px = IntArray(w * h)
        val tmp = IntArray(w * h)
        bmp.getPixels(px, 0, w, 0, 0, w, h)
        repeat(3) {
            boxBlur(px, tmp, w, h, horizontal = true)
            boxBlur(tmp, px, w, h, horizontal = false)
        }
        bmp.setPixels(px, 0, w, 0, 0, w, h)
        return bmp
    }

    /** Média móvel de 2*RADIUS+1 pixels em cada linha (ou coluna), repetindo a borda; canal a canal, alfa incluído. */
    private fun boxBlur(src: IntArray, dst: IntArray, w: Int, h: Int, horizontal: Boolean) {
        val lines = if (horizontal) h else w
        val len = if (horizontal) w else h
        val step = if (horizontal) 1 else w
        val div = 2 * RADIUS + 1
        for (line in 0 until lines) {
            val base = if (horizontal) line * w else line
            var a = 0
            var r = 0
            var g = 0
            var b = 0
            for (i in -RADIUS..RADIUS) {
                val c = src[base + i.coerceIn(0, len - 1) * step]
                a += c ushr 24; r += (c shr 16) and 0xFF; g += (c shr 8) and 0xFF; b += c and 0xFF
            }
            for (i in 0 until len) {
                dst[base + i * step] = ((a / div) shl 24) or ((r / div) shl 16) or ((g / div) shl 8) or (b / div)
                val out = src[base + (i - RADIUS).coerceAtLeast(0) * step]
                val inn = src[base + (i + RADIUS + 1).coerceAtMost(len - 1) * step]
                a += (inn ushr 24) - (out ushr 24)
                r += ((inn shr 16) and 0xFF) - ((out shr 16) and 0xFF)
                g += ((inn shr 8) and 0xFF) - ((out shr 8) and 0xFF)
                b += (inn and 0xFF) - (out and 0xFF)
            }
        }
    }
}

/** Tempo m:ss. Sem String.format, que é lento (cria um Formatter e consulta o Locale) e roda a cada segundo. */
fun fmtTime(ms: Long): String {
    val s = (ms.coerceAtLeast(0) / 1000).toInt()
    val m = s / 60
    val r = s % 60
    return if (r < 10) "$m:0$r" else "$m:$r"
}

/** Fila de downloads, disponível para qualquer tela (vem da MainActivity). */
val LocalDownloads = staticCompositionLocalOf<DownloadManager?> { null }

/** Baixar / na fila (0f) / baixando (com progresso, ou -1f sem porcentagem) / baixada. */
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
            // Indeterminado só quando está baixando de fato: dezenas deles girando na fila pesam na central
            progress != null && progress < 0f -> CircularProgressIndicator(Modifier.size(size / 2), strokeWidth = 3.dp)
            progress != null -> Icon(Icons.Default.Schedule, "Na fila", tint = Kesh.muted, modifier = Modifier.size(size / 2))
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
        // Sem sombra (cara de desenhar em dezenas de cards durante a rolagem); só um contorno sutil
        val shape = if (round) CircleShape else RoundedCornerShape(18.dp)
        Cover(image, 156.dp, modifier = Modifier.border(1.dp, Color.White.copy(alpha = 0.06f), shape), shape = shape)
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
fun MixCardView(m: MixCard, onClick: () -> Unit) = Card(m.imageUrl, m.title, m.subtitle, onClick = onClick)

@Composable
fun ArtistCardView(a: ArtistCard, onClick: () -> Unit) = Card(a.imageUrl, a.name, "Artista", round = true, onClick = onClick)

/**
 * Prateleira horizontal com título, usada na Início, na Busca e no artista. Ao rolar a lista de fora,
 * a prateleira que vai entrar já pré-compõe os primeiros 8 cards (o padrão é 2), evitando o tranco.
 */
@OptIn(ExperimentalFoundationApi::class)
fun <T> LazyListScope.shelf(title: String, items: List<T>, card: @Composable (T) -> Unit) {
    if (items.isEmpty()) return
    item(key = "shelf:$title", contentType = "shelf") {
        Column(Modifier.padding(bottom = 16.dp)) {
            SectionTitle(title)
            val rowState = rememberLazyListState(prefetchStrategy = remember { LazyListPrefetchStrategy(nestedPrefetchItemCount = 8) })
            LazyRow(state = rowState, contentPadding = PaddingValues(horizontal = 10.dp)) {
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

/** Botão redondo com degradê roxo (tocar). O brilho em volta é um degradê desenhado, não uma sombra. */
@Composable
fun PlayCircle(size: Dp, playing: Boolean = false, enabled: Boolean = true, onClick: () -> Unit) {
    Box(
        Modifier
            .size(size)
            .drawWithCache {
                // A sombra colorida de antes nem pegava a cor abaixo da API 28; este halo vale em todas
                val r = this.size.minDimension * 0.75f
                val c = Offset(this.size.width / 2f, this.size.height / 2f)
                val halo = Brush.radialGradient(listOf(Kesh.accent.copy(alpha = .35f), Color.Transparent), center = c, radius = r)
                onDrawBehind { drawCircle(halo, radius = r) }
            }
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
                Cover(image, 180.dp, modifier = Modifier.shadow(8.dp, imageShape), shape = imageShape)
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

/**
 * Barra de progresso arredondada e arrastável (o Slider padrão tem o marcador quadrado).
 * [fraction] é lido só no draw, numa camada própria: o progresso andando redesenha a barra sem recompor nada.
 */
@Composable
fun SeekBar(fraction: () -> Float, enabled: Boolean, onSeek: (Float) -> Unit, modifier: Modifier = Modifier, onDrag: (Float?) -> Unit = {}) {
    var drag by remember { mutableStateOf<Float?>(null) }
    // Sempre a versão mais nova dos callbacks (com a duração da faixa atual), sem reiniciar os gestos
    val seek by rememberUpdatedState(onSeek)
    val dragCb by rememberUpdatedState(onDrag)
    Spacer(
        modifier
            .fillMaxWidth()
            .height(32.dp)
            .pointerInput(enabled) {
                if (!enabled) return@pointerInput
                detectTapGestures {
                    // Toque solto: zera qualquer arraste que tenha sobrado e pula direto para o ponto
                    drag = null
                    dragCb(null)
                    seek((it.x / size.width).coerceIn(0f, 1f))
                }
            }
            .pointerInput(enabled) {
                if (!enabled) return@pointerInput
                detectHorizontalDragGestures(
                    onDragStart = { drag = (it.x / size.width).coerceIn(0f, 1f); dragCb(drag) },
                    onDragEnd = { drag?.let(seek); drag = null; dragCb(null) },
                    onDragCancel = { drag = null; dragCb(null) },
                ) { change, _ ->
                    drag = (change.position.x / size.width).coerceIn(0f, 1f)
                    dragCb(drag)
                }
            }
            .graphicsLayer()
            .drawBehind {
                val f = (drag ?: fraction()).coerceIn(0f, 1f)
                val trackH = 6.dp.toPx()
                val cy = size.height / 2f
                val top = cy - trackH / 2f
                val corner = CornerRadius(trackH / 2f)
                drawRoundRect(SeekTrack, Offset(0f, top), Size(size.width, trackH), corner)
                val fill = size.width * f
                if (fill > 0f) drawRoundRect(SeekFill, Offset(0f, top), Size(fill, trackH), corner)
                val thumb = (if (drag != null) 10.dp else 7.dp).toPx()
                val x = fill.coerceIn(thumb, (size.width - thumb).coerceAtLeast(thumb))
                // Sombra barata: um círculo escuro um pouco maior e 1 dp abaixo, em vez de shadow()
                drawCircle(Color.Black.copy(alpha = 0.25f), radius = thumb + 2.dp.toPx(), center = Offset(x, cy + 1.dp.toPx()))
                drawCircle(Color.White, radius = thumb, center = Offset(x, cy))
            },
    )
}

/** Linha fina de progresso (mini player). [fraction] é lido só no draw. */
@Composable
fun ThinProgress(fraction: () -> Float, modifier: Modifier = Modifier) {
    Spacer(
        modifier.fillMaxWidth().height(3.dp).drawBehind {
            val r = CornerRadius(size.height / 2)
            drawRoundRect(ThinTrack, cornerRadius = r)
            val w = size.width * fraction().coerceIn(0f, 1f)
            if (w > 0f) {
                drawRoundRect(
                    Brush.horizontalGradient(listOf(Kesh.accent, Kesh.accentSoft), startX = 0f, endX = w),
                    size = Size(w, size.height), cornerRadius = r,
                )
            }
        },
    )
}
