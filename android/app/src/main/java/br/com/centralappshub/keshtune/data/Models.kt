package br.com.centralappshub.keshtune.data

import br.com.centralappshub.keshtune.BuildConfig
import kotlinx.serialization.Serializable

// Formatos da API do KeshTune (backend/src). Os nomes em snake_case são convertidos pelo JsonNamingStrategy.SnakeCase.

@Serializable
data class ArtistRef(val id: String, val name: String)

@Serializable
data class AlbumRef(val id: String, val title: String)

@Serializable
data class Track(
    val id: String,
    val title: String,
    val durationMs: Long = 0,
    val explicit: Boolean = false,
    val source: String = "file",
    val youtubeId: String? = null,
    val playable: Boolean = true,
    val unavailableReason: String? = null,
    val coverUrl: String? = null,
    val album: AlbumRef? = null,
    val artists: List<ArtistRef> = emptyList(),
    val liked: Boolean = false,
) {
    val artistNames: String get() = artists.joinToString(", ") { it.name }
    val isYoutube: Boolean get() = source == "youtube"
}

@Serializable
data class AlbumCard(
    val id: String,
    val title: String,
    val type: String? = null,
    val releaseDate: String? = null,
    val coverUrl: String? = null,
    val artists: List<ArtistRef> = emptyList(),
)

@Serializable
data class ArtistCard(val id: String, val name: String, val imageUrl: String? = null)

@Serializable
data class PlaylistCard(
    val id: String,
    val name: String,
    val description: String? = null,
    val coverUrl: String? = null,
    val ownerName: String? = null,
    val trackCount: Int = 0,
    val mosaic: List<String> = emptyList(),
) {
    val image: String? get() = coverUrl ?: mosaic.firstOrNull()
}

@Serializable
data class Home(
    val recent: List<Track> = emptyList(),
    val mix: List<Track> = emptyList(),
    val top: List<Track> = emptyList(),
    val fresh: List<Track> = emptyList(),
    val releases: List<AlbumCard> = emptyList(),
    val followedReleases: List<AlbumCard> = emptyList(),
    val myPlaylists: List<PlaylistCard> = emptyList(),
    val publicPlaylists: List<PlaylistCard> = emptyList(),
    /** Top 10 em alta no Brasil. */
    val artists: List<ArtistCard> = emptyList(),
    /** Os 10 que o usuário mais ouviu nos últimos 90 dias. */
    val myArtists: List<ArtistCard> = emptyList(),
)

@Serializable
data class AlbumDetail(
    val id: String,
    val title: String,
    val coverUrl: String? = null,
    val releaseDate: String? = null,
    val artists: List<ArtistRef> = emptyList(),
    val tracks: List<Track> = emptyList(),
    val saved: Boolean = false,
)

@Serializable
data class ArtistDetail(
    val id: String,
    val name: String,
    val imageUrl: String? = null,
    val followed: Boolean = false,
    val topTracks: List<Track> = emptyList(),
    val albums: List<AlbumCard> = emptyList(),
    val appearsOn: List<AlbumCard> = emptyList(),
    /** O servidor ainda está buscando as mais tocadas (primeira abertura): vale pedir de novo daqui a pouco. */
    val topPending: Boolean = false,
)

@Serializable
data class PlaylistItem(val track: Track)

@Serializable
data class PlaylistDetail(
    val id: String,
    val name: String,
    val description: String? = null,
    val coverUrl: String? = null,
    val ownerName: String? = null,
    val mosaic: List<String> = emptyList(),
    val items: List<PlaylistItem> = emptyList(),
)

@Serializable
data class Library(
    val likedCount: Int = 0,
    val playlists: List<PlaylistCard> = emptyList(),
    val albums: List<AlbumCard> = emptyList(),
    val artists: List<ArtistCard> = emptyList(),
)

@Serializable
data class LikedItem(val track: Track)

@Serializable
data class LikedPage(val items: List<LikedItem> = emptyList(), val nextCursor: String? = null)

@Serializable
data class SearchResult(
    val tracks: List<Track> = emptyList(),
    val artists: List<ArtistCard> = emptyList(),
    val albums: List<AlbumCard> = emptyList(),
    val playlists: List<PlaylistCard> = emptyList(),
    val didYouMean: String? = null,
)

@Serializable
data class YtResult(
    val youtubeId: String,
    val title: String,
    val channel: String = "",
    val durationMs: Long = 0,
    val thumbnailUrl: String? = null,
)

@Serializable
data class YtSearch(val items: List<YtResult> = emptyList())

@Serializable
data class TrackList(val items: List<Track> = emptyList())

@Serializable
data class Me(val id: String, val email: String, val displayName: String = "", val role: String = "user")

// ----- Corpos e respostas de autenticação e reprodução -----

@Serializable
data class LoginRequest(val email: String, val password: String, val otp: String? = null)

@Serializable
data class RefreshRequest(val refreshToken: String)

@Serializable
data class Tokens(
    val accessToken: String,
    val refreshToken: String,
    val expiresIn: Long,
    val mustChangePassword: Boolean = false,
)

@Serializable
data class IdsBody(val ids: List<String>)

@Serializable
data class TrackIdBody(val trackId: String)

@Serializable
data class PlaybackSession(val source: String, val url: String? = null, val videoId: String? = null)

@Serializable
data class DownloadsBody(val trackIds: List<String>, val urgent: Boolean = false)

@Serializable
data class DownloadItem(val trackId: String, val status: String, val jobId: String? = null, val error: String? = null)

@Serializable
data class DownloadsResponse(val items: List<DownloadItem> = emptyList())

@Serializable
data class Job(val id: String, val status: String, val error: String? = null, val trackId: String? = null)

@Serializable
data class JobsResponse(val items: List<Job> = emptyList())

@Serializable
data class YtTrackBody(val youtubeId: String)

@Serializable
data class PlayEvent(
    val trackId: String,
    val event: String,
    val msPlayed: Long,
    val playedAt: String,
    val contextType: String? = null,
)

@Serializable
data class EventsBody(val events: List<PlayEvent>)

/** Caminho relativo ("images/x.jpg") vira URL completa; URLs externas (capas do YouTube) passam direto. */
fun mediaUrl(u: String?): String? = when {
    u.isNullOrBlank() -> null
    u.startsWith("http://") || u.startsWith("https://") -> u
    else -> "${BuildConfig.APP_URL}api/media/$u"
}

/** Miniatura padrão do YouTube (480x360, 4:3 com faixas pretas em cima e embaixo). */
private val YT_HQ = Regex("""^(https://i\.ytimg\.com/vi/[\w-]+/)hqdefault\.jpg$""")

/**
 * Versão pequena de uma capa hqdefault do YouTube: a mqdefault (320x180, já 16:9 e sem faixas pretas), usada nas
 * capas pequenas e no fundo desfocado; null para as outras URLs. Quem aquece o cache de capas grava as duas.
 */
fun ytSmallCover(full: String?): String? =
    if (full != null && YT_HQ.matches(full)) full.replace(YT_HQ, "\$1mqdefault.jpg") else null

/** URLs a aquecer no cache em disco para a capa aparecer sem internet: a original e, do YouTube, a pequena. */
fun coverUrlsToWarm(full: String?): List<String> = listOfNotNull(full, ytSmallCover(full))
