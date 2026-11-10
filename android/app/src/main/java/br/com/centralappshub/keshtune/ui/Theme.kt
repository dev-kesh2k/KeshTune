package br.com.centralappshub.keshtune.ui

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithCache
import android.graphics.Bitmap
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RadialGradient
import android.graphics.Shader
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

// Mesmo visual do Kesh Car (launcher da central, deploy/car-launcher no Hub): degradê índigo → roxo → vinho,
// painéis de vidro escuro por cima e destaque rosa.
object Kesh {
    /** Cor opaca de base (atrás do degradê e onde precisa de fundo sólido). */
    val bg = Color(0xFF1E1B4B)
    /** Painel de vidro: preto translúcido por cima do degradê. */
    val surface = Color(0x40000000)
    /** Campo/chip claro translúcido. */
    val surface2 = Color(0x26FFFFFF)
    /** Fundo sólido de menus e diálogos (não podem ser transparentes). */
    val panel = Color(0xFF2A1745)
    val line = Color(0x22FFFFFF)
    val muted = Color(0xB3FFFFFF)
    val accent = Color(0xFFFF4D6D)
    val accentSoft = Color(0xFFFDA4AF)
    val accentDeep = Color(0xFFE11D48)
}

/**
 * Fundo do app, igual ao do Kesh Car: degradê diagonal e dois brilhos (rosa no alto à direita, azul embaixo à
 * esquerda). Pintado uma vez numa imagem de 1/4 do tamanho (degradê não perde nada ampliado) e só esticado a
 * cada quadro: três degradês de tela cheia por quadro pesavam na GPU da central.
 */
fun Modifier.keshBackdrop(): Modifier = drawWithCache {
    val w = size.width.toInt().coerceAtLeast(4)
    val h = size.height.toInt().coerceAtLeast(4)
    val bw = (w / 4).coerceAtLeast(1)
    val bh = (h / 4).coerceAtLeast(1)
    val bmp = Bitmap.createBitmap(bw, bh, Bitmap.Config.ARGB_8888)
    val c = android.graphics.Canvas(bmp)
    val p = Paint()
    p.shader = LinearGradient(0f, 0f, bw.toFloat(), bh.toFloat(), intArrayOf(0xFF1E1B4B.toInt(), 0xFF4C1D95.toInt(), 0xFF831843.toInt(), 0xFF7F1D1D.toInt()), null, Shader.TileMode.CLAMP)
    c.drawRect(0f, 0f, bw.toFloat(), bh.toFloat(), p)
    val r1 = bh * 0.97f
    p.shader = RadialGradient(bw - r1 * 0.15f, r1 * 0.1f, r1, 0x66EC4899, 0x00EC4899, Shader.TileMode.CLAMP)
    c.drawRect(0f, 0f, bw.toFloat(), bh.toFloat(), p)
    val r2 = bh * 0.83f
    p.shader = RadialGradient(r2 * 0.15f, bh - r2 * 0.1f, r2, 0x553B82F6, 0x003B82F6, Shader.TileMode.CLAMP)
    c.drawRect(0f, 0f, bw.toFloat(), bh.toFloat(), p)
    val img = bmp.asImageBitmap()
    onDrawBehind { drawImage(img, dstSize = IntSize(w, h), filterQuality = FilterQuality.Low) }
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
    surfaceVariant = Kesh.panel,
    onSurfaceVariant = Kesh.muted,
    surfaceContainer = Kesh.panel,
    surfaceContainerHigh = Kesh.panel,
    surfaceContainerHighest = Kesh.panel,
    surfaceContainerLow = Kesh.panel,
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
