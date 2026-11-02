package br.com.centralappshub.keshtune.playback

import android.content.ComponentName
import android.content.Context
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import br.com.centralappshub.keshtune.data.MusicRepository
import br.com.centralappshub.keshtune.data.Track
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.guava.await
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

data class PlayerState(
    val current: MediaItem? = null,
    val isPlaying: Boolean = false,
    val buffering: Boolean = false,
    val shuffle: Boolean = false,
    val repeatMode: Int = Player.REPEAT_MODE_OFF,
    val hasNext: Boolean = false,
)

/** Lado da interface: conversa com o PlaybackService por um MediaController. */
@Singleton
class PlayerConnection @Inject constructor(
    @ApplicationContext private val context: Context,
    private val repo: MusicRepository,
) {
    private val scope = MainScope()
    private val controller = CompletableDeferred<MediaController>()
    private var connecting = false

    private val _state = MutableStateFlow(PlayerState())
    val state: StateFlow<PlayerState> = _state

    fun connect() {
        if (connecting) return
        connecting = true
        scope.launch {
            val token = SessionToken(context, ComponentName(context, PlaybackService::class.java))
            val c = MediaController.Builder(context, token).buildAsync().await()
            c.addListener(object : Player.Listener {
                override fun onEvents(player: Player, events: Player.Events) = sync(player)
            })
            sync(c)
            controller.complete(c)
        }
    }

    private fun sync(p: Player) {
        _state.value = PlayerState(
            current = p.currentMediaItem,
            isPlaying = p.isPlaying,
            buffering = p.playbackState == Player.STATE_BUFFERING,
            shuffle = p.shuffleModeEnabled,
            repeatMode = p.repeatMode,
            hasNext = p.hasNextMediaItem(),
        )
    }

    /** Posição e duração atuais, atualizadas a cada meio segundo enquanto toca (1 s parado) e alguém observa. */
    val progress: Flow<Pair<Long, Long>> = flow {
        val c = controller.await()
        while (true) {
            emit(c.currentPosition to c.duration.coerceAtLeast(0))
            delay(if (c.isPlaying) 500 else 1000)
        }
    }

    private fun withController(block: (MediaController) -> Unit) {
        scope.launch { block(controller.await()) }
    }

    fun play(tracks: List<Track>, index: Int = 0, shuffle: Boolean = false) {
        val start = tracks.getOrNull(index)
        val list = tracks.filter { it.playable }
        if (list.isEmpty()) return
        scope.launch { repo.cacheTracks(list) }
        withController { c ->
            c.shuffleModeEnabled = shuffle
            val at = if (shuffle) (list.indices).random() else list.indexOfFirst { it.id == start?.id }.coerceAtLeast(0)
            c.setMediaItems(list.map { it.toMediaItem() }, at, 0)
            c.prepare()
            c.play()
        }
    }

    fun toggle() = withController { if (it.isPlaying) it.pause() else { if (it.playbackState == Player.STATE_IDLE) it.prepare(); it.play() } }
    fun next() = withController { it.seekToNext() }
    fun previous() = withController { it.seekToPrevious() }
    fun seekTo(ms: Long) = withController { it.seekTo(ms) }
    fun toggleShuffle() = withController { it.shuffleModeEnabled = !it.shuffleModeEnabled }
    fun cycleRepeat() = withController {
        it.repeatMode = when (it.repeatMode) {
            Player.REPEAT_MODE_OFF -> Player.REPEAT_MODE_ALL
            Player.REPEAT_MODE_ALL -> Player.REPEAT_MODE_ONE
            else -> Player.REPEAT_MODE_OFF
        }
    }
}
