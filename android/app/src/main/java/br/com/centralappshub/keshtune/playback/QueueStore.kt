package br.com.centralappshub.keshtune.playback

import android.content.Context
import android.util.AtomicFile
import androidx.core.net.toUri
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

/** Item da fila salva: o suficiente para remontar o MediaItem sem ir ao servidor. */
@Serializable
data class SavedItem(
    val mediaId: String,
    val uri: String? = null,
    val title: String? = null,
    val artist: String? = null,
    val album: String? = null,
    val art: String? = null,
)

/** Mesmos campos de Track.toMediaItem, com o endereço salvo (keshtune://track/<id>). */
fun SavedItem.toMediaItem(): MediaItem = MediaItem.Builder()
    .setMediaId(mediaId)
    .setUri(uri?.toUri() ?: trackUri(mediaId))
    .setMediaMetadata(
        MediaMetadata.Builder()
            .setTitle(title)
            .setArtist(artist)
            .setAlbumTitle(album)
            .setArtworkUri(art?.toUri())
            .setIsBrowsable(false)
            .setIsPlayable(true)
            .setMediaType(MediaMetadata.MEDIA_TYPE_MUSIC)
            .build()
    )
    .build()

@Serializable
data class SavedQueue(
    val items: List<SavedItem>,
    val index: Int,
    val positionMs: Long,
    val shuffle: Boolean = false,
    val repeat: Int = 0,
)

/**
 * Fila, faixa atual e posição guardadas no aparelho: ao ligar o carro (ou se o sistema matar o app),
 * a música volta de onde parou. Funções bloqueantes: chame em Dispatchers.IO, exceto no fim do serviço.
 */
@Singleton
class QueueStore @Inject constructor(
    @ApplicationContext context: Context,
    private val json: Json,
) {
    private val file = AtomicFile(File(context.filesDir, FILE_NAME))

    @Synchronized
    fun load(): SavedQueue? = runCatching {
        json.decodeFromString(SavedQueue.serializer(), file.readFully().decodeToString())
    }.getOrNull()?.takeIf { it.items.isNotEmpty() }

    /** AtomicFile: se o processo morrer no meio da gravação, fica a versão anterior inteira. */
    @Synchronized
    fun save(q: SavedQueue) {
        val bytes = json.encodeToString(SavedQueue.serializer(), q.trimmed()).encodeToByteArray()
        val out = runCatching { file.startWrite() }.getOrNull() ?: return
        try {
            out.write(bytes)
            file.finishWrite(out)
        } catch (e: Exception) {
            file.failWrite(out)
        }
    }

    @Synchronized
    fun clear() = file.delete()

    /** Fila enorme (rádio emendado horas a fio): guarda só os itens em volta da faixa atual. */
    private fun SavedQueue.trimmed(): SavedQueue {
        val range = window(items.size, index)
        if (range.first == 0 && range.last == items.lastIndex) return this
        return copy(items = items.subList(range.first, range.last + 1), index = index - range.first)
    }

    companion object {
        const val MAX_ITEMS = 300
        private const val FILE_NAME = "queue_state.json"

        /** Há fila salva para retomar (só olha se o arquivo existe; serve na Main). O .bak é a cópia do AtomicFile. */
        fun hasSaved(context: Context): Boolean =
            File(context.filesDir, FILE_NAME).let { it.exists() || File(it.path + ".bak").exists() }

        /** Até MAX_ITEMS índices em volta de [index] numa fila de [count] itens. */
        fun window(count: Int, index: Int): IntRange {
            val from = (index - MAX_ITEMS / 2).coerceIn(0, maxOf(0, count - MAX_ITEMS))
            return from until minOf(count, from + MAX_ITEMS)
        }
    }
}
