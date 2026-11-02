package br.com.centralappshub.keshtune.di

import android.content.Context
import androidx.room.Room
import androidx.room.RoomDatabase
import br.com.centralappshub.keshtune.BuildConfig
import br.com.centralappshub.keshtune.data.AuthInterceptor
import br.com.centralappshub.keshtune.data.KeshApi
import br.com.centralappshub.keshtune.data.KeshDatabase
import br.com.centralappshub.keshtune.data.LibraryDao
import br.com.centralappshub.keshtune.data.TokenRefresher
import br.com.centralappshub.keshtune.data.TokenStore
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNamingStrategy
import okhttp3.Dispatcher
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import java.util.concurrent.TimeUnit
import javax.inject.Qualifier
import javax.inject.Singleton

/** Cliente sem token: renovação de sessão e download do áudio (as URLs de áudio já vêm assinadas). */
@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class BareClient

/** Cliente das capas (Coil): mesmo pool de conexões e TLS do [BareClient], mas com Dispatcher próprio. */
@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class ImageClient

@Module
@InstallIn(SingletonComponent::class)
object AppModule {
    @OptIn(ExperimentalSerializationApi::class)
    @Provides
    @Singleton
    fun json(): Json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        coerceInputValues = true
        namingStrategy = JsonNamingStrategy.SnakeCase
    }

    @Provides
    @Singleton
    @BareClient
    fun bareClient(): OkHttpClient = OkHttpClient.Builder()
        // Connect e read folgados: o áudio e o youtube/stream esperam o yt-dlp antes do primeiro byte.
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        // Ping no HTTP/2 derruba logo a conexão morta (túnel, troca de antena) em vez de esperar o read estourar.
        .pingInterval(20, TimeUnit.SECONDS)
        .build()

    /**
     * Capas: as vagas por host ficam num Dispatcher só delas, para uma rajada de imagens (rolar a lista)
     * não segurar o áudio nem as chamadas da API. Conexões e TLS continuam compartilhados.
     */
    @Provides
    @Singleton
    @ImageClient
    fun imageClient(@BareClient bare: OkHttpClient): OkHttpClient = bare.newBuilder()
        .dispatcher(Dispatcher().apply { maxRequests = 8; maxRequestsPerHost = 4 })
        .build()

    @Provides
    @Singleton
    fun apiClient(@BareClient bare: OkHttpClient, tokens: TokenStore, json: Json): OkHttpClient = bare.newBuilder()
        // Conectar à API é rápido; sem rede, desiste cedo. Read segue em 30 s e sem callTimeout:
        // artists/:id e youtube/search esperam o yt-dlp no servidor.
        .connectTimeout(8, TimeUnit.SECONDS)
        .addInterceptor(AuthInterceptor(tokens))
        .authenticator(TokenRefresher(tokens, json, bare))
        .build()

    @Provides
    @Singleton
    fun api(client: OkHttpClient, json: Json): KeshApi = Retrofit.Builder()
        .baseUrl("${BuildConfig.APP_URL}api/")
        .client(client)
        .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
        .build()
        .create(KeshApi::class.java)

    @Provides
    @Singleton
    fun database(@ApplicationContext context: Context): KeshDatabase =
        Room.databaseBuilder(context, KeshDatabase::class.java, "keshtune.db")
            .fallbackToDestructiveMigration(dropAllTables = true)
            // WAL: leituras da UI não esperam as gravações da sincronização.
            .setJournalMode(RoomDatabase.JournalMode.WRITE_AHEAD_LOGGING)
            .build()

    @Provides
    fun libraryDao(db: KeshDatabase): LibraryDao = db.library()
}
