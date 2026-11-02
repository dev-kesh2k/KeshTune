package br.com.centralappshub.keshtune.ui

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

// Mesmas cores do app web (frontend/tailwind.config.js)
object Kesh {
    val bg = Color(0xFF09090D)
    val surface = Color(0xFF13131A)
    val surface2 = Color(0xFF1C1C26)
    val line = Color(0xFF2A2A37)
    val muted = Color(0xFF9D9DB2)
    val accent = Color(0xFF8B5CF6)
    val accentSoft = Color(0xFFA78BFA)
    val accentDeep = Color(0xFF6D28D9)
}

private val shapes = Shapes(
    extraSmall = RoundedCornerShape(10.dp),
    small = RoundedCornerShape(14.dp),
    medium = RoundedCornerShape(18.dp),
    large = RoundedCornerShape(24.dp),
    extraLarge = RoundedCornerShape(32.dp),
)

private val colors = darkColorScheme(
    primary = Kesh.accent,
    onPrimary = Color.White,
    secondary = Kesh.accentSoft,
    background = Kesh.bg,
    onBackground = Color.White,
    surface = Kesh.bg,
    onSurface = Color.White,
    surfaceVariant = Kesh.surface2,
    onSurfaceVariant = Kesh.muted,
    surfaceContainer = Kesh.surface,
    surfaceContainerHigh = Kesh.surface2,
    outline = Kesh.line,
)

// Letras um pouco maiores que o padrão: a tela do carro fica mais longe dos olhos
private val type = Typography(
    headlineLarge = TextStyle(fontSize = 28.sp, fontWeight = FontWeight.Bold),
    headlineSmall = TextStyle(fontSize = 22.sp, fontWeight = FontWeight.Bold),
    titleLarge = TextStyle(fontSize = 20.sp, fontWeight = FontWeight.Bold),
    titleMedium = TextStyle(fontSize = 17.sp, fontWeight = FontWeight.SemiBold),
    bodyLarge = TextStyle(fontSize = 16.sp),
    bodyMedium = TextStyle(fontSize = 14.sp),
    labelLarge = TextStyle(fontSize = 15.sp, fontWeight = FontWeight.SemiBold),
)

@Composable
fun KeshTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = colors, typography = type, shapes = shapes) {
        // Texto e ícones brancos por padrão em qualquer tela, mesmo sobre fundos transparentes
        CompositionLocalProvider(LocalContentColor provides Color.White, content = content)
    }
}
