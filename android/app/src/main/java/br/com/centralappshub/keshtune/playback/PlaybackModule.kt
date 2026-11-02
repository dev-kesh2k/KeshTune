@file:OptIn(UnstableApi::class)

package br.com.centralappshub.keshtune.playback

import android.content.Context
import androidx.media3.common.util.UnstableApi
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.cache.LeastRecentlyUsedCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import java.io.File
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object PlaybackModule {
    /**
     * Cache em disco do áudio tocado pela rede (até 200 MB, sai o menos usado). Uma pasta só pode ter um SimpleCache
     * aberto por processo, então ele vive o app inteiro e nunca recebe release().
     * Abrir bloqueia (SQLite e varredura da pasta): quem usa recebe dagger.Lazy e só abre fora da Main, e o KeshApp
     * já o abre numa thread própria ao iniciar.
     */
    @Provides
    @Singleton
    fun audioCache(@ApplicationContext c: Context): SimpleCache =
        SimpleCache(File(c.cacheDir, "audio"), LeastRecentlyUsedCacheEvictor(200L * 1024 * 1024), StandaloneDatabaseProvider(c))
}
