package br.com.centralappshub.keshtune.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.DownloadForOffline
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.compose.runtime.Stable
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import br.com.centralappshub.keshtune.data.Track
import br.com.centralappshub.keshtune.data.YtResult
import br.com.centralappshub.keshtune.playback.PlayerConnection

/** Ações de navegação compartilhadas pelas telas. */
@Stable
class Nav(
    val album: (String) -> Unit,
    val artist: (String) -> Unit,
    val playlist: (String) -> Unit,
    val liked: () -> Unit,
    val downloads: () -> Unit,
    val mix: (String) -> Unit,
)

// ---------------- Login ----------------

@Composable
fun LoginScreen(vm: LoginViewModel = hiltViewModel()) {
    val loading by vm.loading.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    val needOtp by vm.needOtp.collectAsStateWithLifecycle()
    var email by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var otp by rememberSaveable { mutableStateOf("") }
    val submit = { vm.login(email, password, otp) }

    Box(
        Modifier.fillMaxSize()
            .background(Brush.radialGradient(listOf(Kesh.accentDeep.copy(alpha = 0.45f), Kesh.bg), radius = 1400f))
            .padding(24.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            Modifier.widthIn(max = 440.dp).clip(RoundedCornerShape(28.dp)).background(Kesh.surface.copy(alpha = 0.85f)).padding(28.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Logo(size = 48.dp)
                Spacer(Modifier.width(14.dp))
                Text("KeshTune", style = MaterialTheme.typography.headlineLarge)
            }
            Text("Entre com a sua conta", color = Kesh.muted)
            OutlinedTextField(
                email, { email = it }, label = { Text("E-mail") }, singleLine = true, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
            )
            OutlinedTextField(
                password, { password = it }, label = { Text("Senha") }, singleLine = true, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp),
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = if (needOtp) ImeAction.Next else ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { submit() }),
            )
            if (needOtp) {
                OutlinedTextField(
                    otp, { otp = it.filter(Char::isDigit).take(6) }, label = { Text("Código do autenticador") }, singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword, imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { submit() }),
                )
            }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            Button(onClick = submit, enabled = !loading && email.isNotBlank() && password.isNotBlank(), modifier = Modifier.fillMaxWidth().height(54.dp)) {
                if (loading) CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp) else Text("Entrar")
            }
        }
    }
}

// ---------------- Início ----------------

@Composable
fun HomeScreen(nav: Nav, player: PlayerConnection, vm: HomeViewModel = hiltViewModel()) {
    // Só atualiza com a Início visível (no Navigation Compose o owner é o NavBackStackEntry): ao voltar
    // para ela, se a lista estiver velha, e quando a internet volta; em outra tela ou em segundo plano, nada
    val owner = androidx.lifecycle.compose.LocalLifecycleOwner.current
    LaunchedEffect(owner) {
        owner.repeatOnLifecycle(Lifecycle.State.STARTED) {
            vm.refreshIfStale()
            vm.watchReconnect()
        }
    }
    when (val s = vm.state.collectAsStateWithLifecycle().value) {
        Ui.Loading -> Loading()
        is Ui.Error -> ErrorBox(s.message, vm::refresh)
        is Ui.Ok -> {
            val h = s.data
            LazyColumn(Modifier.fillMaxSize()) {
                item { Greeting() }
                trackShelf("Tocadas recentemente", h.recent, player)
                shelf("Artistas em alta no Brasil", h.artists) { ArtistCardView(it) { nav.artist(it.id) } }
                shelf("Seus artistas", h.myArtists) { ArtistCardView(it) { nav.artist(it.id) } }
                trackShelf("Seu mix", h.mix, player)
                trackShelf("Em alta", h.top, player)
                shelf("Suas playlists", h.myPlaylists) { PlaylistCardView(it) { nav.playlist(it.id) } }
                trackShelf("Novidades", h.fresh, player)
                shelf("Lançamentos de quem você segue", h.followedReleases) { AlbumCardView(it) { nav.album(it.id) } }
                shelf("Lançamentos", h.releases) { AlbumCardView(it) { nav.album(it.id) } }
                shelf("Playlists em destaque", h.publicPlaylists) { PlaylistCardView(it) { nav.playlist(it.id) } }
            }
        }
    }
}

