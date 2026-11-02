@file:OptIn(UnstableApi::class)

package br.com.centralappshub.keshtune.playback

import android.content.Context
import android.net.Uri
import android.os.SystemClock
import android.util.LruCache
import androidx.core.net.toUri
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSourceException
import androidx.media3.datasource.cache.ContentMetadata
import androidx.media3.datasource.cache.SimpleCache
import br.com.centralappshub.keshtune.BuildConfig
import br.com.centralappshub.keshtune.data.MusicRepository
import br.com.centralappshub.keshtune.data.PlaybackSession
import br.com.centralappshub.keshtune.data.Track
import br.com.centralappshub.keshtune.data.mediaUrl
import br.com.centralappshub.keshtune.data.userMessage
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import java.io.File
import java.io.IOException
import java.net.SocketTimeoutException
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
    // Lazy: o resolver nasce na Main (injeção da MainActivity); o cache só é aberto na thread de carregamento
    private val audioCache: dagger.Lazy<SimpleCache>,
) {
    /** URLs assinadas já obtidas: id da faixa -> (URL, quando foi obtida em elapsedRealtime). Thread-safe. */
    private val urls = LruCache<String, Pair<Uri, Long>>(64)

    private val prefetchScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    /** Pedidos adiantados em andamento, por faixa (vários ao mesmo tempo: quem pula duas seguidas não espera). */
    private val prefetching = java.util.concurrent.ConcurrentHashMap<String, Job>()

    private val _converting = MutableStateFlow<ConvertState?>(null)
    /** Faixa que o servidor está convertendo agora (para mostrar "Preparando…"). */
    val converting: StateFlow<ConvertState?> = _converting

    private val _errors = MutableSharedFlow<String>(extraBufferCapacity = 4)
    val errors: SharedFlow<String> = _errors

    /** Roda na thread de carregamento do ExoPlayer, então pode bloquear. */
    fun resolve(trackId: String): Uri {
        // Baixada: toca do arquivo, sem precisar de internet
        DownloadFiles.file(context, trackId).takeIf { it.exists() }?.let { return Uri.fromFile(it) }
        fresh(trackId, URL_TTL_MS)?.let { return it }
        return try {
            runBlocking { remoteUrl(trackId) }.also { urls.put(trackId, it to SystemClock.elapsedRealtime()) }
        } catch (e: Exception) {
            if (e.isNetworkError()) {
                // Sem rede: a URL ainda assinada serve para o que já está no cache de áudio (a chave ignora a assinatura)
                fresh(trackId, STALE_URL_MS)?.let { return it }
                cachedAudio(trackId)?.let { return it }
                // Sem aviso na tela: o player fica esperando a conexão voltar e tenta de novo sozinho
                throw DataSourceException("Sem conexão", e, PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED)
            }
            val msg = e.userMessage()
            _errors.tryEmit(msg)
            throw IOException(msg, e)
        }
    }

    /**
     * Pede antes a URL da próxima faixa, para a troca de música não esperar o servidor
     * (e o servidor já começa a preparar o áudio do YouTube).
     */
    fun prefetch(trackIds: List<String>) {
        // Desiste das que saíram da lista (pulou para longe); as que continuam seguem sem recomeçar
        prefetching.keys.filter { it !in trackIds }.forEach { prefetching.remove(it)?.cancel() }
        for (trackId in trackIds) {
            if (prefetching[trackId]?.isActive == true) continue
            prefetching[trackId] = prefetchScope.launch {
                try {
                    if (DownloadFiles.file(context, trackId).exists() || fresh(trackId, URL_TTL_MS) != null) return@launch
                    runCatching {
                        // Só a URL: faixa de servidor antigo que exige conversão não é convertida aqui (mostraria "Preparando…")
                        val url = session(trackId).url ?: return@launch
                        urls.put(trackId, "${BuildConfig.APP_URL}api/$url".toUri() to SystemClock.elapsedRealtime())
                    }
                } finally {
                    prefetching.remove(trackId, coroutineContext[Job])
                }
            }
        }
    }

    private fun fresh(trackId: String, maxAgeMs: Long): Uri? =
        urls.get(trackId)?.takeIf { SystemClock.elapsedRealtime() - it.second < maxAgeMs }?.first

    /** Faixa já ouvida inteira pela rede: o cache de áudio toca sem internet. Devolve a chave do cache como URI. */
    private fun cachedAudio(trackId: String): Uri? {
        val cache = audioCache.get()
        for (key in listOf("${BuildConfig.APP_URL}api/stream/$trackId", "${BuildConfig.APP_URL}api/youtube/stream/$trackId")) {
            val len = ContentMetadata.getContentLength(cache.getContentMetadata(key))
            if (len > 0 && cache.isCached(key, 0, len)) return Uri.parse(key)
        }
        return null
    }

    /** Resposta da sessão de reprodução com prazo: sem rede, falha logo em vez de prender a troca de faixa. */
    private suspend fun session(trackId: String): PlaybackSession = try {
        withTimeout(SESSION_TIMEOUT_MS) { repo.playbackSession(trackId) }
    } catch (e: TimeoutCancellationException) {
        // SocketTimeoutException (um IOException) para contar como falta de rede em isNetworkError()
        throw SocketTimeoutException("Sem conexão com o servidor").apply { initCause(e) }
    }

    /**
     * URL assinada do áudio no servidor. Faixa do YouTube para ouvir agora toca direto (o servidor repassa o áudio
     * e converte para MP3 em segundo plano); para baixar, espera a conversão. Servidor antigo sem essa URL: converte antes.
     */
    suspend fun remoteUrl(trackId: String, urgent: Boolean = true): Uri {
        var s = session(trackId)
        if (s.source == "youtube" && !(urgent && s.url != null)) {
            convert(trackId, urgent)
            s = session(trackId)
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
                // Quem espera para ouvir consulta a cada 2 s; download em segundo plano espaça até 30 s (menos rede e bateria)
                var wait = 2000L
                while (true) {
                    delay(wait)
                    if (!urgent) wait = minOf(wait * 2, 30_000L)
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
        /** Sem rede, a URL assinada (válida por 1 h) ainda pode ser usada até perto de expirar. */
        const val STALE_URL_MS = 58 * 60 * 1000L
        const val SESSION_TIMEOUT_MS = 10_000L
        const val CONVERT_TIMEOUT_MS = 5 * 60 * 1000L
        const val DOWNLOAD_TIMEOUT_MS = 20 * 60 * 1000L
    }
}
