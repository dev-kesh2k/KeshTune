@file:OptIn(UnstableApi::class)

package br.com.centralappshub.keshtune.playback

import androidx.media3.common.PlaybackException
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSourceException
import androidx.media3.datasource.HttpDataSource
import br.com.centralappshub.keshtune.data.ApiException
import java.io.InterruptedIOException
import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.SocketException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.net.ssl.SSLException

/**
 * Falha de conexão (sem internet, túnel, servidor fora de alcance), e não erro do servidor ou do arquivo.
 * Nesses casos o player espera a rede voltar em vez de pular a faixa.
 */
fun Throwable?.isNetworkError(): Boolean {
    for (t in generateSequence(this) { it.cause }.take(8)) {
        when (t) {
            // O servidor respondeu: não é falta de rede, a não ser que seja o gateway (Cloudflare, túnel) avisando que
            // a origem caiu. O erro do próprio servidor vem em JSON ({ error }) e continua sendo definitivo
            is HttpDataSource.InvalidResponseCodeException ->
                return t.responseCode.isGatewayStatus() && !t.responseBody.decodeToString().trimStart().startsWith("{")
            is ApiException -> return t.status.isGatewayStatus() && t.code.startsWith("HTTP_")
            is UnknownHostException, is ConnectException, is NoRouteToHostException, is SocketTimeoutException,
            is SocketException, is SSLException, is InterruptedIOException -> return true
            is DataSourceException -> if (
                t.reason == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED ||
                t.reason == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT
            ) return true
        }
    }
    return false
}

/** 502, 503, 504 e os 520 a 530 do Cloudflare: o servidor (ou o túnel até ele) está fora do ar. */
private fun Int.isGatewayStatus(): Boolean = this == 502 || this == 503 || this == 504 || this in 520..530
