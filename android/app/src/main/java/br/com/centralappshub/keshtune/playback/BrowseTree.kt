package br.com.centralappshub.keshtune.playback

import android.os.SystemClock
import androidx.core.net.toUri
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import br.com.centralappshub.keshtune.data.Home
import br.com.centralappshub.keshtune.data.MusicRepository
import br.com.centralappshub.keshtune.data.PlaylistEntity
import br.com.centralappshub.keshtune.data.Track
import br.com.centralappshub.keshtune.data.mediaUrl
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.io.IOException

/**
 * Menu do Android Auto e de outras telas de mídia do carro. As faixas de uma lista têm id "<lista>/<faixa>",
 * para que tocar uma delas coloque a lista inteira na fila.
 *
 * Abre do que já está no aparelho (Room, início salvo) e atualiza pela rede em segundo plano; quando a atualização
 * chega, [onChanged] avisa a central para recarregar a pasta. Só a rede lenta não trava o menu do carro.
 * Todo o estado é usado só na thread principal.
 */
class BrowseTree(
    private val repo: MusicRepository,
    private val scope: CoroutineScope,
    private val onChanged: (String) -> Unit,
) {
    private var home: Home? = null
    private var homeAt = 0L

    /** Faixas tocáveis de cada pasta (por alguns minutos): a paginação e o "tocar a lista" usam a mesma lista. */
    private val lists = HashMap<String, Pair<Long, List<Track>>>()
    /** Última atualização pela rede de cada chave. */
    private val lastSync = HashMap<String, Long>()
    private val running = HashMap<String, Job>()

    val root: MediaItem = folder(ROOT, "KeshTune")

    suspend fun children(parentId: String): List<MediaItem> = when (parentId) {
        ROOT -> listOf(
            folder("home:recent", "Tocadas recentemente"),
            folder("home:mix", "Seu mix"),
            folder("home:top", "Em alta"),
            folder("home:fresh", "Novidades"),
            folder(MIXES, "Mixes e YouTube Music"),
            folder(DOWNLOADS, "Baixadas (sem internet)"),
            folder(LIKED, "Músicas curtidas"),
            folder(PLAYLISTS, "Suas playlists"),
        )
        PLAYLISTS -> playlists().map { folder("pl:${it.id}", it.name, it.image) }
        // Mixes do YouTube e playlists do YouTube Music (do arquivo guardado, se a rede demorar)
        MIXES -> (withTimeoutOrNull(NET_WAIT_MS) { runCatching { repo.mixes() }.getOrNull() } ?: repo.cachedMixes())
            ?.sections.orEmpty().flatMap { it.items }.distinctBy { it.id }.map { folder("mix:${it.id}", it.title, it.imageUrl) }
        else -> tracksOf(parentId).map { it.toMediaItem("$parentId/${it.id}") }
    }

    suspend fun tracksOf(parentId: String): List<Track> {
        lists[parentId]?.let { (at, list) -> if (SystemClock.elapsedRealtime() - at < LIST_TTL_MS) return list }
        val list = when {
            parentId.startsWith("home:") -> {
                val h = home()
                when (parentId) {
                    "home:recent" -> h.recent
                    "home:mix" -> h.mix.ifEmpty { h.top }
                    "home:top" -> h.top
                    else -> h.fresh
                }
            }
            parentId == DOWNLOADS -> repo.downloadedTracks.first()
            parentId == LIKED -> repo.likedTracks.first().ifEmpty {
                runCatching { repo.refreshLibrary() }
                repo.likedTracks.first()
            }
            parentId.startsWith("pl:") -> {
                val id = parentId.removePrefix("pl:")
                val local = repo.playlistTracks(id).first()
                if (local.isEmpty()) {
                    withTimeoutOrNull(NET_WAIT_MS) { runCatching { repo.refreshPlaylist(id).items.map { it.track } }.getOrNull() } ?: local
                } else {
                    refreshInBackground(parentId, parentId) { repo.refreshPlaylist(id) }
                    local
                }
            }
            parentId.startsWith("mix:") ->
                withTimeoutOrNull(NET_WAIT_MS * 2) { runCatching { repo.mix(parentId.removePrefix("mix:")).tracks }.getOrNull() }.orEmpty()
            else -> emptyList()
        }.filter { it.playable }
        // Baixadas mudam pelo próprio app e vêm do banco local: sempre lidas na hora. Lista vazia não fica guardada
        // (pode ser só falta de rede)
        if (parentId != DOWNLOADS && list.isNotEmpty()) lists[parentId] = SystemClock.elapsedRealtime() to list
        return list
    }

    private suspend fun playlists(): List<PlaylistEntity> {
        val local = repo.playlists.first()
        if (local.isNotEmpty()) {
            refreshInBackground(PLAYLISTS, PLAYLISTS, LIKED) { repo.refreshLibrary() }
            return local
        }
        // Primeira vez (banco vazio): espera a rede um pouco
        withTimeoutOrNull(NET_WAIT_MS) {
            runCatching { repo.refreshLibrary() }.onSuccess { lastSync[PLAYLISTS] = SystemClock.elapsedRealtime() }
        }
        return repo.playlists.first()
    }

    private suspend fun home(): Home {
        val mem = home
        if (mem != null && SystemClock.elapsedRealtime() - homeAt < HOME_MEM_MS) return mem
        val disk = mem ?: withContext(Dispatchers.IO) { repo.cachedHome() }
        if (disk != null) {
            home = disk
            // fetchHome: sem rede dá erro (e não a Início guardada), para lastSync não marcar como atualizado
            refreshInBackground("home", "home:recent", "home:mix", "home:top", "home:fresh") {
                home = repo.fetchHome()
                homeAt = SystemClock.elapsedRealtime()
            }
            return disk
        }
        val fresh = withTimeoutOrNull(NET_WAIT_MS) { repo.home() } ?: throw IOException("Sem conexão com o servidor")
        home = fresh
        homeAt = SystemClock.elapsedRealtime()
        lastSync["home"] = homeAt
        return fresh
    }

    /** Atualiza pela rede sem segurar o menu; no máximo uma vez a cada SYNC_TTL_MS por chave. */
    private fun refreshInBackground(key: String, vararg affected: String, block: suspend () -> Unit) {
        if (running[key]?.isActive == true) return
        val last = lastSync[key]
        if (last != null && SystemClock.elapsedRealtime() - last < SYNC_TTL_MS) return
        running[key] = scope.launch {
            try {
                block()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                return@launch
            }
            lastSync[key] = SystemClock.elapsedRealtime()
            affected.forEach {
                lists.remove(it)
                onChanged(it)
            }
        }
    }

    private fun folder(id: String, title: String, image: String? = null) = MediaItem.Builder()
        .setMediaId(id)
        .setMediaMetadata(
            MediaMetadata.Builder()
                .setTitle(title)
                .setArtworkUri(mediaUrl(image)?.toUri())
                .setIsBrowsable(true)
                .setIsPlayable(false)
                .setMediaType(if (id.startsWith("pl:")) MediaMetadata.MEDIA_TYPE_PLAYLIST else MediaMetadata.MEDIA_TYPE_FOLDER_MIXED)
                .build()
        )
        .build()

    companion object {
        const val ROOT = "root"
        const val LIKED = "liked"
        const val DOWNLOADS = "downloads"
        const val PLAYLISTS = "playlists"
        const val MIXES = "mixes"

        private const val LIST_TTL_MS = 5 * 60 * 1000L
        private const val SYNC_TTL_MS = 10 * 60 * 1000L
        private const val HOME_MEM_MS = 2 * 60 * 1000L
        private const val NET_WAIT_MS = 8_000L
    }
}
