package br.com.centralappshub.keshtune.playback

import android.os.SystemClock
import androidx.core.net.toUri
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import br.com.centralappshub.keshtune.data.Home
import br.com.centralappshub.keshtune.data.MusicRepository
import br.com.centralappshub.keshtune.data.Track
import br.com.centralappshub.keshtune.data.mediaUrl
import kotlinx.coroutines.flow.first

/**
 * Menu do Android Auto e de outras telas de mídia do carro. As faixas de uma lista têm id "<lista>/<faixa>",
 * para que tocar uma delas coloque a lista inteira na fila.
 */
class BrowseTree(private val repo: MusicRepository) {
    private var home: Home? = null
    private var homeAt = 0L

    val root: MediaItem = folder(ROOT, "KeshTune")

    suspend fun children(parentId: String): List<MediaItem> = when (parentId) {
        ROOT -> listOf(
            folder("home:recent", "Tocadas recentemente"),
            folder("home:mix", "Seu mix"),
            folder("home:top", "Em alta"),
            folder("home:fresh", "Novidades"),
            folder(DOWNLOADS, "Baixadas (sem internet)"),
            folder(LIKED, "Músicas curtidas"),
            folder(PLAYLISTS, "Suas playlists"),
        )
        PLAYLISTS -> {
            runCatching { repo.refreshLibrary() }
            repo.playlists.first().map { folder("pl:${it.id}", it.name, it.image) }
        }
        else -> tracksOf(parentId).map { it.toMediaItem("$parentId/${it.id}") }
    }

    suspend fun tracksOf(parentId: String): List<Track> {
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
                runCatching { repo.refreshPlaylist(id).items.map { it.track } }.getOrElse { repo.playlistTracks(id).first() }
            }
            else -> emptyList()
        }
        return list.filter { it.playable }
    }

    private suspend fun home(): Home {
        val cached = home
        if (cached != null && SystemClock.elapsedRealtime() - homeAt < 2 * 60 * 1000) return cached
        return repo.home().also {
            home = it
            homeAt = SystemClock.elapsedRealtime()
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
    }
}
