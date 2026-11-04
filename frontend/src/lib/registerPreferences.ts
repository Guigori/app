/** Which screen the "+" opens first: the keypad entry or Registro inteligente. Per device. */
export type RegisterDefault = "manual" | "inteligente";

const KEY = "finnos:register-default:v1";

export function getRegisterDefault(): RegisterDefault {
  try {
    return localStorage.getItem(KEY) === "inteligente" ? "inteligente" : "manual";
  } catch {
    return "manual";
  }
}

export function setRegisterDefault(value: RegisterDefault): void {
  try {
    localStorage.setItem(KEY, value);
  } catch {
    // Private mode: the choice simply isn't remembered.
  }
}
