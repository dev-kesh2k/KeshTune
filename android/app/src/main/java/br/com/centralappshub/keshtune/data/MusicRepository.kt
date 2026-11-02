package br.com.centralappshub.keshtune.data

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.encodeToString
import java.io.File
import java.io.IOException
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.Json
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class MusicRepository @Inject constructor(
    @ApplicationContext private val context: Context,
    private val api: KeshApi,
    private val dao: LibraryDao,
    private val tokens: TokenStore,
    private val json: Json,
) {
    /** Chama a API trocando o HttpException pelo erro legível do servidor. */
    private suspend fun <T> call(block: suspend KeshApi.() -> T): T =
        try {
            api.block()
        } catch (e: Exception) {
            throw e.toApiException(json)
        }

    // ----- Sessão -----

    suspend fun login(email: String, password: String, otp: String?) {
        val t = call { login(LoginRequest(email.trim(), password, otp?.takeIf { it.isNotBlank() })) }
        if (t.mustChangePassword) throw ApiException(403, "PASSWORD_CHANGE_REQUIRED", "Troque a senha pelo site antes de entrar no app")
        tokens.save(t)
    }

    suspend fun logout() {
        runCatching { call { logout() } }
        tokens.clear()
        dao.clearAll()
        homeFile().delete()
    }

    suspend fun me(): Me = call { me() }

    // ----- Catálogo (sempre da rede) -----

    /** Início da rede; a última versão fica guardada para abrir sem internet. */
    suspend fun home(): Home = try {
        call { home() }.also { h -> runCatching { homeFile().writeText(json.encodeToString(h)) } }
    } catch (e: IOException) {
        cachedHome() ?: throw e
    }

    fun cachedHome(): Home? = runCatching { json.decodeFromString<Home>(homeFile().readText()) }.getOrNull()

    private fun homeFile() = File(context.filesDir, "home.json")
    suspend fun album(id: String): AlbumDetail = call { album(id) }
    suspend fun artist(id: String): ArtistDetail = call { artist(id) }
    suspend fun track(id: String): Track = call { track(id) }
    suspend fun search(q: String): SearchResult = call { search(q) }
    suspend fun youtubeSearch(q: String): List<YtResult> = call { youtubeSearch(q).items }

    /** Cadastra o vídeo no catálogo (ou acha o já cadastrado) e devolve a faixa. */
    suspend fun youtubeTrack(youtubeId: String): Track = call { youtubeTrack(YtTrackBody(youtubeId)) }

    suspend fun radio(seedTrackId: String, exclude: List<String>): List<Track> =
        call { radio("track", seedTrackId, exclude.takeLast(400).joinToString(",")).items }

    // ----- Biblioteca (Room + rede) -----

    val playlists: Flow<List<PlaylistEntity>> = dao.playlists()
    val likedTracks: Flow<List<Track>> = dao.likedTracks().map { l -> l.map { it.toTrack(liked = true) } }

    fun playlist(id: String): Flow<PlaylistEntity?> = dao.playlist(id)
    fun playlistTracks(id: String): Flow<List<Track>> = dao.playlistTracks(id).map { l -> l.map { it.toTrack() } }
    fun isLiked(trackId: String): Flow<Boolean> = dao.isLiked(trackId)

    /** Atualiza playlists e curtidas; devolve álbuns e artistas salvos (não ficam no banco local). */
    suspend fun refreshLibrary(): Library {
        val lib = call { library() }
        dao.replacePlaylists(lib.playlists.mapIndexed { i, p -> p.toEntity(i) })
        dao.replaceLiked(call { likedTracks() }.items.map { it.track })
        return lib
    }

    suspend fun refreshPlaylist(id: String): PlaylistDetail {
        val p = call { playlist(id) }
        dao.replacePlaylistTracks(id, p.items.map { it.track })
        return p
    }

    suspend fun setLiked(track: Track, liked: Boolean) {
        val body = IdsBody(listOf(track.id))
        if (liked) call { save("track", body) } else call { unsave("track", body) }
        if (liked) {
            dao.upsertTracks(listOf(track.toEntity()))
            dao.insertLiked(listOf(LikedEntity(track.id, System.currentTimeMillis())))
        } else {
            dao.deleteLiked(track.id)
        }
    }

    // ----- Downloads (o arquivo é gravado pelo DownloadManager) -----

    val downloadedTracks: Flow<List<Track>> = dao.downloadedTracks().map { l -> l.map { it.toTrack() } }
    val downloadIds: Flow<List<String>> = dao.downloadIds()

    suspend fun saveDownload(track: Track, bytes: Long) {
        dao.upsertTracks(listOf(track.toEntity()))
        dao.insertDownload(DownloadEntity(track.id, bytes, System.currentTimeMillis()))
    }

    suspend fun deleteDownload(id: String) = dao.deleteDownload(id)
    suspend fun clearDownloads() = dao.clearDownloads()

    suspend fun cachedTrack(id: String): Track? = dao.track(id)?.toTrack()

    suspend fun cacheTracks(tracks: List<Track>) = dao.upsertTracks(tracks.map { it.toEntity() })

    // ----- Reprodução -----

    suspend fun playbackSession(trackId: String): PlaybackSession = call { playbackSession(TrackIdBody(trackId)) }
    /** urgent: alguém está esperando para ouvir (o servidor converte na pista expressa). */
    suspend fun requestDownload(trackId: String, urgent: Boolean): DownloadItem? =
        call { youtubeDownloads(DownloadsBody(listOf(trackId), urgent = urgent)) }.items.firstOrNull()

    suspend fun job(jobId: String): Job? = call { youtubeJobs(jobId) }.items.firstOrNull()
    suspend fun sendEvents(events: List<PlayEvent>) = call { playbackEvents(EventsBody(events)) }
}
