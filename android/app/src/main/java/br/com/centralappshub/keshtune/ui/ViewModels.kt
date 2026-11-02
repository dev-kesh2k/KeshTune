package br.com.centralappshub.keshtune.ui

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import br.com.centralappshub.keshtune.data.AlbumDetail
import br.com.centralappshub.keshtune.data.ApiException
import br.com.centralappshub.keshtune.data.ArtistDetail
import br.com.centralappshub.keshtune.data.Connectivity
import br.com.centralappshub.keshtune.data.Home
import br.com.centralappshub.keshtune.data.Library
import br.com.centralappshub.keshtune.data.MixDetail
import br.com.centralappshub.keshtune.data.Mixes
import br.com.centralappshub.keshtune.data.MusicRepository
import br.com.centralappshub.keshtune.data.PlaylistDetail
import br.com.centralappshub.keshtune.data.SearchResult
import br.com.centralappshub.keshtune.data.Track
import br.com.centralappshub.keshtune.data.YtResult
import br.com.centralappshub.keshtune.data.userMessage
import br.com.centralappshub.keshtune.playback.ConvertState
import br.com.centralappshub.keshtune.playback.DownloadManager
import br.com.centralappshub.keshtune.playback.PlayerConnection
import br.com.centralappshub.keshtune.playback.StreamResolver
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.io.IOException
import javax.inject.Inject

@HiltViewModel
class LoginViewModel @Inject constructor(private val repo: MusicRepository) : ViewModel() {
    val loading = MutableStateFlow(false)
    val error = MutableStateFlow<String?>(null)
    val needOtp = MutableStateFlow(false)

    fun login(email: String, password: String, otp: String) {
        if (loading.value) return
        viewModelScope.launch {
            loading.value = true
            error.value = null
            try {
                repo.login(email, password, otp)
            } catch (e: Exception) {
                if (e is ApiException && e.code == "OTP_REQUIRED") needOtp.value = true else error.value = e.userMessage()
            } finally {
                loading.value = false
            }
        }
    }
}

@HiltViewModel
class HomeViewModel @Inject constructor(
    private val repo: MusicRepository,
    private val connectivity: Connectivity,
) : ViewModel() {
    val state = MutableStateFlow<Ui<Home>>(Ui.Loading)
    private var loadedAt = 0L
    private var job: Job? = null

    init {
        viewModelScope.launch {
            // Mostra a última Início salva (lida fora da Main) e já atualiza pela rede; o cache é lido
            // antes do refresh, então nunca sobrescreve uma resposta nova
            repo.cachedHome()?.let { if (state.value !is Ui.Ok) state.value = Ui.Ok(it) }
            refresh()
            // Deixa as curtidas e playlists prontas no banco local (Android Auto e modo sem internet),
            // só depois da Início, para não disputar a rede (e a CPU) com ela
            job?.join()
            runCatching { repo.refreshLibrary() }
        }
    }

    /** Em alta, artistas e mixes mudam: busca de novo (ignora se já houver uma busca em andamento). */
    fun refresh() {
        if (job?.isActive == true) return
        job = load(state) {
            // loadedAt só conta resposta da rede: a Início guardada (sem internet) é refeita quando a conexão voltar
            try {
                repo.fetchHome().also { loadedAt = System.currentTimeMillis() }
            } catch (e: IOException) {
                repo.cachedHome() ?: throw e
            }
        }
    }

    /** Ao voltar para a Início, atualiza se não houver lista da rede ou se ela tiver mais de 5 minutos. */
    fun refreshIfStale() {
        if (state.value !is Ui.Ok || loadedAt == 0L || System.currentTimeMillis() - loadedAt > 5 * 60_000) refresh()
    }

    /** Enquanto a Início está visível: quando a internet volta, atualiza (se a lista estiver velha). */
    suspend fun watchReconnect() {
        var wasOnline = true
        connectivity.online.collect { online ->
            if (online && !wasOnline) refreshIfStale()
            wasOnline = online
        }
    }
}

data class SearchState(
    val query: String = "",
    val loading: Boolean = false,
    val result: SearchResult? = null,
    val youtube: List<YtResult> = emptyList(),
    val error: String? = null,
)

