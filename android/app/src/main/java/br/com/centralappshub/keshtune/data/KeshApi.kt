package br.com.centralappshub.keshtune.data

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import retrofit2.HttpException
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.HTTP
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Path
import retrofit2.http.Query
import java.io.IOException

interface KeshApi {
    @POST("auth/login")
    suspend fun login(@Body body: LoginRequest): Tokens

    @POST("auth/logout")
    suspend fun logout()

    @GET("me")
    suspend fun me(): Me

    @GET("browse/home")
    suspend fun home(): Home

    @GET("me/library")
    suspend fun library(): Library

    @GET("me/library/tracks")
    suspend fun likedTracks(@Query("limit") limit: Int = 2000): LikedPage

    @PUT("me/library/{type}")
    suspend fun save(@Path("type") type: String, @Body body: IdsBody)

    @HTTP(method = "DELETE", path = "me/library/{type}", hasBody = true)
    suspend fun unsave(@Path("type") type: String, @Body body: IdsBody)

    @GET("albums/{id}")
    suspend fun album(@Path("id") id: String): AlbumDetail

    @GET("artists/{id}")
    suspend fun artist(@Path("id") id: String): ArtistDetail

    @GET("playlists/{id}")
    suspend fun playlist(@Path("id") id: String): PlaylistDetail

    @GET("tracks/{id}")
    suspend fun track(@Path("id") id: String): Track

    /** O app só mostra álbuns e playlists do catálogo (o YouTube é a busca principal); dym=0 dispensa o "você quis dizer". */
    @GET("search")
    suspend fun search(
        @Query("q") q: String,
        @Query("type") type: String = "album,playlist",
        @Query("limit") limit: Int = 12,
        @Query("dym") dym: Int = 0,
    ): SearchResult

    @GET("youtube/mixes")
    suspend fun mixes(): Mixes

    @GET("youtube/mixes/{id}")
    suspend fun mix(@Path("id") id: String): MixDetail

    @GET("youtube/search")
    suspend fun youtubeSearch(@Query("q") q: String): YtSearch

    /** warm=1: o servidor já descobre a URL do áudio (o app toca pelo stream; o site, não). */
    @POST("youtube/tracks")
    suspend fun youtubeTrack(@Body body: YtTrackBody, @Query("warm") warm: Int = 1): Track

    @POST("youtube/downloads")
    suspend fun youtubeDownloads(@Body body: DownloadsBody): DownloadsResponse

    @GET("youtube/jobs")
    suspend fun youtubeJobs(@Query("ids") ids: String): JobsResponse

    @GET("radio")
    suspend fun radio(
        @Query("seed_type") seedType: String,
        @Query("id") id: String,
        @Query("exclude") exclude: String = "",
        @Query("limit") limit: Int = 30,
    ): TrackList

    @POST("playback/session")
    suspend fun playbackSession(@Body body: TrackIdBody): PlaybackSession

    @POST("playback/events")
    suspend fun playbackEvents(@Body body: EventsBody)
}

/** Erro da API no formato { error: { code, message } }. */
class ApiException(val status: Int, val code: String, message: String) : IOException(message)

fun Throwable.toApiException(json: Json): Throwable {
    if (this !is HttpException) return this
    val body = response()?.errorBody()?.string().orEmpty()
    return runCatching {
        val err = json.parseToJsonElement(body).jsonObject["error"]!!.jsonObject
        ApiException(code(), err["code"]?.jsonPrimitive?.content ?: "ERROR", err["message"]?.jsonPrimitive?.content ?: message())
    }.getOrElse { ApiException(code(), "HTTP_${code()}", "Erro ${code()} do servidor") }
}

/** Mensagem curta para mostrar na tela. */
fun Throwable.userMessage(): String = when (this) {
    is ApiException -> message ?: "Erro do servidor"
    is IOException -> "Sem conexão com o servidor"
    else -> message ?: "Algo deu errado"
}
