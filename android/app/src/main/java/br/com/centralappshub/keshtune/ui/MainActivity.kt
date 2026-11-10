package br.com.centralappshub.keshtune.ui

import android.Manifest
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.QueueMusic
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.LibraryMusic
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import br.com.centralappshub.keshtune.R
import br.com.centralappshub.keshtune.data.TokenStore
import br.com.centralappshub.keshtune.playback.DownloadManager
import br.com.centralappshub.keshtune.playback.PlayerConnection
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    @Inject lateinit var tokens: TokenStore
    @Inject lateinit var player: PlayerConnection
    @Inject lateinit var downloads: DownloadManager

    /**
     * Barra de cima da central (e a de navegação) recolhidas, como no Kesh Car: aparecem puxando da borda e
     * somem sozinhas depois de alguns segundos.
     */
    private fun hideSystemBars() {
        WindowCompat.getInsetsController(window, window.decorView).apply {
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            hide(WindowInsetsCompat.Type.systemBars())
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // App sempre escuro: ícones da barra de status claros mesmo com o sistema em tema claro
        enableEdgeToEdge(SystemBarStyle.dark(android.graphics.Color.TRANSPARENT), SystemBarStyle.dark(android.graphics.Color.TRANSPARENT))
        // Na central do carro a tela fica sempre ligada com o app aberto
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        hideSystemBars()
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 0)
        }
        setContent {
            KeshTheme {
                val loggedIn by tokens.loggedIn.collectAsStateWithLifecycle()
                if (loggedIn) CompositionLocalProvider(LocalDownloads provides downloads) { AppShell(player, downloads) } else Scaffold { pad -> Column(Modifier.padding(pad)) { LoginScreen() } }
            }
        }
        // O Compose pinta a tela inteira: o fundo da janela só gastaria um preenchimento a mais por quadro (overdraw)
        window.setBackgroundDrawable(null)
    }
}


private data class Tab(val route: String, val label: String, val icon: ImageVector)

private val tabs = listOf(
    Tab("home", "Início", Icons.Default.Home),
    Tab("mixes", "Mixes", Icons.AutoMirrored.Filled.QueueMusic),
    Tab("search", "Buscar", Icons.Default.Search),
    Tab("library", "Biblioteca", Icons.Default.LibraryMusic),
)

@Composable
private fun AppShell(player: PlayerConnection, downloads: DownloadManager) {
    val nav = rememberNavController()
    val playerVm: PlayerViewModel = hiltViewModel()
    // Só o id da faixa atual, e sem `by`: o NavHost lê o valor dentro de cada tela, então tocar, pausar ou
    // carregar não recompõe o AppShell nem recria o grafo de navegação
    val playingIdState = remember(playerVm) { playerVm.state.map { it.current?.mediaId }.distinctUntilChanged() }
        .collectAsStateWithLifecycle(initialValue = playerVm.state.value.current?.mediaId)
    val entry by nav.currentBackStackEntryAsState()
    val route = entry?.destination?.route
    val onPlayer = route == "player"
    // Central do carro (tela larga e deitada): menu na lateral
    val wide = LocalConfiguration.current.screenWidthDp >= 600
    val snackbar = remember { SnackbarHostState() }

    // Liga ao serviço de música depois do primeiro quadro, para não atrasar a abertura do app.
    // O connect() ignora chamadas repetidas e os comandos esperam o controller ficar pronto.
    LaunchedEffect(Unit) {
        withFrameNanos { }
        player.connect()
    }
    LaunchedEffect(Unit) { playerVm.errors.collect { snackbar.showSnackbar(it) } }
    LaunchedEffect(Unit) { downloads.messages.collect { snackbar.showSnackbar(it) } }
    val message by playerVm.message.collectAsStateWithLifecycle()
    LaunchedEffect(message) {
        message?.let {
            snackbar.showSnackbar(it)
            playerVm.message.value = null
        }
    }

    val go = remember(nav) {
        Nav(
            album = { nav.navigate("album/$it") },
            artist = { nav.navigate("artist/$it") },
            playlist = { nav.navigate("playlist/$it") },
            liked = { nav.navigate("liked") },
            downloads = { nav.navigate("downloads") },
            mix = { nav.navigate("mix/$it") },
            downloadGroup = { nav.navigate("downloads/${Uri.encode(it)}") },
        )
    }
    var homeTaps by remember { mutableIntStateOf(0) }
    val selectTab = { r: String ->
        if (r == "home") {
            homeTaps++
            // Início sempre volta para a tela inicial, de qualquer lugar (sem restaurar o artista ou álbum aberto)
            nav.navigate("home") {
                popUpTo(nav.graph.findStartDestination().id) { inclusive = false }
                launchSingleTop = true
            }
        } else {
            nav.navigate(r) {
                popUpTo(nav.graph.findStartDestination().id) { saveState = true }
                launchSingleTop = true
                restoreState = true
            }
        }
    }
    val miniPlayer = @Composable { if (!onPlayer) MiniPlayer(playerVm) { nav.navigate("player") } }

    var lastTab by rememberSaveable { mutableStateOf("home") }
    val barColors = NavigationBarItemDefaults.colors(
        selectedIconColor = Color.White, selectedTextColor = Color.White,
        indicatorColor = Color.White.copy(alpha = 0.16f),
        unselectedIconColor = Kesh.muted, unselectedTextColor = Kesh.muted,
    )

    Scaffold(
        modifier = Modifier.keshBackdrop(),
        containerColor = Color.Transparent,
        contentColor = Color.White,
        snackbarHost = { SnackbarHost(snackbar) },
        bottomBar = {
            if (!wide && !onPlayer) {
                Column {
                    miniPlayer()
                    NavigationBar(containerColor = Kesh.surface) {
                        tabs.forEach { t ->
                            NavigationBarItem(
                                colors = barColors,
                                selected = entry?.destination?.route == t.route,
                                onClick = { selectTab(t.route) },
                                icon = { Icon(t.icon, null) },
                                label = { Text(t.label) },
                            )
                        }
                    }
                }
            }
        },
    ) { pad ->
        Row(Modifier.fillMaxSize().padding(pad)) {
            if (wide && !onPlayer) {
                // Aba atual: dentro de um álbum ou artista continua marcada a aba de onde se veio
                if (tabs.any { it.route == route }) lastTab = route!!
                SideRail(selected = lastTab, onSelect = selectTab)
            }
            Column(Modifier.weight(1f)) {
                // Sem animação entre telas: na central do carro o crossfade padrão custa quadros e não ajuda.
                // O builder só captura objetos estáveis; playingIdState.value é lido dentro de cada tela.
                NavHost(
                    nav, startDestination = "home", modifier = Modifier.weight(1f),
                    enterTransition = { EnterTransition.None },
                    exitTransition = { ExitTransition.None },
                    popEnterTransition = { EnterTransition.None },
                    popExitTransition = { ExitTransition.None },
                ) {
                    composable("home") { HomeScreen(go, player, homeTaps) }
                    composable("search") { SearchScreen(go, player, playingIdState.value) }
                    composable("library") { LibraryScreen(go) }
                    composable("liked") { LikedScreen(player, playingIdState.value) }
                    composable("downloads") { DownloadsScreen(go, player, playingIdState.value) }
                    composable("downloads/{id}") { DownloadGroupScreen(player, playingIdState.value) }
                    composable("album/{id}") { AlbumScreen(go, player, playingIdState.value) }
                    composable("artist/{id}") { ArtistScreen(go, player, playingIdState.value) }
                    composable("playlist/{id}") { PlaylistScreen(player, playingIdState.value) }
                    composable("mixes") { MixesScreen(go) }
                    composable("mix/{id}") { MixScreen(player, playingIdState.value) }
                    composable("player") { NowPlayingScreen(playerVm) { nav.popBackStack() } }
                }
                if (wide) miniPlayer()
            }
        }
    }
}

