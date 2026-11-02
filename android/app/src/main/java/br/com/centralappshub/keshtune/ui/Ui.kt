package br.com.centralappshub.keshtune.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import br.com.centralappshub.keshtune.data.userMessage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch

/** Estado de uma tela que carrega da rede. */
sealed interface Ui<out T> {
    data object Loading : Ui<Nothing>
    data class Error(val message: String) : Ui<Nothing>
    data class Ok<T>(val data: T) : Ui<T>
}

/** Carrega para dentro do estado; se já havia dados, mantém na tela enquanto atualiza. */
fun <T> ViewModel.load(state: MutableStateFlow<Ui<T>>, block: suspend () -> T): Job = viewModelScope.launch {
    if (state.value !is Ui.Ok) state.value = Ui.Loading
    state.value = try {
        Ui.Ok(block())
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        if (state.value is Ui.Ok) return@launch
        Ui.Error(e.userMessage())
    }
}
