package br.com.centralappshub.keshtune.playback

import android.content.Context
import br.com.centralappshub.keshtune.data.ApiException
import br.com.centralappshub.keshtune.data.Connectivity
import br.com.centralappshub.keshtune.data.DownloadGroup
import br.com.centralappshub.keshtune.data.MusicRepository
import br.com.centralappshub.keshtune.data.Track
import br.com.centralappshub.keshtune.data.coverUrlsToWarm
import br.com.centralappshub.keshtune.data.mediaUrl
import br.com.centralappshub.keshtune.data.userMessage
import br.com.centralappshub.keshtune.di.BareClient
import coil3.SingletonImageLoader
import coil3.request.CachePolicy
import coil3.request.ImageRequest
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.Call
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.coroutineContext

/**
 * Baixa as músicas para ouvir sem internet, uma por vez. Faixa do YouTube é convertida no servidor antes
 * (a mesma conversão de quando toca), e o servidor já a coloca em "Minhas músicas".
 * Sem internet (túnel), a música espera a rede voltar e continua de onde parou (Range), até 5 tentativas.
 */
@Singleton
class DownloadManager @Inject constructor(
    @ApplicationContext private val context: Context,
    private val repo: MusicRepository,
    private val resolver: StreamResolver,
    private val connectivity: Connectivity,
    @BareClient private val http: OkHttpClient,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val queue = Channel<Track>(Channel.UNLIMITED)

    private val _active = MutableStateFlow<Map<String, Float>>(emptyMap())
    /** Baixando ou na fila: id -> progresso de 0 a 1 (0 na fila, -1 baixando sem porcentagem ainda). */
    val active: StateFlow<Map<String, Float>> = _active

    // Eagerly de propósito: o enqueue lê downloaded.value mesmo sem ninguém observando
    val downloaded: StateFlow<Set<String>> = repo.downloadIds.map { it.toSet() }
        .stateIn(scope, SharingStarted.Eagerly, emptySet())

    private val _messages = MutableSharedFlow<String>(extraBufferCapacity = 8)
    val messages: SharedFlow<String> = _messages

    // Falhas do lote atual: viram uma mensagem só quando a fila esvazia (só o worker mexe nelas)
    private var failed = 0
    private var lastFailure = ""

    private var worker: Job = startWorker()

    /** Chamada do download em andamento: o clearAll a derruba (o read bloqueante não percebe o cancelamento). */
    @Volatile private var current: Call? = null

    init {
        // A fila não sobrevive a um reinício: pedaço de download parado há mais de 7 dias não volta mais
        scope.launch {
            val old = System.currentTimeMillis() - PART_MAX_AGE_MS
            DownloadFiles.dir(context).listFiles { f -> (f.name.endsWith(".part") || f.name.endsWith(".part.len")) && f.lastModified() < old }
                ?.forEach { it.delete() }
        }
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    private fun startWorker(): Job = scope.launch {
        for (t in queue) {
            var attempt = 0
            while (true) {
                try {
                    fetch(t)
                    break
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    // Cancelado no meio (saiu da conta): a chamada cancelada vira IOException, não é falha
                    ensureActive()
                    val retry = (e is Restart || e.isNetworkError() || (e is HttpStatus && (e.code == 408 || e.code == 429 || e.code >= 500)) ||
                        (e is ApiException && (e.status == 408 || e.status == 429))) && ++attempt < MAX_ATTEMPTS
                    if (!retry) {
                        // Desistiu (ou erro definitivo: conversão, "demorou", áudio indisponível): o pedaço não serve mais
                        deletePart(t.id)
                        failed++
                        lastFailure = "Não deu para baixar \"${t.title}\": ${e.userMessage()}"
                        break
                    }
                    // Erro de rede: o .part fica, para continuar de onde parou quando a internet voltar.
                    // A espera pela rede validada é curta: há centrais que nunca a validam
                    withTimeoutOrNull(OFFLINE_WAIT_MS) { connectivity.online.first { it } }
                    delay(BACKOFF_MS[attempt - 1])
                }
            }
            _active.update { it - t.id }
            if (queue.isEmpty) flushFailures()
        }
    }

    private fun flushFailures() {
        when {
            failed == 1 -> _messages.tryEmit(lastFailure)
            failed > 1 -> _messages.tryEmit("Não deu para baixar $failed músicas")
        }
        failed = 0
    }

    /** Resposta HTTP de erro do servidor de áudio (o código decide se vale tentar de novo). */
    private class HttpStatus(val code: Int) : IOException("Erro $code do servidor")

    /** O pedaço já baixado não serve mais (416): apagado, recomeça do zero na próxima tentativa. */
    private class Restart : IOException("reiniciar")

    private fun partFile(id: String): File = DownloadFiles.file(context, id).resolveSibling("$id.part")

    /** Tamanho total do arquivo de que o .part é pedaço: retomar só emenda bytes do mesmo arquivo. */
    private fun lenFile(id: String): File = DownloadFiles.file(context, id).resolveSibling("$id.part.len")

    private fun deletePart(id: String) {
        partFile(id).delete()
        lenFile(id).delete()
    }

    /** group: a coleção de onde veio o lote (mix, playlist, álbum), para a tela Baixadas organizar por ela. */
    fun enqueue(tracks: List<Track>, group: DownloadGroup? = null) {
        if (group != null) {
            val list = tracks.filter { it.playable }.distinctBy { it.id }
            if (list.isNotEmpty()) scope.launch { runCatching { repo.saveDownloadGroup(group, list) } }
        }
        val todo = tracks.filter { it.playable && it.id !in downloaded.value && it.id !in _active.value }.distinctBy { it.id }
        if (todo.isEmpty()) return
        _active.update { m -> m + todo.associate { it.id to 0f } }
        todo.forEach { queue.trySend(it) }
        // O servidor já começa a converter todas em paralelo: quando o worker chegar nelas, a maioria estará pronta.
        // Um pedido só com todos os ids: o servidor limita as escritas por minuto e o OkHttp, as conexões por host.
        // Filho do worker: sair da conta cancela também este pedido
        val yt = todo.filter { it.source == "youtube" }.map { it.id }
        if (yt.isNotEmpty()) scope.launch(worker) { runCatching { repo.requestDownloads(yt, urgent = false) } }
        if (todo.size > 1) _messages.tryEmit("Baixando ${todo.size} músicas")
    }

    private suspend fun fetch(t: Track) {
        // Em andamento, ainda sem porcentagem (0f continua sendo "na fila")
        _active.update { it + (t.id to -1f) }
        // Download não é urgente: não passa na frente de quem está esperando para ouvir.
        // A URL é pedida de novo a cada tentativa, porque a assinatura expira.
        val url = resolver.remoteUrl(t.id, false)
        val dest = DownloadFiles.file(context, t.id)
        val part = partFile(t.id)
        var have = if (part.exists()) part.length() else 0L
        val req = Request.Builder().url(url.toString())
            .apply { if (have > 0) header("Range", "bytes=$have-") }
            .build()
        val call = http.newCall(req)
        // Sair da conta derruba a conexão em vez de esperar o arquivo inteiro: o clearAll cancela a chamada guardada
        // aqui. Ela é guardada antes do ensureActive, então ou o clearAll a vê, ou o ensureActive já falha
        current = call
        try {
            coroutineContext.ensureActive()
            call.execute().use { r ->
                if (r.code == 416) {
                    deletePart(t.id)
                    throw Restart()
                }
                if (!r.isSuccessful) throw HttpStatus(r.code)
                val body = r.body ?: throw IOException("Resposta vazia")
                // Servidor que ignora o Range devolve 200 com o arquivo todo: recomeça do zero
                val range = r.header("Content-Range")
                val append = r.code == 206 && have > 0 && range?.startsWith("bytes $have-") == true
                if (append) {
                    // O arquivo mudou no servidor desde o pedaço (outro tamanho total): recomeça do zero
                    val saved = runCatching { lenFile(t.id).readText().trim().toLong() }.getOrNull()
                    if (saved == null || range?.substringAfterLast('/')?.toLongOrNull() != saved) {
                        deletePart(t.id)
                        throw Restart()
                    }
                } else {
                    have = 0
                }
                val total = body.contentLength().let { if (it > 0) it + have else -1L }
                if (!append) lenFile(t.id).let { if (total > 0) it.writeText(total.toString()) else it.delete() }
                body.byteStream().use { input ->
                    FileOutputStream(part, append).use { out ->
                        val buf = ByteArray(64 * 1024)
                        var done = have
                        var shown = 0f
                        if (total > 0 && done > 0) {
                            shown = done.toFloat() / total
                            _active.update { it + (t.id to shown) }
                        }
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
        } finally {
            current = null
        }
        // Saiu da conta enquanto baixava: a pasta já é da conta nova, não mexe em nada
        coroutineContext.ensureActive()
        if (!part.renameTo(dest)) throw IOException("Sem espaço para salvar a música")
        lenFile(t.id).delete()
        // Depois da conversão a faixa do YouTube passa a ser arquivo próprio
        repo.saveDownload(t.copy(source = "file"), dest.length())
        // Aquece o disco com a capa (a grande e, do YouTube, a pequena das listas) para ela aparecer sem internet
        coverUrlsToWarm(mediaUrl(t.coverUrl)).forEach { cover ->
            SingletonImageLoader.get(context).enqueue(
                ImageRequest.Builder(context).data(cover).size(96).memoryCachePolicy(CachePolicy.DISABLED).build()
            )
        }
    }

    suspend fun delete(trackId: String) {
        withContext(Dispatchers.IO) { DownloadFiles.file(context, trackId).delete() }
        repo.deleteDownload(trackId)
    }

    /** Apaga a coleção e os arquivos das músicas que não estão em outra coleção. */
    suspend fun deleteGroup(groupId: String) {
        repo.deleteDownloadGroup(groupId).forEach { delete(it) }
    }

    /** Ao sair da conta: para a fila e apaga todos os arquivos baixados. */
    suspend fun clearAll() {
        worker.cancel()
        current?.cancel()
        // Espera o worker antigo acabar (a chamada cancelada solta o read na hora), para ele não mexer em _active nem
        // nos arquivos depois da limpeza. Com teto: uma consulta de DNS presa não segura a saída da conta
        withTimeoutOrNull(5_000) { worker.join() }
        while (queue.tryReceive().isSuccess) {}
        _active.value = emptyMap()
        withContext(Dispatchers.IO) { DownloadFiles.dir(context).listFiles()?.forEach { it.delete() } }
        repo.clearDownloads()
        failed = 0
        worker = startWorker()
    }

    private companion object {
        const val MAX_ATTEMPTS = 5
        /** Quanto esperar a rede validada antes de tentar de novo mesmo assim (há centrais que nunca a validam). */
        const val OFFLINE_WAIT_MS = 60_000L
        val BACKOFF_MS = longArrayOf(2_000, 5_000, 15_000, 30_000, 60_000)
        const val PART_MAX_AGE_MS = 7 * 24 * 60 * 60_000L
    }
}
