package br.com.centralappshub.keshtune.data

import android.content.Context
import android.os.SystemClock
import android.util.AtomicFile
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
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
        lastHome = null
        lastLib = null
        lastLibAt = 0L
        withContext(Dispatchers.IO) {
            syncPrefs.edit().clear().apply()
            AtomicFile(homeFile()).delete()
            AtomicFile(mixesFile()).delete()
        }
    }

    suspend fun me(): Me = call { me() }

    // ----- Catálogo (sempre da rede) -----

    /** Último Início lido ou baixado: abrir a tela de novo não relê o arquivo. */
    @Volatile private var lastHome: Home? = null

    /** Início da rede; sem rede, a última versão guardada. */
    suspend fun home(): Home = try {
        fetchHome()
    } catch (e: IOException) {
        cachedHome() ?: throw e
    }

    /** Início só da rede (o erro sobe, sem cair no guardado); a resposta fica guardada para abrir sem internet. */
    suspend fun fetchHome(): Home = call { home() }.also { h ->
        lastHome = h
        withContext(Dispatchers.IO) { saveHome(h) }
    }

    /** Gravação atômica: um corte de energia no meio (comum no carro) não deixa o arquivo pela metade. */
    private fun saveHome(h: Home) {
        val file = AtomicFile(homeFile())
        val out = try {
            file.startWrite()
        } catch (e: IOException) {
            return
        }
        try {
            out.write(json.encodeToString(h).toByteArray())
            file.finishWrite(out)
        } catch (e: Exception) {
            file.failWrite(out)
            if (e is CancellationException) throw e
        }
    }

    /** Início guardado (memória ou arquivo); o arquivo é lido fora da Main. */
    suspend fun cachedHome(): Home? = lastHome ?: withContext(Dispatchers.IO) {
        runCatching { json.decodeFromString<Home>(AtomicFile(homeFile()).readFully().decodeToString()) }.getOrNull()
    }?.also { lastHome = it }

    private fun homeFile() = File(context.filesDir, "home.json")

    // ----- Mixes (playlists do YouTube Music e mixes do YouTube) -----

    /**
     * Mixes da rede, guardados para abrir sem internet. Se o servidor ainda está montando as playlists do
     * YouTube Music (pending), fica a lista guardada, que é mais completa.
     */
    suspend fun mixes(): Mixes {
        val fresh = try {
            call { mixes() }
        } catch (e: IOException) {
            return cachedMixes() ?: throw e
        }
        if (fresh.pending) cachedMixes()?.takeIf { it.sections.size > fresh.sections.size }?.let { return it.copy(pending = true) }
        if (!fresh.pending) withContext(Dispatchers.IO) { writeAtomic(mixesFile(), json.encodeToString(fresh)) }
        return fresh
    }

    suspend fun cachedMixes(): Mixes? = withContext(Dispatchers.IO) {
        runCatching { json.decodeFromString<Mixes>(AtomicFile(mixesFile()).readFully().decodeToString()) }.getOrNull()
    }

    suspend fun mix(id: String): MixDetail = call { mix(id) }

    private fun mixesFile() = File(context.filesDir, "mixes.json")

    private fun writeAtomic(target: File, text: String) {
        val file = AtomicFile(target)
        val out = try {
            file.startWrite()
        } catch (e: IOException) {
            return
        }
        try {
            out.write(text.toByteArray())
            file.finishWrite(out)
        } catch (e: Exception) {
            file.failWrite(out)
        }
    }
    suspend fun album(id: String): AlbumDetail = call { album(id) }
    suspend fun artist(id: String): ArtistDetail = call { artist(id) }
    suspend fun track(id: String): Track = call { track(id) }
    suspend fun search(q: String): SearchResult = call { search(q) }
    suspend fun youtubeSearch(q: String): List<YtResult> = call { youtubeSearch(q).items }

    /** Cadastra o vídeo no catálogo (ou acha o já cadastrado) e devolve a faixa. */
    suspend fun youtubeTrack(youtubeId: String): Track = call { youtubeTrack(YtTrackBody(youtubeId)) }

    /** exclude: as mais recentes no fim. Vão só as últimas RADIO_EXCLUDE_MAX (cada id ocupa 37 caracteres na URL). */
    suspend fun radio(seedTrackId: String, exclude: List<String>): List<Track> =
        call { radio("track", seedTrackId, exclude.distinct().takeLast(RADIO_EXCLUDE_MAX).joinToString(",")).items }

    // ----- Biblioteca (Room + rede) -----

    val playlists: Flow<List<PlaylistEntity>> = dao.playlists()
    val likedTracks: Flow<List<Track>> = dao.likedTracks().map { l -> l.map { it.toTrack(liked = true) } }

    fun playlist(id: String): Flow<PlaylistEntity?> = dao.playlist(id)
    fun playlistTracks(id: String): Flow<List<Track>> = dao.playlistTracks(id).map { l -> l.map { it.toTrack() } }
    fun isLiked(trackId: String): Flow<Boolean> = dao.isLiked(trackId)

    // Várias telas (e o Android Auto) pedem a biblioteca ao mesmo tempo: uma ida à rede por vez,
    // e quem chega enquanto ela está em andamento (ou logo depois) recebe o mesmo resultado.
    private val libMutex = Mutex()
    @Volatile private var lastLib: Library? = null
    @Volatile private var lastLibAt = 0L
    private val syncPrefs by lazy { context.getSharedPreferences("sync", Context.MODE_PRIVATE) }

    /**
     * Atualiza playlists e curtidas; devolve álbuns e artistas salvos (não ficam no banco local).
     * Sem force, reaproveita o resultado de menos de 5 min (force: a pessoa abriu a tela ou pediu de novo, a ida é
     * pequena). As curtidas (lista grande) só descem de novo a cada 30 min, com forceLiked (tela Curtidas), quando
     * o banco local está vazio ou quando a contagem do servidor difere da local (curtida pelo site, por exemplo).
     */
    suspend fun refreshLibrary(force: Boolean = false, forceLiked: Boolean = false): Library {
        val askedAt = SystemClock.elapsedRealtime()
        return libMutex.withLock {
            val cached = lastLib
            if (cached != null && (lastLibAt >= askedAt || (!force && !forceLiked && SystemClock.elapsedRealtime() - lastLibAt < LIB_TTL_MS))) {
                return@withLock cached
            }
            val lib = call { library() }
            dao.replacePlaylists(lib.playlists.mapIndexed { i, p -> p.toEntity(i) })
            val likedAt = withContext(Dispatchers.IO) { syncPrefs.getLong("likedAt", 0L) }
            // O app guarda no máximo 2000 curtidas (limite de likedTracks)
            val localLiked = dao.likedCount()
            if (forceLiked || System.currentTimeMillis() - likedAt > LIKED_TTL_MS || localLiked == 0 || localLiked != minOf(lib.likedCount, 2000)) {
                dao.replaceLiked(call { likedTracks() }.items.map { it.track })
                syncPrefs.edit().putLong("likedAt", System.currentTimeMillis()).apply()
            }
            lastLib = lib
            lastLibAt = SystemClock.elapsedRealtime()
            lib
        }
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
        // Mantém a contagem do cache em dia sem ir à rede de novo
        lastLib = lastLib?.let { it.copy(likedCount = (it.likedCount + if (liked) 1 else -1).coerceAtLeast(0)) }
    }

    // ----- Downloads (o arquivo é gravado pelo DownloadManager) -----

    val downloadedTracks: Flow<List<Track>> = dao.downloadedTracks().map { l -> l.map { it.toTrack() } }
    val downloadIds: Flow<List<String>> = dao.downloadIds()

    suspend fun saveDownload(track: Track, bytes: Long) {
        dao.upsertTracks(listOf(track.toEntity()))
        dao.insertDownload(DownloadEntity(track.id, bytes, System.currentTimeMillis()))
    }

    suspend fun deleteDownload(id: String) {
        dao.deleteDownload(id)
        dao.removeFromDownloadGroups(id)
        dao.deleteEmptyDownloadGroups()
    }

    suspend fun clearDownloads() = dao.clearDownloads()

    val downloadGroups: Flow<List<DownloadGroupRow>> = dao.downloadGroups()
    val looseDownloads: Flow<List<Track>> = dao.looseDownloads().map { l -> l.map { it.toTrack() } }
    fun downloadGroup(id: String): Flow<DownloadGroupEntity?> = dao.downloadGroup(id)
    fun downloadGroupTracks(id: String): Flow<List<Track>> = dao.downloadGroupTracks(id).map { l -> l.map { it.toTrack() } }

    suspend fun saveDownloadGroup(g: DownloadGroup, tracks: List<Track>) =
        dao.saveDownloadGroup(DownloadGroupEntity(g.id, g.title, g.kind, g.image, System.currentTimeMillis()), tracks)

    /** Apaga a coleção; devolve as músicas que só estavam nela (o DownloadManager apaga os arquivos). */
    suspend fun deleteDownloadGroup(id: String): List<String> {
        val only = dao.tracksOnlyIn(id)
        dao.deleteDownloadGroup(id)
        return only
    }

    suspend fun cachedTrack(id: String): Track? = dao.track(id)?.toTrack()

    suspend fun cacheTracks(tracks: List<Track>) = dao.upsertChangedTracks(tracks.map { it.toEntity() })

    // ----- Reprodução -----

    suspend fun playbackSession(trackId: String): PlaybackSession = call { playbackSession(TrackIdBody(trackId)) }
    /** urgent: alguém está esperando para ouvir (o servidor converte na pista expressa). */
    suspend fun requestDownload(trackId: String, urgent: Boolean): DownloadItem? =
        call { youtubeDownloads(DownloadsBody(listOf(trackId), urgent = urgent)) }.items.firstOrNull()

    /** Várias faixas num pedido só (o servidor aceita até 500 ids por vez). */
    suspend fun requestDownloads(trackIds: List<String>, urgent: Boolean) {
        trackIds.chunked(500).forEach { ids -> call { youtubeDownloads(DownloadsBody(ids, urgent = urgent)) } }
    }

    suspend fun job(jobId: String): Job? = call { youtubeJobs(jobId) }.items.firstOrNull()
    suspend fun sendEvents(events: List<PlayEvent>) = call { playbackEvents(EventsBody(events)) }

    private companion object {
        const val LIB_TTL_MS = 5 * 60 * 1000L
        const val LIKED_TTL_MS = 30 * 60 * 1000L
        /** Ids que o rádio deixa de fora: cerca de 11 KB na URL, longe do limite de 16 KB do Node e do Cloudflare. */
        const val RADIO_EXCLUDE_MAX = 300
    }
}
