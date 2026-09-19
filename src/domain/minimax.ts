/**
 * Cliente de la API de MiniMax (formato compatible con «chat completions»).
 *
 * El cliente recibe `fetch` por parámetro en lugar de tomarlo del entorno.
 * Así el dominio no depende del navegador y las pruebas pueden ejercitar el
 * troceado del streaming sin red y de forma determinista.
 *
 * El token nunca se registra ni se incluye en los mensajes de error: un
 * token filtrado en un log es un token comprometido.
 */

import type { Mensaje } from './artefactos';

export interface Uso {
  readonly tokensEntrada: number;
  readonly tokensSalida: number;
}

export interface RespuestaGeneracion {
  readonly contenido: string;
  readonly uso: Uso;
  /** Modelo que efectivamente atendió la petición, según la respuesta. */
  readonly modelo: string;
}

export interface OpcionesGeneracion {
  readonly baseURL: string;
  readonly token: string;
  readonly modelo: string;
  readonly mensajes: readonly Mensaje[];
  readonly temperatura: number;
  readonly maxTokens: number;
  /** Se invoca con cada fragmento de texto recibido. */
  readonly alRecibir?: (fragmento: string) => void;
  readonly señal?: AbortSignal;
  /** Inyectable para las pruebas. */
  readonly fetch?: typeof globalThis.fetch;
}

/** Error de la API que no expone el token en su mensaje. */
export class ErrorMiniMax extends Error {
  constructor(
    message: string,
    readonly estado?: number,
  ) {
    super(message);
    this.name = 'ErrorMiniMax';
  }
}

/** Mensaje legible para un fallo de red o de la API. */
export function mensajeDeError(estado: number, cuerpo: string): string {
  switch (estado) {
    case 401:
      return 'El token no es válido o expiró. Revíselo en Ajustes → Token.';
    case 403:
      return 'El token no tiene permiso para este modelo o la cuenta está inhabilitada.';
    case 429:
      return 'Se superó el límite de peticiones. Espere un momento y reintente.';
    case 400:
      return `La petición fue rechazada por la API. ${recorta(cuerpo)}`;
    default:
      return estado >= 500
        ? 'La API de MiniMax no está disponible en este momento. Reintente más tarde.'
        : `Error ${estado} de la API. ${recorta(cuerpo)}`;
  }
}

function recorta(texto: string, maximo = 200): string {
  const limpio = texto.trim();
  return limpio.length > maximo ? `${limpio.slice(0, maximo)}…` : limpio;
}

/* ── Troceado del streaming ───────────────────────────────────────── */

/**
 * Extrae el texto de una línea del protocolo «server-sent events».
 * Devuelve `null` para las líneas que no aportan contenido (vacías,
 * comentarios y la marca final `[DONE]`).
 */
export function fragmentoDeLinea(linea: string): string | null {
  const limpia = linea.trim();
  if (!limpia || limpia.startsWith(':')) return null;
  if (!limpia.startsWith('data:')) return null;

  const carga = limpia.slice(5).trim();
  if (carga === '[DONE]' || carga === '') return null;

  try {
    const json = JSON.parse(carga) as {
      choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>;
    };
    const eleccion = json.choices?.[0];
    return eleccion?.delta?.content ?? eleccion?.message?.content ?? null;
  } catch {
    // Un fragmento partido a la mitad no es un error: se ignora y el
    // siguiente trozo del buffer lo completa.
    return null;
  }
}

/** Uso declarado en una línea del stream, si la trae. */
export function usoDeLinea(linea: string): Uso | null {
  const limpia = linea.trim();
  if (!limpia.startsWith('data:')) return null;
  const carga = limpia.slice(5).trim();
  if (carga === '[DONE]' || carga === '') return null;

  try {
    const json = JSON.parse(carga) as {
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    if (!json.usage) return null;
    return {
      tokensEntrada: json.usage.prompt_tokens ?? 0,
      tokensSalida: json.usage.completion_tokens ?? 0,
    };
  } catch {
    return null;
  }
}

/* ── Llamada ──────────────────────────────────────────────────────── */

export function urlDeChat(baseURL: string): string {
  const base = baseURL.replace(/\/+$/, '');
  return `${base}/text/chatcompletion_v2`;
}

export function cuerpoDePeticion(o: OpcionesGeneracion): string {
  return JSON.stringify({
    model: o.modelo,
    messages: o.mensajes,
    temperature: o.temperatura,
    max_tokens: o.maxTokens,
    stream: true,
  });
}

/**
 * Genera un artefacto. Devuelve el texto completo y el uso reportado por la
 * API; si la API no reporta uso, los contadores quedan en cero y quien
 * llama decide si estimarlos.
 */
export async function generar(o: OpcionesGeneracion): Promise<RespuestaGeneracion> {
  if (!o.token.trim()) {
    throw new ErrorMiniMax('Falta el token de MiniMax. Configúrelo en Ajustes → Token.');
  }

  const hacerPeticion = o.fetch ?? globalThis.fetch;
  if (!hacerPeticion) {
    throw new ErrorMiniMax('El entorno no dispone de fetch.');
  }

  let respuesta: Response;
  try {
    respuesta = await hacerPeticion(urlDeChat(o.baseURL), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${o.token}`,
      },
      body: cuerpoDePeticion(o),
      signal: o.señal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ErrorMiniMax('No se pudo contactar la API de MiniMax. Revise su conexión.');
  }

  if (!respuesta.ok) {
    const cuerpo = await respuesta.text().catch(() => '');
    throw new ErrorMiniMax(mensajeDeError(respuesta.status, cuerpo), respuesta.status);
  }

  const cuerpo = respuesta.body;
  if (!cuerpo) {
    throw new ErrorMiniMax('La API devolvió una respuesta vacía.');
  }

  const lector = cuerpo.getReader();
  const decodificador = new TextDecoder();
  let pendiente = '';
  let contenido = '';
  let uso: Uso = { tokensEntrada: 0, tokensSalida: 0 };

  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;

    pendiente += decodificador.decode(value, { stream: true });

    // Se procesan solo las líneas completas; el resto queda para la
    // siguiente vuelta, porque un fragmento puede partirse entre lecturas.
    const lineas = pendiente.split('\n');
    pendiente = lineas.pop() ?? '';

    for (const linea of lineas) {
      const trozo = fragmentoDeLinea(linea);
      if (trozo) {
        contenido += trozo;
        o.alRecibir?.(trozo);
      }
      const u = usoDeLinea(linea);
      if (u) uso = u;
    }
  }

  // La última línea puede quedar sin salto final.
  if (pendiente) {
    const trozo = fragmentoDeLinea(pendiente);
    if (trozo) {
      contenido += trozo;
      o.alRecibir?.(trozo);
    }
    const u = usoDeLinea(pendiente);
    if (u) uso = u;
  }

  return { contenido, uso, modelo: o.modelo };
}
