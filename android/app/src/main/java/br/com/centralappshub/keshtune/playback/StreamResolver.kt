package br.com.centralappshub.keshtune.playback

import android.content.Context
import android.net.Uri
import android.os.SystemClock
import androidx.core.net.toUri
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import br.com.centralappshub.keshtune.BuildConfig
import br.com.centralappshub.keshtune.data.MusicRepository
import br.com.centralappshub.keshtune.data.Track
import br.com.centralappshub.keshtune.data.mediaUrl
import br.com.centralappshub.keshtune.data.userMessage
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import java.io.File
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject
import javax.inject.Singleton

/** As faixas entram no player como keshtune://track/<id>; o endereço real do áudio só é pedido na hora de tocar. */
const val TRACK_SCHEME = "keshtune"

fun trackUri(id: String): Uri = "$TRACK_SCHEME://track/$id".toUri()

fun Track.toMediaItem(mediaId: String = id): MediaItem = MediaItem.Builder()
    .setMediaId(mediaId)
    .setUri(trackUri(id))
    .setMediaMetadata(
        MediaMetadata.Builder()
            .setTitle(title)
            .setArtist(artistNames)
            .setAlbumTitle(album?.title)
            .setArtworkUri(mediaUrl(coverUrl)?.toUri())
            .setIsBrowsable(false)
            .setIsPlayable(true)
            .setMediaType(MediaMetadata.MEDIA_TYPE_MUSIC)
            .build()
    )
    .build()

/**
 * Troca o id da faixa pela URL assinada do áudio (válida por 1 h). Faixa do YouTube não toca direto:
 * o servidor converte para MP3 (fila urgente) e aqui esperamos a conversão terminar.
 */
/** Onde ficam as músicas baixadas (pasta privada do app, apagada ao desinstalar). */
object DownloadFiles {
    fun dir(context: Context): File = File(context.filesDir, "downloads").apply { mkdirs() }
    fun file(context: Context, trackId: String): File = File(dir(context), "$trackId.audio")
}

/** Faixa sendo convertida no servidor: na fila (esperando outra conversão) ou já convertendo. */
data class ConvertState(val trackId: String, val queued: Boolean)

@Singleton
class StreamResolver @Inject constructor(
    @ApplicationContext private val context: Context,
    private val repo: MusicRepository,
) {
    private val cache = ConcurrentHashMap<String, Pair<Uri, Long>>()

    private val _converting = MutableStateFlow<ConvertState?>(null)
    /** Faixa que o servidor está convertendo agora (para mostrar "Preparando…"). */
    val converting: StateFlow<ConvertState?> = _converting

    private val _errors = MutableSharedFlow<String>(extraBufferCapacity = 4)
    val errors: SharedFlow<String> = _errors

    /** Roda na thread de carregamento do ExoPlayer, então pode bloquear. */
    fun resolve(trackId: String): Uri {
        // Baixada: toca do arquivo, sem precisar de internet
        DownloadFiles.file(context, trackId).takeIf { it.exists() }?.let { return Uri.fromFile(it) }
        cache[trackId]?.let { (uri, until) -> if (SystemClock.elapsedRealtime() < until) return uri }
        return try {
            runBlocking { remoteUrl(trackId) }.also { cache[trackId] = it to SystemClock.elapsedRealtime() + URL_TTL_MS }
        } catch (e: Exception) {
            val msg = e.userMessage()
            _errors.tryEmit(msg)
            throw IOException(msg, e)
        }
    }

    /**
     * URL assinada do áudio no servidor. Faixa do YouTube para ouvir agora toca direto (o servidor repassa o áudio
     * e converte para MP3 em segundo plano); para baixar, espera a conversão. Servidor antigo sem essa URL: converte antes.
     */
    suspend fun remoteUrl(trackId: String, urgent: Boolean = true): Uri {
        var s = repo.playbackSession(trackId)
        if (s.source == "youtube" && !(urgent && s.url != null)) {
            convert(trackId, urgent)
            s = repo.playbackSession(trackId)
        }
        val url = s.url ?: throw IOException("Áudio indisponível")
        return "${BuildConfig.APP_URL}api/$url".toUri()
    }

    private suspend fun convert(trackId: String, urgent: Boolean) {
        val d = repo.requestDownload(trackId, urgent) ?: throw IOException("Não foi possível preparar a música")
        when (d.status) {
            "done" -> return
            "failed" -> throw IOException(d.error ?: "Não foi possível preparar a música")
        }
        val jobId = d.jobId ?: throw IOException("Não foi possível preparar a música")
        // Só a música que vai tocar aparece como "preparando"; downloads não
        if (urgent) _converting.value = ConvertState(trackId, queued = d.status == "queued")
        try {
            withTimeout(if (urgent) CONVERT_TIMEOUT_MS else DOWNLOAD_TIMEOUT_MS) {
                while (true) {
                    delay(2000)
                    val j = repo.job(jobId)
                    if (urgent && _converting.value?.trackId == trackId) _converting.value = ConvertState(trackId, queued = j?.status == "queued")
                    when (j?.status) {
                        "done" -> return@withTimeout
                        "failed", "canceled" -> throw IOException(j.error ?: "Não foi possível preparar a música")
                    }
                }
            }
        } catch (e: TimeoutCancellationException) {
            throw IOException("O servidor demorou demais para preparar a música")
        } finally {
            if (_converting.value?.trackId == trackId) _converting.value = null
        }
    }

    private companion object {
        const val URL_TTL_MS = 50 * 60 * 1000L
        const val CONVERT_TIMEOUT_MS = 5 * 60 * 1000L
        const val DOWNLOAD_TIMEOUT_MS = 60 * 60 * 1000L
    }
}
