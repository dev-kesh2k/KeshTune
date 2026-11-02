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
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
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
    connectivity: Connectivity,
) : ViewModel() {
    val state = MutableStateFlow<Ui<Home>>(repo.cachedHome()?.let { Ui.Ok(it) } ?: Ui.Loading)
    private var loadedAt = 0L

    init {
        // Em alta, artistas e mixes mudam: atualiza ao abrir e sempre que a internet volta
        refresh()
        viewModelScope.launch {
            var wasOnline = true
            connectivity.online.collect { online ->
                if (online && !wasOnline) refresh()
                wasOnline = online
            }
        }
        // Deixa as curtidas e playlists prontas no banco local (Android Auto e modo sem internet)
        viewModelScope.launch { runCatching { repo.refreshLibrary() } }
    }

    fun refresh() = load(state) { repo.home().also { loadedAt = System.currentTimeMillis() } }

    /** Ao voltar para a Início, atualiza se a lista tiver mais de 5 minutos. */
    fun refreshIfStale() {
        if (loadedAt != 0L && System.currentTimeMillis() - loadedAt > 5 * 60 * 1000) refresh()
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

    fun onQuery(q: String) {
        state.value = state.value.copy(query = q)
        job?.cancel()
        if (q.isBlank()) {
            state.value = SearchState()
            return
        }
        job = viewModelScope.launch {
            delay(400)
            state.value = state.value.copy(loading = true, error = null)
            // O YouTube é a busca principal; do catálogo só entram álbuns e playlists
            val catalog = async { runCatching { repo.search(q) }.getOrNull() }
            try {
                val yt = repo.youtubeSearch(q)
                state.value = state.value.copy(loading = false, youtube = yt, result = catalog.await())
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                val r = catalog.await()
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

    fun refresh() = load(state) { repo.refreshLibrary() }

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

    fun refresh() = load(state) { repo.artist(id) }
}

/** Playlist: mostra a cópia local na hora e atualiza pela rede. */
@HiltViewModel
class PlaylistViewModel @Inject constructor(saved: SavedStateHandle, private val repo: MusicRepository) : ViewModel() {
    private val id: String = checkNotNull(saved["id"])
    val header = repo.playlist(id).stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)
    val tracks = repo.playlistTracks(id).stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())
    val state = MutableStateFlow<Ui<PlaylistDetail>>(Ui.Loading)

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
        load(state) { repo.refreshLibrary() }
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
