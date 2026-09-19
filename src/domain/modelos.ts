/**
 * Catálogo de modelos de MiniMax y su tarifa.
 *
 * Las tarifas de un proveedor cambian sin previo aviso y no forman parte de
 * ninguna norma: por eso **ninguna se declara verificada** y todas son
 * editables desde la interfaz. Es preferible una cifra marcada como
 * pendiente de confirmar que una cifra inventada que el usuario no puede
 * distinguir de un dato oficial. Confirme siempre contra la página de
 * precios de MiniMax antes de usar el costo en una decisión real.
 */

export type ModoModelo = 'auto' | string;

export interface Modelo {
  readonly id: string;
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
    rotulo: 'MiniMax M2',
    descripcion: 'Modelo de razonamiento y código; el más capaz para generar artefactos completos.',
    contexto: 204_800,
    precioEntrada: 0.3,
    precioSalida: 1.2,
    verificado: false,
  },
  {
    id: 'MiniMax-Text-01',
    rotulo: 'MiniMax Text 01',
    descripcion: 'Modelo de texto de contexto largo, adecuado para especificaciones extensas.',
    contexto: 1_000_000,
    precioEntrada: 0.2,
    precioSalida: 1.1,
    verificado: false,
  },
] as const;

/** Modelo que se usa cuando el catálogo no reconoce el identificador. */
export const MODELO_POR_DEFECTO = 'MiniMax-M2';

export function modeloDe(id: string): Modelo {
  const encontrado = MODELOS.find((m) => m.id === id);
  if (encontrado) return encontrado;

  const respaldo = MODELOS.find((m) => m.id === MODELO_POR_DEFECTO) ?? MODELOS[0];
  if (!respaldo) throw new Error('No hay modelos configurados en el catálogo.');
  return respaldo;
}

/* ── Selección automática ─────────────────────────────────────────── */

/**
 * Resuelve el modo `auto`: elige el modelo por el tamaño de la petición.
 *
 * El criterio es deliberadamente simple y explícito —si la entrada no cabe
 * con holgura en la ventana del modelo preferido, se pasa al de contexto
 * largo— para que el usuario pueda predecir qué se va a cobrar.
 */
export function resolverModelo(modo: ModoModelo, tokensEstimados: number): Modelo {
  if (modo !== 'auto') return modeloDe(modo);

  const preferido = modeloDe(MODELO_POR_DEFECTO);
  // Se reserva un 20 % de la ventana para la respuesta.
  if (tokensEstimados <= preferido.contexto * 0.8) return preferido;

  const largo = [...MODELOS].sort((a, b) => b.contexto - a.contexto)[0];
  return largo ?? preferido;
}

/** Explicación de por qué `auto` eligió ese modelo, para mostrarla al usuario. */
export function razonSeleccion(modo: ModoModelo, tokensEstimados: number): string {
  if (modo !== 'auto') return 'Modelo fijado manualmente en Ajustes.';

  const preferido = modeloDe(MODELO_POR_DEFECTO);
  return tokensEstimados <= preferido.contexto * 0.8
    ? `La petición (~${tokensEstimados} tokens) cabe con holgura en ${preferido.rotulo}.`
    : `La petición (~${tokensEstimados} tokens) excede el 80 % del contexto de ${preferido.rotulo}; se usa el modelo de contexto largo.`;
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
 * la API en `usage`.
 */
export function estimarTokens(texto: string): number {
  if (!texto) return 0;
  return Math.ceil(texto.length / 4);
}