/** Tocar um card toca a prateleira inteira a partir dele. */
private fun androidx.compose.foundation.lazy.LazyListScope.trackShelf(title: String, tracks: List<Track>, player: PlayerConnection) =
    shelf(title, tracks) { t -> TrackCard(t) { player.play(tracks, tracks.indexOf(t)) } }

/** Saudação conforme a hora do dia. */
@Composable
private fun Greeting() {
    val hour = remember { java.util.Calendar.getInstance().get(java.util.Calendar.HOUR_OF_DAY) }
    val text = when (hour) {
        in 5..11 -> "Bom dia"
        in 12..17 -> "Boa tarde"
        else -> "Boa noite"
    }
    Column(Modifier.padding(start = 20.dp, top = 20.dp, bottom = 4.dp)) {
        Text(text, style = MaterialTheme.typography.headlineLarge)
        Text("O que vamos ouvir na estrada?", style = MaterialTheme.typography.bodyLarge, color = Kesh.muted)
    }
}

// ---------------- Busca ----------------

@Composable
fun SearchScreen(nav: Nav, player: PlayerConnection, playingId: String?, vm: SearchViewModel = hiltViewModel()) {
    val s by vm.state.collectAsStateWithLifecycle()
    val message by vm.message.collectAsStateWithLifecycle()
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { if (s.query.isEmpty()) runCatching { focus.requestFocus() } }

    Column(Modifier.fillMaxSize()) {
        Text("Buscar", style = MaterialTheme.typography.headlineLarge, modifier = Modifier.padding(start = 20.dp, top = 16.dp))
        TextField(
            s.query, { vm.onQuery(it) },
            placeholder = { Text("Músicas, artistas, álbuns ou YouTube") },
            leadingIcon = { Icon(Icons.Default.Search, null, tint = Kesh.accentSoft) },
            trailingIcon = { if (s.query.isNotEmpty()) IconButton({ vm.onQuery("") }) { Icon(Icons.Default.Clear, "Limpar") } },
            singleLine = true,
            shape = CircleShape,
            colors = TextFieldDefaults.colors(
                focusedContainerColor = Kesh.surface2, unfocusedContainerColor = Kesh.surface2,
                focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent,
            ),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            // Tecla Buscar: busca na hora, sem esperar a digitação parar
            keyboardActions = KeyboardActions(onSearch = { vm.onQuery(s.query, now = true) }),
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp).height(60.dp).focusRequester(focus),
        )
        message?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(horizontal = 16.dp)) }
        val r = s.result
        when {
            s.loading && s.youtube.isEmpty() -> Loading()
            s.error != null && r == null && s.youtube.isEmpty() -> ErrorBox(s.error!!) { vm.onQuery(s.query, now = true) }
            else -> LazyColumn(Modifier.fillMaxSize()) {
                if (s.youtube.isNotEmpty()) {
                    item { SectionTitle("Do YouTube") }
                    itemsIndexed(s.youtube, key = { _, y -> "y:" + y.youtubeId }, contentType = { _, _ -> "youtube" }) { _, y -> YoutubeRow(y) { vm.playYoutube(y) } }
                }
                if (r != null) {
                    shelf("Álbuns", r.albums) { AlbumCardView(it) { nav.album(it.id) } }
                    shelf("Playlists", r.playlists) { PlaylistCardView(it) { nav.playlist(it.id) } }
                }
                if (s.youtube.isEmpty() && (r == null || (r.albums.isEmpty() && r.playlists.isEmpty())) && !s.loading) {
                    item { Text("Nada encontrado para \"${s.query}\"", color = Kesh.muted, modifier = Modifier.padding(16.dp)) }
                }
            }
        }
    }
}

