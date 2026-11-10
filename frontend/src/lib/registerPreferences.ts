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
    window.dispatchEvent(new Event("finnos-register-default"));
  } catch {
    // Private mode: the choice simply isn't remembered.
  }
}

const CALC_KEY = "finnos:register-calc:v1";

/** Calculator keypad (with + − × ÷) or digits only. Remembered per device, off by default. */
export function getRegisterCalc(): boolean {
  try {
    return localStorage.getItem(CALC_KEY) === "on";
  } catch {
    return false;
  }
}

export function setRegisterCalc(on: boolean): void {
  try {
    localStorage.setItem(CALC_KEY, on ? "on" : "off");
  } catch {
    // Private mode: the choice simply isn't remembered.
  }
}
