@file:OptIn(UnstableApi::class)

package br.com.centralappshub.keshtune

import android.app.ActivityManager
import android.app.Application
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.cache.SimpleCache
import br.com.centralappshub.keshtune.di.ImageClient
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.SingletonImageLoader
import coil3.bitmapFactoryMaxParallelism
import coil3.disk.DiskCache
import coil3.memory.MemoryCache
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import dagger.hilt.android.HiltAndroidApp
import okhttp3.OkHttpClient
import okio.Path.Companion.toOkioPath
import javax.inject.Inject

@HiltAndroidApp
class KeshApp : Application(), SingletonImageLoader.Factory {
    /** Cliente das capas, com Dispatcher próprio; Lazy porque o Coil só pede o loader na primeira imagem. */
    @Inject
    @ImageClient
    lateinit var imageHttp: dagger.Lazy<OkHttpClient>

    @Inject
    lateinit var audioCache: dagger.Lazy<SimpleCache>

    override fun onCreate() {
        super.onCreate()
        // O SimpleCache bloqueia quem o cria (SQLite e varredura da pasta): abre já, numa thread própria, para o
        // player não esperar por ele (eMMC lento de central)
        Thread({ runCatching { audioCache.get() } }, "audio-cache").start()
    }

    /**
     * ImageLoader único do app, ajustado para central de carro (1-2 GB de RAM, CPU fraca).
     * Sem allowRgb565 (faixas visíveis nos degradês e no fundo) e sem crossfade (já vem desligado).
     * O Coil já registra os callbacks de memória, então não há onTrimMemory aqui.
     */
    override fun newImageLoader(context: PlatformContext): ImageLoader {
        val am = getSystemService(ActivityManager::class.java)
        val lowRam = am.isLowRamDevice || am.memoryClass <= 128
        return ImageLoader.Builder(context)
            .components { add(OkHttpNetworkFetcherFactory(callFactory = { imageHttp.get() })) }
            // Cache de bitmaps menor em aparelho fraco, para sobrar heap ao player e às listas.
            .memoryCache { MemoryCache.Builder().maxSizePercent(context, if (lowRam) 0.12 else 0.15).build() }
            // Mesmo diretório do padrão do Coil, para aproveitar o cache que já existe no aparelho.
            .diskCache {
                DiskCache.Builder()
                    .directory(context.cacheDir.resolve("image_cache").toOkioPath())
                    .maxSizeBytes(128L * 1024 * 1024)
                    .build()
            }
            // No máximo 2 decodificações simultâneas: CPU fraca e a UI precisa continuar fluida.
            .bitmapFactoryMaxParallelism(2)
            .build()
    }
}