@Composable
private fun YoutubeRow(y: YtResult, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 2.dp).clip(RoundedCornerShape(16.dp))
            .clickable(onClick = onClick).padding(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Cover(y.thumbnailUrl, 56.dp, shape = RoundedCornerShape(12.dp))
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(y.title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(y.channel, style = MaterialTheme.typography.bodyMedium, color = Kesh.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (y.durationMs > 0) Text(fmtTime(y.durationMs), color = Kesh.muted)
    }
}

// ---------------- Biblioteca ----------------

@Composable
fun LibraryScreen(nav: Nav, vm: LibraryViewModel = hiltViewModel()) {
    val playlists by vm.playlists.collectAsStateWithLifecycle()
    val s by vm.state.collectAsStateWithLifecycle()
    val lib = (s as? Ui.Ok)?.data

    LazyColumn(Modifier.fillMaxSize()) {
        item {
            Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 16.dp, top = 16.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Sua biblioteca", style = MaterialTheme.typography.headlineLarge, modifier = Modifier.weight(1f))
                RoundIconButton(Icons.AutoMirrored.Filled.Logout, "Sair", size = 48.dp, onClick = vm::logout)
            }
        }
        item {
            LibraryRow(
                title = "Músicas curtidas",
                subtitle = lib?.let { "${it.likedCount} músicas" },
                image = null,
                icon = Icons.Default.Favorite,
                onClick = nav.liked,
            )
        }
        item { LibraryRow("Baixadas", "Tocam sem internet", null, icon = Icons.Default.DownloadForOffline, onClick = nav.downloads) }
        if (s is Ui.Error && playlists.isEmpty()) item { Text((s as Ui.Error).message, color = Kesh.muted, modifier = Modifier.padding(16.dp)) }
        itemsIndexed(playlists, key = { _, p -> p.id }, contentType = { _, _ -> "playlist" }) { _, p ->
            LibraryRow(p.name, listOfNotNull("Playlist", p.ownerName).joinToString(" • "), p.image) { nav.playlist(p.id) }
        }
        if (lib != null) {
            shelf("Álbuns salvos", lib.albums) { AlbumCardView(it) { nav.album(it.id) } }
            shelf("Artistas que você segue", lib.artists) { ArtistCardView(it) { nav.artist(it.id) } }
        }
    }
}

@Composable
private fun LibraryRow(title: String, subtitle: String?, image: String?, icon: ImageVector? = null, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 3.dp).clip(RoundedCornerShape(18.dp))
            .clickable(onClick = onClick).padding(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            // Curtidas / Baixadas: bloco com degradê, como no app web
            Box(
                Modifier.size(64.dp).clip(RoundedCornerShape(14.dp))
                    .background(Brush.linearGradient(listOf(Kesh.accentDeep, Kesh.accent, Kesh.accentSoft))),
                contentAlignment = Alignment.Center,
            ) { Icon(icon, null, tint = Color.White, modifier = Modifier.size(30.dp)) }
        } else {
            Cover(image, 64.dp)
        }
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (!subtitle.isNullOrBlank()) Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = Kesh.muted, maxLines = 1)
        }
    }
}

// ---------------- Álbum, artista, playlist, curtidas ----------------

@Composable
private fun TrackListScreen(
    tracks: List<Track>,
    playingId: String?,
    player: PlayerConnection,
    header: @Composable () -> Unit,
    footer: androidx.compose.foundation.lazy.LazyListScope.() -> Unit = {},
    trailing: (@Composable (Track) -> Unit)? = null,
) {
    LazyColumn(Modifier.fillMaxSize()) {
        item(key = "header", contentType = "header") { header() }
        // A key leva o índice: uma playlist pode repetir a mesma faixa
        itemsIndexed(tracks, key = { i, t -> "$i:${t.id}" }, contentType = { _, _ -> "track" }) { i, t ->
            TrackRow(t, t.id == playingId, trailing = trailing?.let { { it(t) } }) { player.play(tracks, i) }
        }
        footer()
    }
}