/** Marca do app: o mesmo desenho do ícone (K com ondas). As camadas têm 108 de lado e a parte visível 72, daí o zoom. */
@Composable
fun Logo(modifier: Modifier = Modifier, size: Dp = 52.dp) {
    val shape = RoundedCornerShape(size * 0.28f)
    Box(modifier.size(size).shadow(8.dp, shape, spotColor = Kesh.accent).clip(shape)) {
        val zoom = Modifier.fillMaxSize().graphicsLayer(scaleX = 1.5f, scaleY = 1.5f)
        Image(painterResource(R.drawable.ic_launcher_background), null, zoom)
        Image(painterResource(R.drawable.ic_launcher_foreground), "Kesh Tune", zoom)
    }
}

/**
 * Menu lateral da central do carro: painel arredondado (como o mini player), itens do mesmo tamanho distribuídos
 * na altura, ícone grande e rótulo inteiro. Área de toque grande para usar dirigindo.
 */
@Composable
private fun SideRail(selected: String, onSelect: (String) -> Unit) {
    BoxWithConstraints(
        Modifier
            .fillMaxHeight()
            .padding(start = 12.dp, top = 12.dp, bottom = 12.dp)
            .width(104.dp)
            .background(Kesh.surface, RoundedCornerShape(28.dp)),
    ) {
        // Tela baixa (celular deitado, algumas centrais): itens mais compactos para os quatro caberem inteiros
        val compact = maxHeight < 420.dp
        Column(
            Modifier.fillMaxSize().padding(vertical = if (compact) 8.dp else 16.dp, horizontal = 8.dp),
            verticalArrangement = Arrangement.spacedBy(if (compact) 4.dp else 10.dp, Alignment.CenterVertically),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            tabs.forEach { t ->
                val on = t.route == selected
                Column(
                    Modifier
                        .fillMaxWidth()
                        .background(if (on) Color.White.copy(alpha = 0.16f) else Color.Transparent, RoundedCornerShape(20.dp))
                        .clickable { onSelect(t.route) }
                        .padding(vertical = if (compact) 7.dp else 12.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Icon(t.icon, null, tint = if (on) Color.White else Kesh.muted, modifier = Modifier.size(if (compact) 24.dp else 28.dp))
                    Spacer(Modifier.height(if (compact) 3.dp else 6.dp))
                    Text(
                        t.label,
                        style = MaterialTheme.typography.labelLarge.copy(fontSize = if (compact) 12.sp else 13.sp),
                        color = if (on) Color.White else Kesh.muted,
                        maxLines = 1,
                        softWrap = false,
                    )
                }
            }
        }
    }
}
