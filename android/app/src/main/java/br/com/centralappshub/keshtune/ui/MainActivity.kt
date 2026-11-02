package br.com.centralappshub.keshtune.ui

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.filled.GraphicEq
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.LibraryMusic
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.NavigationRail
import androidx.compose.material3.NavigationRailItem
import androidx.compose.material3.NavigationRailItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import br.com.centralappshub.keshtune.data.TokenStore
import br.com.centralappshub.keshtune.playback.DownloadManager
import br.com.centralappshub.keshtune.playback.PlayerConnection
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    @Inject lateinit var tokens: TokenStore
    @Inject lateinit var player: PlayerConnection
    @Inject lateinit var downloads: DownloadManager

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // App sempre escuro: ícones da barra de status claros mesmo com o sistema em tema claro
        enableEdgeToEdge(SystemBarStyle.dark(android.graphics.Color.TRANSPARENT), SystemBarStyle.dark(android.graphics.Color.TRANSPARENT))
        // Na central do carro a tela fica sempre ligada com o app aberto
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 0)
        }
        player.connect()
        setContent {
            KeshTheme {
                val loggedIn by tokens.loggedIn.collectAsStateWithLifecycle()
                if (loggedIn) CompositionLocalProvider(LocalDownloads provides downloads) { AppShell(player, downloads) } else Scaffold { pad -> Column(Modifier.padding(pad)) { LoginScreen() } }
            }
        }
    }
}

private data class Tab(val route: String, val label: String, val icon: ImageVector)

private val tabs = listOf(
    Tab("home", "Início", Icons.Default.Home),
    Tab("search", "Buscar", Icons.Default.Search),
    Tab("library", "Biblioteca", Icons.Default.LibraryMusic),
)

@Composable
private fun AppShell(player: PlayerConnection, downloads: DownloadManager) {
    val nav = rememberNavController()
    val playerVm: PlayerViewModel = hiltViewModel()
    val playerState by playerVm.state.collectAsStateWithLifecycle()
    val playingId = playerState.current?.mediaId
    val entry by nav.currentBackStackEntryAsState()
    val route = entry?.destination?.route
    val onPlayer = route == "player"
    // Central do carro (tela larga e deitada): menu na lateral
    val wide = LocalConfiguration.current.screenWidthDp >= 600
    val snackbar = remember { SnackbarHostState() }

    LaunchedEffect(Unit) { playerVm.errors.collect { snackbar.showSnackbar(it) } }
    LaunchedEffect(Unit) { downloads.messages.collect { snackbar.showSnackbar(it) } }
    val message by playerVm.message.collectAsStateWithLifecycle()
    LaunchedEffect(message) {
        message?.let {
            snackbar.showSnackbar(it)
            playerVm.message.value = null
        }
    }

    val go = Nav(
        album = { nav.navigate("album/$it") },
        artist = { nav.navigate("artist/$it") },
        playlist = { nav.navigate("playlist/$it") },
        liked = { nav.navigate("liked") },
        downloads = { nav.navigate("downloads") },
    )
    val selectTab = { r: String ->
        nav.navigate(r) {
            popUpTo(nav.graph.findStartDestination().id) { saveState = true }
            launchSingleTop = true
            restoreState = true
        }
    }
    val miniPlayer = @Composable { if (!onPlayer) MiniPlayer(playerVm) { nav.navigate("player") } }

    val railColors = NavigationRailItemDefaults.colors(
        selectedIconColor = Color.White, selectedTextColor = Color.White,
        indicatorColor = Kesh.accent.copy(alpha = 0.35f),
        unselectedIconColor = Kesh.muted, unselectedTextColor = Kesh.muted,
    )
    val barColors = NavigationBarItemDefaults.colors(
        selectedIconColor = Color.White, selectedTextColor = Color.White,
        indicatorColor = Kesh.accent.copy(alpha = 0.35f),
        unselectedIconColor = Kesh.muted, unselectedTextColor = Kesh.muted,
    )

    Scaffold(
        // Fundo com um brilho roxo no topo, em vez do preto chapado
        modifier = Modifier.background(Brush.verticalGradient(0f to Color(0xFF1A1233), 0.45f to Kesh.bg)),
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
                NavigationRail(
                    containerColor = Color.Transparent,
                    modifier = Modifier.padding(top = 12.dp),
                ) {
                    tabs.forEach { t ->
                        NavigationRailItem(
                            colors = railColors,
                            modifier = Modifier.padding(vertical = 6.dp),
                            selected = entry?.destination?.route == t.route,
                            onClick = { selectTab(t.route) },
                            icon = { Icon(t.icon, null) },
                            label = { Text(t.label) },
                        )
                    }
                }
            }
            Column(Modifier.weight(1f)) {
                NavHost(nav, startDestination = "home", modifier = Modifier.weight(1f)) {
                    composable("home") { HomeScreen(go, player) }
                    composable("search") { SearchScreen(go, player, playingId) }
                    composable("library") { LibraryScreen(go) }
                    composable("liked") { LikedScreen(player, playingId) }
                    composable("downloads") { DownloadsScreen(player, playingId) }
                    composable("album/{id}") { AlbumScreen(go, player, playingId) }
                    composable("artist/{id}") { ArtistScreen(go, player, playingId) }
                    composable("playlist/{id}") { PlaylistScreen(player, playingId) }
                    composable("player") { NowPlayingScreen(playerVm) { nav.popBackStack() } }
                }
                if (wide) miniPlayer()
            }
        }
    }
}

/** Marca do app: ondas sonoras num círculo com degradê. */
@Composable
fun Logo(modifier: Modifier = Modifier, size: Dp = 52.dp) {
    Box(
        modifier.size(size).shadow(12.dp, CircleShape, spotColor = Kesh.accent).clip(CircleShape)
            .background(Brush.linearGradient(listOf(Kesh.accentSoft, Kesh.accentDeep))),
        contentAlignment = Alignment.Center,
    ) {
        Icon(Icons.Default.GraphicEq, "KeshTune", tint = Color.White, modifier = Modifier.size(size * 0.55f))
    }
}
