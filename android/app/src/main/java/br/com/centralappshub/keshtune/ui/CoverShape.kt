package br.com.centralappshub.keshtune.ui

import android.graphics.Bitmap
import android.graphics.BitmapShader
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import coil3.size.Size
import coil3.size.pxOrElse
import coil3.transform.Transformation
import kotlin.math.max

/**
 * Recorta e arredonda a capa uma vez só, no próprio bitmap (no tamanho em que vai aparecer).
 * Na GPU fraca da central, o clip arredondado de cada capa a cada quadro era o que mais pesava na rolagem.
 * [zoom] > 1 amplia além do corte central (tira as faixas pretas das capas hqdefault do YouTube).
 * [radiusFraction] é o raio do canto em fração do menor lado (0.5 = círculo).
 */
class CoverShape(private val radiusFraction: Float, private val zoom: Float = 1f) : Transformation() {
    override val cacheKey: String = "cover:$radiusFraction:$zoom"

    override suspend fun transform(input: Bitmap, size: Size): Bitmap {
        val w = size.width.pxOrElse { input.width }.coerceIn(1, 1024)
        val h = size.height.pxOrElse { input.height }.coerceIn(1, 1024)
        val out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val s = max(w.toFloat() / input.width, h.toFloat() / input.height) * zoom
        val m = Matrix().apply {
            setScale(s, s)
            postTranslate((w - input.width * s) / 2f, (h - input.height * s) / 2f)
        }
        val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG).apply {
            shader = BitmapShader(input, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP).apply { setLocalMatrix(m) }
        }
        val r = minOf(w, h) * radiusFraction
        android.graphics.Canvas(out).drawRoundRect(RectF(0f, 0f, w.toFloat(), h.toFloat()), r, r, paint)
        return out
    }
}
