@file:OptIn(UnstableApi::class)

package br.com.centralappshub.keshtune.playback

import android.app.PendingIntent
import android.content.Intent
import android.os.SystemClock
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.ResolvingDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.session.DefaultMediaNotificationProvider
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSession.MediaItemsWithStartPosition
import androidx.media3.session.SessionError
import br.com.centralappshub.keshtune.R
import br.com.centralappshub.keshtune.data.MusicRepository
import br.com.centralappshub.keshtune.data.PlayEvent
import br.com.centralappshub.keshtune.di.BareClient
import br.com.centralappshub.keshtune.ui.MainActivity
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.ListenableFuture
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.guava.future
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import javax.inject.Inject

/**
 * Player do app (ExoPlayer) exposto como MediaLibrarySession: notificação, tela de bloqueio, foco de áudio,
 * botões do volante/central e Android Auto falam com esta sessão.
 */
@AndroidEntryPoint
class PlaybackService : MediaLibraryService() {
    @Inject lateinit var repo: MusicRepository
    @Inject lateinit var resolver: StreamResolver
    @Inject @BareClient lateinit var http: OkHttpClient

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private lateinit var player: ExoPlayer
    private lateinit var browse: BrowseTree
    private var session: MediaLibrarySession? = null

    override fun onCreate() {
        super.onCreate()
        browse = BrowseTree(repo)
        // DefaultDataSource abre tanto o arquivo baixado (file://) quanto o servidor (https://)
        val dataSource = ResolvingDataSource.Factory(DefaultDataSource.Factory(this, OkHttpDataSource.Factory(http))) { spec ->
            if (spec.uri.scheme == TRACK_SCHEME) spec.withUri(resolver.resolve(spec.uri.lastPathSegment!!)) else spec
        }
        player = ExoPlayer.Builder(this)
            .setMediaSourceFactory(DefaultMediaSourceFactory(dataSource))
            .setAudioAttributes(
                AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(),
                /* handleAudioFocus = */ true,
            )
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .build()
        player.addListener(PlayerEvents())

        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        session = MediaLibrarySession.Builder(this, player, LibraryCallback()).setSessionActivity(open).build()
        setMediaNotificationProvider(DefaultMediaNotificationProvider.Builder(this).build().apply { setSmallIcon(R.drawable.ic_note) })
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaLibrarySession? = session

    override fun onTaskRemoved(rootIntent: Intent?) {
        if (!player.playWhenReady || player.mediaItemCount == 0) stopSelf()
    }

    override fun onDestroy() {
        session?.run {
            player.release()
            release()
        }
        session = null
        scope.cancel()
        super.onDestroy()
    }

    /** Monta o item tocável a partir do id: os controles (app, Android Auto) só mandam o id e os metadados. */
    private suspend fun playable(item: MediaItem): MediaItem {
        val id = item.mediaId.substringAfterLast('/')
        if (item.mediaMetadata.title != null) return item.buildUpon().setMediaId(id).setUri(trackUri(id)).build()
        val track = repo.cachedTrack(id) ?: repo.track(id)
        return track.toMediaItem()
    }

    private inner class LibraryCallback : MediaLibrarySession.Callback {
        override fun onGetLibraryRoot(
            session: MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            params: LibraryParams?,
        ): ListenableFuture<LibraryResult<MediaItem>> = scope.future { LibraryResult.ofItem(browse.root, params) }

        override fun onGetChildren(
            session: MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            parentId: String,
            page: Int,
            pageSize: Int,
            params: LibraryParams?,
        ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> = scope.future {
            runCatching { browse.children(parentId) }.fold(
                { all ->
                    val from = (page * pageSize).coerceAtMost(all.size)
                    LibraryResult.ofItemList(all.subList(from, (from + pageSize).coerceAtMost(all.size)), params)
                },
                { LibraryResult.ofError(SessionError.ERROR_IO) },
            )
        }

        override fun onGetItem(
            session: MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            mediaId: String,
        ): ListenableFuture<LibraryResult<MediaItem>> = scope.future {
            runCatching { playable(MediaItem.Builder().setMediaId(mediaId).build()) }
                .fold({ LibraryResult.ofItem(it, null) }, { LibraryResult.ofError(SessionError.ERROR_BAD_VALUE) })
        }

        override fun onAddMediaItems(
            mediaSession: MediaSession,
            controller: MediaSession.ControllerInfo,
            mediaItems: MutableList<MediaItem>,
        ): ListenableFuture<MutableList<MediaItem>> = scope.future {
            mediaItems.mapNotNull { runCatching { playable(it) }.getOrNull() }.toMutableList()
        }

        override fun onSetMediaItems(
            mediaSession: MediaSession,
            controller: MediaSession.ControllerInfo,
            mediaItems: MutableList<MediaItem>,
            startIndex: Int,
            startPositionMs: Long,
        ): ListenableFuture<MediaItemsWithStartPosition> = scope.future {
            val single = mediaItems.singleOrNull()?.mediaId
            if (single != null && '/' in single) {
                // Item escolhido numa lista do Android Auto: toca a lista toda a partir dele
                val parent = single.substringBeforeLast('/')
                val trackId = single.substringAfterLast('/')
                val tracks = runCatching { browse.tracksOf(parent) }.getOrDefault(emptyList())
                val index = tracks.indexOfFirst { it.id == trackId }
                if (index >= 0) return@future MediaItemsWithStartPosition(tracks.map { it.toMediaItem() }, index, startPositionMs)
            }
            val items = mediaItems.mapNotNull { runCatching { playable(it) }.getOrNull() }
            MediaItemsWithStartPosition(items, startIndex, startPositionMs)
        }
    }

    /** Registra o tempo ouvido de cada faixa (histórico e "Tocadas recentemente") e emenda o rádio no fim da fila. */
    private inner class PlayerEvents : Player.Listener {
        private var trackId: String? = null
        private var playedMs = 0L
        private var since = 0L
        private var extending = false

        override fun onIsPlayingChanged(isPlaying: Boolean) {
            if (isPlaying) since = SystemClock.elapsedRealtime() else accumulate()
        }

        override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
            flush()
            trackId = mediaItem?.mediaId
            since = if (player.isPlaying) SystemClock.elapsedRealtime() else 0L
            extendWithRadio()
        }

        override fun onPlaybackStateChanged(state: Int) {
            if (state == Player.STATE_ENDED) flush()
        }

        override fun onPlayerError(error: PlaybackException) {
            // Faixa que não abriu (ex.: removida, conversão falhou): segue para a próxima
            if (player.hasNextMediaItem()) {
                player.seekToNextMediaItem()
                player.prepare()
                player.play()
            }
        }

        private fun accumulate() {
            if (since > 0) playedMs += SystemClock.elapsedRealtime() - since
            since = 0L
        }

        private fun flush() {
            accumulate()
            val id = trackId
            val ms = playedMs
            playedMs = 0L
            if (id == null || ms < 1000) return
            val event = PlayEvent(id, "end", ms, iso.format(Date()))
            scope.launch { runCatching { repo.sendEvents(listOf(event)) } }
        }

        private fun extendWithRadio() {
            val current = player.currentMediaItem ?: return
            if (extending || player.repeatMode != Player.REPEAT_MODE_OFF || player.currentMediaItemIndex < player.mediaItemCount - 1) return
            extending = true
            scope.launch {
                runCatching {
                    val queued = (0 until player.mediaItemCount).map { player.getMediaItemAt(it).mediaId }
                    val radio = repo.radio(current.mediaId, queued)
                    repo.cacheTracks(radio)
                    player.addMediaItems(radio.map { it.toMediaItem() })
                }
                extending = false
            }
        }
    }

    private companion object {
        val iso = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
    }
}
