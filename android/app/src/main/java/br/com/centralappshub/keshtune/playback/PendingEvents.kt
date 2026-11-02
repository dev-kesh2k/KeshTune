package br.com.centralappshub.keshtune.playback

import android.content.Context
import br.com.centralappshub.keshtune.data.ApiException
import br.com.centralappshub.keshtune.data.MusicRepository
import br.com.centralappshub.keshtune.data.PlayEvent
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Fila dos eventos de reprodução ainda não enviados. Sem internet (túnel, estrada) eles ficam guardados no aparelho
 * e vão em lote quando a conexão volta, em vez de se perderem.
 */
@Singleton
class PendingEvents @Inject constructor(
    @ApplicationContext context: Context,
    private val json: Json,
    private val repo: MusicRepository,
) {
    private val prefs = context.getSharedPreferences("pending_events", Context.MODE_PRIVATE)
    private val serializer = ListSerializer(PlayEvent.serializer())
    private val mutex = Mutex()
    // Escopo próprio: o envio continua mesmo se o serviço do player for encerrado
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /** Muda a cada clear(): gravação ou envio que começou antes de sair da conta não mexe na fila nova. */
    @Volatile private var generation = 0

    /**
     * Guarda o evento (commit síncrono, para sobreviver ao fim do processo) e já tenta enviar. A gravação vai para
     * o IO, fora da Main (troca de faixa); sync grava na hora, para quando o serviço está acabando.
     */
    fun add(e: PlayEvent, sync: Boolean = false) {
        val gen = generation
        if (sync) {
            append(e, gen)
            flushAsync()
        } else {
            scope.launch {
                append(e, gen)
                flush()
            }
        }
    }

    @Synchronized
    private fun append(e: PlayEvent, gen: Int) {
        if (gen == generation) write((read() + e).takeLast(MAX))
    }

    /** Envia o que está guardado; só tira da fila o que o servidor recebeu (ou recusou de vez). */
    suspend fun flush() {
        mutex.withLock {
            val gen = generation
            val batch = snapshot().take(MAX)
            if (batch.isEmpty()) return
            val error = runCatching { repo.sendEvents(batch) }.exceptionOrNull()
            // 4xx definitivo: o servidor recusou o lote e reenviar não adiantaria. Login vencido (401/403), limite
            // de pedidos (429) e demora (408) passam: o lote fica para a próxima vez
            val refused = error is ApiException && error.status in 400..499 && error.status !in RETRY_LATER
            if (error == null || refused) dropFirst(batch.size, gen)
        }
    }

    fun flushAsync() {
        scope.launch { flush() }
    }

    @Synchronized
    fun clear() {
        generation++
        prefs.edit().clear().commit()
    }

    @Synchronized
    private fun snapshot(): List<PlayEvent> = read()

    @Synchronized
    private fun dropFirst(n: Int, gen: Int) {
        if (gen == generation) write(read().drop(n))
    }

    private fun read(): List<PlayEvent> =
        prefs.getString(KEY, null)?.let { runCatching { json.decodeFromString(serializer, it) }.getOrNull() } ?: emptyList()

    private fun write(list: List<PlayEvent>) {
        val edit = prefs.edit()
        if (list.isEmpty()) edit.remove(KEY) else edit.putString(KEY, json.encodeToString(serializer, list))
        edit.commit()
    }

    private companion object {
        const val KEY = "q"
        const val MAX = 500
        val RETRY_LATER = setOf(401, 403, 408, 429)
    }
}