@HiltViewModel
class SearchViewModel @Inject constructor(
    private val repo: MusicRepository,
    private val player: PlayerConnection,
) : ViewModel() {
    val state = MutableStateFlow(SearchState())
    val message = MutableStateFlow<String?>(null)
    private var job: Job? = null

    /** Resultado já buscado: voltar a um termo recente não gasta rede (nem cota do YouTube). */
    private data class Cached(val at: Long, val result: SearchResult?, val yt: List<YtResult>)

    // LRU pequeno (ordem de acesso, no máximo 20 termos); só é usado na Main, sem trava
    private val cache = object : LinkedHashMap<String, Cached>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Cached>?) = size > 20
    }

    /** Termo (normalizado) da busca que está na tela ou em andamento. */
    private var activeKey: String? = null

    /** now: busca já, sem esperar a digitação parar e sem cache (tecla Buscar, Tentar de novo). */
    fun onQuery(q: String, now: Boolean = false) {
        state.value = state.value.copy(query = q)
        val key = q.trim().lowercase()
        if (key.isEmpty()) {
            job?.cancel()
            activeKey = null
            state.value = SearchState()
            return
        }
        // Só mudou espaço ou maiúscula: a busca em andamento (ou na tela) já é a deste termo
        if (!now && key == activeKey) return
        job?.cancel()
        // Uma letra só não vale uma ida à rede enquanto digita
        if (key.length < 2 && !now) {
            activeKey = null
            // A busca cancelada pode ter deixado o "carregando" ligado
            state.value = state.value.copy(loading = false)
            return
        }
        activeKey = key
        val hit = cache[key]
        if (hit != null && !now && System.currentTimeMillis() - hit.at < 10 * 60_000) {
            state.value = state.value.copy(loading = false, result = hit.result, youtube = hit.yt, error = null)
            return
        }
        job = viewModelScope.launch {
            delay(if (now) 0 else 500)
            state.value = state.value.copy(loading = true, error = null)
            val term = q.trim()
            // O YouTube é a busca principal; do catálogo só entram álbuns e playlists
            val catalog = async { runCatching { repo.search(term) }.getOrNull() }
            try {
                // Termo curto demais para o YouTube enquanto digita (cada busca gasta cota)
                val yt = if (now || term.length >= 3) repo.youtubeSearch(term) else emptyList()
                val r = catalog.await()
                cache[key] = Cached(System.currentTimeMillis(), r, yt)
                state.value = state.value.copy(loading = false, youtube = yt, result = r)
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                val r = catalog.await()
                // Sem nada para mostrar: libera o termo para que digitar de novo (ou Tentar de novo) repita a busca
                if (r == null) activeKey = null
                state.value = state.value.copy(loading = false, youtube = emptyList(), result = r, error = if (r == null) e.userMessage() else null)
            }
        }
    }

    /** Vídeo do YouTube: cadastra no catálogo e toca (o servidor converte o áudio na hora). */
    fun playYoutube(r: YtResult) {
        viewModelScope.launch {
            try {
                player.play(listOf(repo.youtubeTrack(r.youtubeId)))
            } catch (e: Exception) {
                message.value = e.userMessage()
            }
        }
    }
}

@HiltViewModel
class DownloadsViewModel @Inject constructor(repo: MusicRepository, private val downloads: DownloadManager) : ViewModel() {
    val tracks = repo.downloadedTracks.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())
    val groups = repo.downloadGroups.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())
    val loose = repo.looseDownloads.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    fun delete(trackId: String) {
        viewModelScope.launch { downloads.delete(trackId) }
    }

    fun deleteGroup(groupId: String) {
        viewModelScope.launch { downloads.deleteGroup(groupId) }
    }
}

@HiltViewModel
class DownloadGroupViewModel @Inject constructor(
    saved: SavedStateHandle,
    repo: MusicRepository,
    private val downloads: DownloadManager,
) : ViewModel() {
    private val id: String = checkNotNull(saved["id"])
    val group = repo.downloadGroup(id).stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)
    val tracks = repo.downloadGroupTracks(id).stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    fun delete(trackId: String) {
        viewModelScope.launch { downloads.delete(trackId) }
    }
}

@HiltViewModel
class LibraryViewModel @Inject constructor(
    private val repo: MusicRepository,
    private val downloads: DownloadManager,
) : ViewModel() {
    val playlists = repo.playlists.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())
    val state = MutableStateFlow<Ui<Library>>(Ui.Loading)

    init {
        refresh()
    }

    // force: abrir a Biblioteca ou tocar em "Tentar de novo" mostra o que mudou fora do app (playlist criada no site)
    fun refresh() = load(state) { repo.refreshLibrary(force = true) }

    fun logout() {
        viewModelScope.launch {
            downloads.clearAll()
            repo.logout()
        }
    }
}

@HiltViewModel
class AlbumViewModel @Inject constructor(saved: SavedStateHandle, private val repo: MusicRepository) : ViewModel() {
    private val id: String = checkNotNull(saved["id"])
    val state = MutableStateFlow<Ui<AlbumDetail>>(Ui.Loading)

    init {
        refresh()
    }

    fun refresh() = load(state) { repo.album(id) }
}

@HiltViewModel
class ArtistViewModel @Inject constructor(saved: SavedStateHandle, private val repo: MusicRepository) : ViewModel() {
    private val id: String = checkNotNull(saved["id"])
    val state = MutableStateFlow<Ui<ArtistDetail>>(Ui.Loading)

