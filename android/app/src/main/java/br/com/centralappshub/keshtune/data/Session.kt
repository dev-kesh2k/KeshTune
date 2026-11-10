package br.com.centralappshub.keshtune.data

import android.content.Context
import br.com.centralappshub.keshtune.BuildConfig
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.Authenticator
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.Route
import javax.inject.Inject
import javax.inject.Singleton

/** APK de um aparelho fixo (multimídia do carro) com chave própria: entra sozinho, sem tela de login. */
val deviceLogin: Boolean get() = BuildConfig.DEVICE_KEY.isNotEmpty()

/** Tokens de acesso guardados no aparelho; o refresh token gira a cada renovação. */
@Singleton
class TokenStore @Inject constructor(@ApplicationContext context: Context) {
    private val prefs = context.getSharedPreferences("auth", Context.MODE_PRIVATE)
    private val _loggedIn = MutableStateFlow(deviceLogin || prefs.getString(REFRESH, null) != null)
    val loggedIn: StateFlow<Boolean> = _loggedIn

    val access: String? get() = prefs.getString(ACCESS, null)
    val refresh: String? get() = prefs.getString(REFRESH, null)

    fun save(t: Tokens) {
        prefs.edit().putString(ACCESS, t.accessToken).putString(REFRESH, t.refreshToken).apply()
        _loggedIn.value = true
    }

    fun clear() {
        prefs.edit().clear().apply()
        // Com chave de aparelho continua "logado": a próxima requisição abre uma sessão nova sozinha
        _loggedIn.value = deviceLogin
    }

    private companion object {
        const val ACCESS = "access"
        const val REFRESH = "refresh"
    }
}

class AuthInterceptor(private val tokens: TokenStore) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val token = tokens.access ?: return chain.proceed(chain.request())
        return chain.proceed(chain.request().newBuilder().header("Authorization", "Bearer $token").build())
    }
}

/** No 401, renova o token uma vez e repete a requisição; se a sessão expirou, desloga. */
class TokenRefresher(
    private val tokens: TokenStore,
    private val json: Json,
    private val bare: OkHttpClient,
) : Authenticator {
    override fun authenticate(route: Route?, response: Response): Request? {
        if (response.request.url.encodedPath.endsWith("/auth/login") || response.priorResponse != null) return null
        val sent = response.request.header("Authorization")?.removePrefix("Bearer ")
        synchronized(this) {
            // Outra requisição já renovou enquanto esta esperava
            val current = tokens.access
            if (current != null && current != sent) return withToken(response.request, current)
            val refresh = tokens.refresh ?: return deviceSession()?.let { withToken(response.request, it.accessToken) }
            val req = Request.Builder()
                .url("${BuildConfig.APP_URL}api/auth/refresh")
                .post(json.encodeToString(RefreshRequest(refresh)).toRequestBody("application/json".toMediaType()))
                .build()
            val fresh = runCatching {
                bare.newCall(req).execute().use { r ->
                    when {
                        r.isSuccessful -> json.decodeFromString<Tokens>(r.body!!.string())
                        r.code == 401 || r.code == 403 -> null.also { tokens.clear() }
                        else -> null
                    }
                }
            }.getOrNull() ?: if (tokens.refresh == null) deviceSession() ?: return null else return null
            tokens.save(fresh)
            return withToken(response.request, fresh.accessToken)
        }
    }

    /** Abre uma sessão nova com a chave do aparelho (só no APK da multimídia). */
    private fun deviceSession(): Tokens? {
        if (!deviceLogin) return null
        val req = Request.Builder()
            .url("${BuildConfig.APP_URL}api/auth/device")
            .post(json.encodeToString(DeviceLoginRequest(BuildConfig.DEVICE_KEY)).toRequestBody("application/json".toMediaType()))
            .build()
        val t = runCatching {
            bare.newCall(req).execute().use { r -> if (r.isSuccessful) json.decodeFromString<Tokens>(r.body!!.string()) else null }
        }.getOrNull() ?: return null
        tokens.save(t)
        return t
    }

    private fun withToken(r: Request, token: String) = r.newBuilder().header("Authorization", "Bearer $token").build()
}
