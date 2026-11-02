package br.com.centralappshub.keshtune.playback

import android.content.Context
import br.com.centralappshub.keshtune.data.MusicRepository
import br.com.centralappshub.keshtune.data.Track
import br.com.centralappshub.keshtune.data.userMessage
import br.com.centralappshub.keshtune.di.BareClient
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Baixa as músicas para ouvir sem internet, uma por vez. Faixa do YouTube é convertida no servidor antes
 * (a mesma conversão de quando toca), e o servidor já a coloca em "Minhas músicas".
 */
@Singleton
class DownloadManager @Inject constructor(
    @ApplicationContext private val context: Context,
    private val repo: MusicRepository,
    private val resolver: StreamResolver,
    @BareClient private val http: OkHttpClient,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val queue = Channel<Track>(Channel.UNLIMITED)

    private val _active = MutableStateFlow<Map<String, Float>>(emptyMap())
    /** Baixando ou na fila: id -> progresso de 0 a 1 (0 enquanto prepara). */
    val active: StateFlow<Map<String, Float>> = _active

    val downloaded: StateFlow<Set<String>> = repo.downloadIds.map { it.toSet() }
        .stateIn(scope, SharingStarted.Eagerly, emptySet())

    private val _messages = MutableSharedFlow<String>(extraBufferCapacity = 8)
    val messages: SharedFlow<String> = _messages

    init {
        scope.launch {
            for (t in queue) {
                try {
                    fetch(t)
                } catch (e: Exception) {
                    DownloadFiles.file(context, t.id).resolveSibling("${t.id}.part").delete()
                    _messages.tryEmit("Não deu para baixar \"${t.title}\": ${e.userMessage()}")
                }
                _active.update { it - t.id }
            }
        }
    }

    fun enqueue(tracks: List<Track>) {
        val todo = tracks.filter { it.playable && it.id !in downloaded.value && it.id !in _active.value }.distinctBy { it.id }
        if (todo.isEmpty()) return
        _active.update { m -> m + todo.associate { it.id to 0f } }
        todo.forEach { queue.trySend(it) }
        if (todo.size > 1) _messages.tryEmit("Baixando ${todo.size} músicas")
    }

    private suspend fun fetch(t: Track) {
        // Download não é urgente: não passa na frente de quem está esperando para ouvir
        val url = resolver.remoteUrl(t.id, urgent = false)
        val dest = DownloadFiles.file(context, t.id)
        val part = dest.resolveSibling("${t.id}.part")
        http.newCall(Request.Builder().url(url.toString()).build()).execute().use { r ->
            if (!r.isSuccessful) throw IOException("Erro ${r.code} do servidor")
            val body = r.body ?: throw IOException("Resposta vazia")
            val total = body.contentLength()
            body.byteStream().use { input ->
                part.outputStream().use { out ->
                    val buf = ByteArray(64 * 1024)
                    var done = 0L
                    var shown = 0f
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        done += n
                        if (total > 0) {
                            val p = done.toFloat() / total
                            if (p - shown >= 0.02f) {
                                shown = p
                                _active.update { it + (t.id to p) }
                            }
                        }
                    }
                }
            }
        }
        if (!part.renameTo(dest)) throw IOException("Sem espaço para salvar a música")
        // Depois da conversão a faixa do YouTube passa a ser arquivo próprio
        repo.saveDownload(t.copy(source = "file"), dest.length())
    }

    suspend fun delete(trackId: String) {
        DownloadFiles.file(context, trackId).delete()
        repo.deleteDownload(trackId)
    }

    /** Ao sair da conta: apaga todos os arquivos baixados. */
    suspend fun clearAll() {
        DownloadFiles.dir(context).listFiles()?.forEach { it.delete() }
        repo.clearDownloads()
    }
}
