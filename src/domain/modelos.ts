/**
 * Catálogo de modelos y su tarifa.
 *
 * Las tarifas de un proveedor cambian sin previo aviso y no forman parte de
 * ninguna norma: por eso **ninguna se declara verificada** y todas son
 * editables desde la interfaz. Es preferible una cifra marcada como
 * pendiente de confirmar que una cifra inventada que el usuario no puede
 * distinguir de un dato oficial. Confirme siempre contra la página de
 * precios del proveedor antes de usar el costo en una decisión real.
 */

import { PROVEEDORES, type Proveedor } from './ia';

export type ModoModelo = 'auto' | string;

export interface Modelo {
  readonly id: string;
  readonly proveedor: Proveedor;
  readonly rotulo: string;
  readonly descripcion: string;
  /** Ventana de contexto en tokens, según la documentación del proveedor. */
  readonly contexto: number;
  /** Precio por millón de tokens de entrada, en dólares. */
  readonly precioEntrada: number;
  /** Precio por millón de tokens de salida, en dólares. */
  readonly precioSalida: number;
  /**
   * `false` mientras la tarifa no se haya contrastado contra la página de
   * precios vigente. Todas nacen en `false` a propósito.
   */
  readonly verificado: boolean;
}

export const MODELOS: readonly Modelo[] = [
  {
    id: 'MiniMax-M2',
    proveedor: 'minimax',
    rotulo: 'MiniMax M2',
    descripcion: 'Razonamiento y código; el más capaz para generar artefactos completos.',
    contexto: 204_800,
    precioEntrada: 0.3,
    precioSalida: 1.2,
    verificado: false,
  },
  {
    id: 'MiniMax-Text-01',
    proveedor: 'minimax',
    rotulo: 'MiniMax Text 01',
    descripcion: 'Contexto largo, adecuado para especificaciones extensas.',
    contexto: 1_000_000,
    precioEntrada: 0.2,
    precioSalida: 1.1,
    verificado: false,
  },
  {
    id: 'gemini-2.5-pro',
    proveedor: 'gemini',
    rotulo: 'Gemini 2.5 Pro',
    descripcion: 'El más capaz de Google; razonamiento extendido y contexto muy largo.',
    contexto: 1_048_576,
    precioEntrada: 1.25,
    precioSalida: 10,
    verificado: false,
  },
  {
    id: 'gemini-2.5-flash',
    proveedor: 'gemini',
    rotulo: 'Gemini 2.5 Flash',
    descripcion: 'Equilibrio entre costo y capacidad; suficiente para la mayoría de artefactos.',
    contexto: 1_048_576,
    precioEntrada: 0.3,
    precioSalida: 2.5,
    verificado: false,
  },
] as const;

/** Modelo preferido de cada proveedor cuando el modo es automático. */
export const PREFERIDO: Record<Proveedor, string> = {
  minimax: 'MiniMax-M2',
  gemini: 'gemini-2.5-flash',
};

export function modelosDe(proveedor: Proveedor): readonly Modelo[] {
  return MODELOS.filter((m) => m.proveedor === proveedor);
}

export function modeloDe(id: string, proveedor?: Proveedor): Modelo {
  const exacto = MODELOS.find((m) => m.id === id && (!proveedor || m.proveedor === proveedor));
  if (exacto) return exacto;

  const respaldo = proveedor
    ? MODELOS.find((m) => m.id === PREFERIDO[proveedor])
    : MODELOS.find((m) => m.id === PREFERIDO.minimax);
  const cualquiera = respaldo ?? MODELOS[0];
  if (!cualquiera) throw new Error('No hay modelos configurados en el catálogo.');
  return cualquiera;
}

/* ── Selección automática ─────────────────────────────────────────── */

/**
 * Resuelve el modo `auto` dentro del proveedor elegido: toma el modelo
 * preferido y, si la petición no cabe con holgura, pasa al de contexto más
 * largo del mismo proveedor. El criterio es deliberadamente simple para
 * que el usuario pueda predecir qué se va a cobrar.
 */
export function resolverModelo(
  modo: ModoModelo,
  tokensEstimados: number,
  proveedor: Proveedor,
): Modelo {
  if (modo !== 'auto') return modeloDe(modo, proveedor);

  const disponibles = modelosDe(proveedor);
  const preferido = modeloDe(PREFERIDO[proveedor], proveedor);
  // Se reserva un 20 % de la ventana para la respuesta.
  if (tokensEstimados <= preferido.contexto * 0.8) return preferido;

  const largo = [...disponibles].sort((a, b) => b.contexto - a.contexto)[0];
  return largo ?? preferido;
}

/** Explicación de por qué `auto` eligió ese modelo, para mostrarla al usuario. */
export function razonSeleccion(
  modo: ModoModelo,
  tokensEstimados: number,
  proveedor: Proveedor,
): string {
  if (modo !== 'auto') return 'Modelo fijado manualmente en Ajustes.';

  const preferido = modeloDe(PREFERIDO[proveedor], proveedor);
  return tokensEstimados <= preferido.contexto * 0.8
    ? `La petición (~${tokensEstimados} tokens) cabe con holgura en ${preferido.rotulo}.`
    : `La petición (~${tokensEstimados} tokens) excede el 80 % del contexto de ${preferido.rotulo}; se usa el modelo de contexto largo de ${PROVEEDORES[proveedor].rotulo}.`;
}

/* ── Costo ────────────────────────────────────────────────────────── */

export interface Costo {
  readonly entrada: number;
  readonly salida: number;
  readonly total: number;
}

/** Costo en dólares de una llamada, a partir de los tokens consumidos. */
export function costoDe(modelo: Modelo, tokensEntrada: number, tokensSalida: number): Costo {
  const entrada = (Math.max(0, tokensEntrada) / 1_000_000) * modelo.precioEntrada;
  const salida = (Math.max(0, tokensSalida) / 1_000_000) * modelo.precioSalida;
  return { entrada, salida, total: entrada + salida };
}

/**
 * Estimación del número de tokens de un texto.
 *
 * No es una tokenización real: es una aproximación por caracteres, que para
 * español y código ronda los cuatro caracteres por token. Sirve para avisar
 * antes de enviar, no para facturar; el conteo que vale es el que devuelve
 * la API.
 */
export function estimarTokens(texto: string): number {
  if (!texto) return 0;
  return Math.ceil(texto.length / 4);
}