    init {
        refresh()
    }

    fun refresh() {
        load(state) {
            repo.artist(id).also { a -> if (a.topPending) reloadPendingTop() }
        }
    }

    private var pendingTop: Job? = null

    /**
     * Primeira abertura do artista: o servidor ainda está buscando as 50 mais tocadas (top_pending) e respondeu só com
     * as do catálogo. Busca de novo em silêncio, até 3 vezes, sem trocar a tela por "carregando".
     */
    private fun reloadPendingTop() {
        if (pendingTop?.isActive == true) return
        pendingTop = viewModelScope.launch {
            repeat(3) {
                delay(6_000)
                val a = runCatching { repo.artist(id) }.getOrNull() ?: return@repeat
                state.value = Ui.Ok(a)
                if (!a.topPending) return@launch
            }
        }
    }
}

@HiltViewModel
class MixesViewModel @Inject constructor(private val repo: MusicRepository) : ViewModel() {
    val state = MutableStateFlow<Ui<Mixes>>(Ui.Loading)
    private var retries = 0

    init {
        viewModelScope.launch {
            repo.cachedMixes()?.let { if (state.value !is Ui.Ok) state.value = Ui.Ok(it) }
            refresh()
        }
    }

    fun refresh() {
        load(state) { repo.mixes() }.invokeOnCompletion {
            // Servidor recém-ligado ainda montando as playlists do YouTube Music: pede de novo daqui a pouco
            if ((state.value as? Ui.Ok)?.data?.pending == true && retries++ < 8) {
                viewModelScope.launch {
                    delay(15_000)
                    refresh()
                }
            }
        }
    }
}

@HiltViewModel
class MixViewModel @Inject constructor(saved: SavedStateHandle, private val repo: MusicRepository) : ViewModel() {
    private val id: String = checkNotNull(saved["id"])
    val state = MutableStateFlow<Ui<MixDetail>>(Ui.Loading)

    init {
        refresh()
    }

    fun refresh() = load(state) { repo.mix(id) }
}

/** Playlist: mostra a cópia local na hora e atualiza pela rede. */
@HiltViewModel
class PlaylistViewModel @Inject constructor(saved: SavedStateHandle, private val repo: MusicRepository) : ViewModel() {
    private val id: String = checkNotNull(saved["id"])
    val header = repo.playlist(id).stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)
    val tracks = repo.playlistTracks(id).stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())
    val state = MutableStateFlow<Ui<PlaylistDetail>>(Ui.Loading)

    // Playlist da biblioteca abre pela cópia local; as outras (públicas) só pela rede. A lista é
    // montada aqui uma vez por mudança, não a cada recomposição da tela
    val playTracks: StateFlow<List<Track>> = combine(state, tracks) { s, cached -> (s as? Ui.Ok)?.data?.items?.map { it.track } ?: cached }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    init {
        refresh()
    }

    fun refresh() = load(state) { repo.refreshPlaylist(id) }
}

@HiltViewModel
class LikedViewModel @Inject constructor(private val repo: MusicRepository) : ViewModel() {
    val tracks = repo.likedTracks.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())
    val state = MutableStateFlow<Ui<Library>>(Ui.Loading)

    init {
        // Tela Curtidas: desce a lista de novo, mesmo com a contagem igual (curtiu uma e descurtiu outra pelo site)
        load(state) { repo.refreshLibrary(force = true, forceLiked = true) }
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class PlayerViewModel @Inject constructor(
    val player: PlayerConnection,
    resolver: StreamResolver,
    private val repo: MusicRepository,
    private val downloads: DownloadManager,
) : ViewModel() {
    val state = player.state
    val progress = player.progress
    val converting: StateFlow<ConvertState?> = resolver.converting
    val errors = resolver.errors

    val liked: StateFlow<Boolean> = player.state
        .map { it.current?.mediaId }
        .distinctUntilChanged()
        .flatMapLatest { id -> if (id == null) flowOf(false) else repo.isLiked(id) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), false)

    val message = MutableStateFlow<String?>(null)

    fun download() {
        val id = state.value.current?.mediaId ?: return
        viewModelScope.launch {
            try {
                downloads.enqueue(listOf(repo.cachedTrack(id) ?: repo.track(id)))
            } catch (e: Exception) {
                message.value = e.userMessage()
            }
        }
    }

    fun toggleLike() {
        val id = state.value.current?.mediaId ?: return
        val now = liked.value
        viewModelScope.launch {
            try {
                val track: Track = repo.cachedTrack(id) ?: repo.track(id)
                repo.setLiked(track, !now)
                message.value = if (now) "Removida das curtidas" else "Adicionada às curtidas"
            } catch (e: Exception) {
                message.value = e.userMessage()
            }
        }
    }
}
