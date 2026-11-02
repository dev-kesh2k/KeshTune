package br.com.centralappshub.keshtune.di

import android.content.Context
import androidx.room.Room
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
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    @Provides
    @Singleton
    fun apiClient(@BareClient bare: OkHttpClient, tokens: TokenStore, json: Json): OkHttpClient = bare.newBuilder()
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
            .build()

    @Provides
    fun libraryDao(db: KeshDatabase): LibraryDao = db.library()
}