@Composable
fun AlbumScreen(nav: Nav, player: PlayerConnection, playingId: String?, vm: AlbumViewModel = hiltViewModel()) {
    val downloads = LocalDownloads.current
    when (val s = vm.state.collectAsStateWithLifecycle().value) {
        Ui.Loading -> Loading()
        is Ui.Error -> ErrorBox(s.message, vm::refresh)
        is Ui.Ok -> {
            val a = s.data
            TrackListScreen(a.tracks, playingId, player, header = {
                CollectionHeader(
                    a.coverUrl, "Álbum", a.title,
                    listOfNotNull(a.artists.joinToString(", ") { it.name }, a.releaseDate?.take(4)).joinToString(" • "),
                    enabled = a.tracks.any { it.playable },
                    onPlay = { player.play(a.tracks) },
                    onShuffle = { player.play(a.tracks, shuffle = true) },
                    onDownload = { downloads?.enqueue(a.tracks) },
                )
                a.artists.firstOrNull()?.let { ar ->
                    TextButton({ nav.artist(ar.id) }, Modifier.padding(horizontal = 8.dp)) { Text("Ver ${ar.name}") }
                }
            })
        }
    }
}

@Composable
fun ArtistScreen(nav: Nav, player: PlayerConnection, playingId: String?, vm: ArtistViewModel = hiltViewModel()) {
    when (val s = vm.state.collectAsStateWithLifecycle().value) {
        Ui.Loading -> Loading()
        is Ui.Error -> ErrorBox(s.message, vm::refresh)
        is Ui.Ok -> {
            val a = s.data
            TrackListScreen(
                a.topTracks, playingId, player,
                header = {
                    CollectionHeader(
                        a.imageUrl, "Artista", a.name, null,
                        enabled = a.topTracks.any { it.playable },
                        onPlay = { player.play(a.topTracks) },
                        onShuffle = { player.play(a.topTracks, shuffle = true) },
                        imageShape = CircleShape,
                    )
                    if (a.topTracks.isNotEmpty()) SectionTitle("As ${a.topTracks.size} mais tocadas")
                },
                footer = {
                    shelf("Discografia", a.albums) { AlbumCardView(it) { nav.album(it.id) } }
                    shelf("Aparece em", a.appearsOn) { AlbumCardView(it) { nav.album(it.id) } }
                },
            )
        }
    }
}

@Composable
fun PlaylistScreen(player: PlayerConnection, playingId: String?, vm: PlaylistViewModel = hiltViewModel()) {
    val downloads = LocalDownloads.current
    val local by vm.header.collectAsStateWithLifecycle()
    // Playlist da biblioteca abre pela cópia local; as outras (públicas) só pela rede (escolha feita no VM)
    val tracks by vm.playTracks.collectAsStateWithLifecycle()
    val s by vm.state.collectAsStateWithLifecycle()
    val remote = (s as? Ui.Ok)?.data
    val name = remote?.name ?: local?.name
    val anyPlayable = remember(tracks) { tracks.any { it.playable } }
    when {
        name == null && s is Ui.Error -> ErrorBox((s as Ui.Error).message, vm::refresh)
        name == null -> Loading()
        else -> TrackListScreen(tracks, playingId, player, header = {
            CollectionHeader(
                remote?.coverUrl ?: remote?.mosaic?.firstOrNull() ?: local?.image, "Playlist", name,
                listOfNotNull(remote?.ownerName ?: local?.ownerName, "${tracks.size} músicas").joinToString(" • "),
                enabled = anyPlayable,
                onPlay = { player.play(tracks) },
                onShuffle = { player.play(tracks, shuffle = true) },
                onDownload = { downloads?.enqueue(tracks) },
            )
        })
    }
}

// ---------------- Mixes ----------------

