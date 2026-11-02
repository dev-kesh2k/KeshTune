package br.com.centralappshub.keshtune.playback

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.media3.common.util.BitmapLoader
import androidx.media3.common.util.UnstableApi
import coil3.SingletonImageLoader
import coil3.request.CachePolicy
import coil3.request.ErrorResult
import coil3.request.ImageRequest
import coil3.request.SuccessResult
import coil3.request.allowHardware
import coil3.size.Precision
import coil3.toBitmap
import com.google.common.util.concurrent.ListenableFuture
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.guava.future
import java.io.IOException

/**
 * Capas da notificação, da tela de bloqueio e da central pelo Coil: aproveita o cache em disco das telas do app
 * e entrega a imagem já reduzida (~512 px), em vez de baixar e decodificar a capa inteira de novo.
 */
@UnstableApi
class CoilBitmapLoader(private val context: Context, private val scope: CoroutineScope) : BitmapLoader {
    override fun supportsMimeType(mimeType: String): Boolean = mimeType.startsWith("image/")

    override fun decodeBitmap(data: ByteArray): ListenableFuture<Bitmap> = scope.future(Dispatchers.Default) {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(data, 0, data.size, bounds)
        var sample = 1
        while (bounds.outWidth / (sample * 2) >= MAX_PX && bounds.outHeight / (sample * 2) >= MAX_PX) sample *= 2
        BitmapFactory.decodeByteArray(data, 0, data.size, BitmapFactory.Options().apply { inSampleSize = sample })
            ?: throw IOException("Imagem inválida")
    }

    override fun loadBitmap(uri: Uri): ListenableFuture<Bitmap> = scope.future {
        val request = ImageRequest.Builder(context)
            .data(uri.toString())
            .size(MAX_PX)
            .precision(Precision.INEXACT)
            // A sessão copia o bitmap para a notificação: bitmap de hardware não pode ser copiado
            .allowHardware(false)
            // A tela já guarda as capas na memória; aqui o bitmap vai para a sessão e não precisa de outra cópia
            .memoryCachePolicy(CachePolicy.DISABLED)
            .build()
        val r = SingletonImageLoader.get(context).execute(request)
        if (r is SuccessResult) r.image.toBitmap() else throw IOException("Capa indisponível", (r as? ErrorResult)?.throwable)
    }

    private companion object {
        const val MAX_PX = 512
    }
}
