/**
 * Ref que põe o foco no campo quando ele aparece (no lugar do atributo autoFocus).
 * Função fixa: o React só a chama ao montar e desmontar, então não rouba o foco a cada renderização.
 */
export function focusOnMount(el: HTMLElement | null) {
  el?.focus();
}