@Composable
fun MixesScreen(nav: Nav, vm: MixesViewModel = hiltViewModel()) {
    when (val s = vm.state.collectAsStateWithLifecycle().value) {
        Ui.Loading -> Loading()
        is Ui.Error -> ErrorBox(s.message, vm::refresh)
        is Ui.Ok -> LazyColumn(Modifier.fillMaxSize()) {
            item {
                Column(Modifier.padding(start = 20.dp, top = 20.dp, bottom = 4.dp)) {
                    Text("Mixes", style = MaterialTheme.typography.headlineLarge)
                    Text("Playlists do YouTube Music e mixes feitos para você", style = MaterialTheme.typography.bodyLarge, color = Kesh.muted)
                }
            }
            s.data.sections.forEach { sec -> shelf(sec.title, sec.items) { MixCardView(it) { nav.mix(it.id) } } }
            if (s.data.pending) {
                item {
                    Row(Modifier.padding(20.dp), verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                        Spacer(Modifier.width(12.dp))
                        Text("Carregando as playlists do YouTube Music…", color = Kesh.muted)
                    }
                }
            } else if (s.data.sections.isEmpty()) {
                item { Text("Nenhum mix disponível agora.", color = Kesh.muted, modifier = Modifier.padding(20.dp)) }
            }
        }
    }
}

@Composable
fun MixScreen(player: PlayerConnection, playingId: String?, vm: MixViewModel = hiltViewModel()) {
    val downloads = LocalDownloads.current
    when (val s = vm.state.collectAsStateWithLifecycle().value) {
        Ui.Loading -> Loading()
        is Ui.Error -> ErrorBox(s.message, vm::refresh)
        is Ui.Ok -> {
            val m = s.data
            val anyPlayable = remember(m.tracks) { m.tracks.any { it.playable } }
            TrackListScreen(m.tracks, playingId, player, header = {
                CollectionHeader(
                    m.imageUrl ?: m.tracks.firstOrNull()?.coverUrl,
                    if (m.id.startsWith("RDCLAK")) "Playlist do YouTube Music" else "Mix",
                    m.title,
                    listOfNotNull(m.description?.takeIf { it.isNotBlank() }, "${m.tracks.size} músicas").joinToString(" • "),
                    enabled = anyPlayable,
                    onPlay = { player.play(m.tracks) },
                    onShuffle = { player.play(m.tracks, shuffle = true) },
                    onDownload = { downloads?.enqueue(m.tracks) },
                )
            })
        }
    }
}

@Composable
fun LikedScreen(player: PlayerConnection, playingId: String?, vm: LikedViewModel = hiltViewModel()) {
    val downloads = LocalDownloads.current
    val tracks by vm.tracks.collectAsStateWithLifecycle()
    val s by vm.state.collectAsStateWithLifecycle()
    if (tracks.isEmpty() && s is Ui.Loading) return Loading()
    TrackListScreen(tracks, playingId, player, header = {
        CollectionHeader(
            null, "Playlist", "Músicas curtidas", "${tracks.size} músicas",
            enabled = tracks.isNotEmpty(),
            onPlay = { player.play(tracks) },
            onShuffle = { player.play(tracks, shuffle = true) },
            onDownload = { downloads?.enqueue(tracks) },
        )
    })
}

@Composable
fun DownloadsScreen(player: PlayerConnection, playingId: String?, vm: DownloadsViewModel = hiltViewModel()) {
    val tracks by vm.tracks.collectAsStateWithLifecycle()
    if (tracks.isEmpty()) {
        Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
            Text("Nenhuma música baixada. Toque em ⤓ ao lado de uma música, ou em Baixar numa playlist ou álbum.", color = Kesh.muted)
        }
        return
    }
    TrackListScreen(
        tracks, playingId, player,
        header = {
            CollectionHeader(
                null, "Sem internet", "Baixadas", "${tracks.size} músicas",
                enabled = true,
                onPlay = { player.play(tracks) },
                onShuffle = { player.play(tracks, shuffle = true) },
            )
        },
        trailing = { t -> IconButton({ vm.delete(t.id) }) { Icon(Icons.Default.Delete, "Apagar download", tint = Kesh.muted) } },
    )
}
