/**
 * Cliente de modelos de lenguaje, con dos proveedores intercambiables.
 *
 * MiniMax y Gemini no comparten protocolo: difieren en la ruta, en la
 * cabecera de autenticación, en la forma del cuerpo y en dónde ponen el
 * texto dentro de cada fragmento del flujo. Aquí esas cuatro diferencias
 * se aíslan en un adaptador por proveedor, y el resto del programa habla
 * con una sola función `generar`.
 *
 * El cliente recibe `fetch` por parámetro en lugar de tomarlo del entorno,
 * de modo que el dominio no depende del navegador y las pruebas pueden
 * ejercitar el troceado del flujo sin red y de forma determinista.
 *
 * El token nunca se registra, nunca entra en el cuerpo y nunca viaja en la
 * URL: un token en una barra de direcciones queda en el historial, en los
 * registros del servidor y en el encabezado `Referer`.
 */

import type { Mensaje } from './artefactos';

export type Proveedor = 'minimax' | 'gemini';

export interface Uso {
  readonly tokensEntrada: number;
  readonly tokensSalida: number;
}

export interface RespuestaGeneracion {
  readonly contenido: string;
  readonly uso: Uso;
  readonly modelo: string;
  readonly proveedor: Proveedor;
}

export interface OpcionesGeneracion {
  readonly proveedor: Proveedor;
  readonly baseURL: string;
  readonly token: string;
  readonly modelo: string;
  readonly mensajes: readonly Mensaje[];
  readonly temperatura: number;
  readonly maxTokens: number;
  readonly alRecibir?: (fragmento: string) => void;
  readonly señal?: AbortSignal;
  /** Inyectable para las pruebas. */
  readonly fetch?: typeof globalThis.fetch;
}

/** Error de la API que no expone el token en su mensaje. */
export class ErrorIA extends Error {
  constructor(
    message: string,
    readonly estado?: number,
    readonly proveedor?: Proveedor,
  ) {
    super(message);
    this.name = 'ErrorIA';
  }
}

/* ── Datos de cada proveedor ──────────────────────────────────────── */

export interface FichaProveedor {
  readonly id: Proveedor;
  readonly rotulo: string;
  readonly baseURLPorDefecto: string;
  /** Dónde se obtiene la clave, para enlazarlo desde la interfaz. */
  readonly consola: string;
  /** Nombre de la variable de entorno que la aplicación lee. */
  readonly variableEntorno: string;
}

export const PROVEEDORES: Record<Proveedor, FichaProveedor> = {
  minimax: {
    id: 'minimax',
    rotulo: 'MiniMax',
    baseURLPorDefecto: 'https://api.minimax.io/v1',
    consola: 'https://www.minimax.io/platform',
    variableEntorno: 'VITE_MINIMAX_API_KEY',
  },
  gemini: {
    id: 'gemini',
    rotulo: 'Google Gemini',
    baseURLPorDefecto: 'https://generativelanguage.googleapis.com/v1beta',
    consola: 'https://aistudio.google.com/apikey',
    variableEntorno: 'VITE_GEMINI_API_KEY',
  },
};

export function esProveedor(valor: unknown): valor is Proveedor {
  return valor === 'minimax' || valor === 'gemini';
}

/* ── Ruta y cabeceras ─────────────────────────────────────────────── */

export function urlDeChat(proveedor: Proveedor, baseURL: string, modelo: string): string {
  const base = baseURL.replace(/\/+$/, '');
  if (proveedor === 'minimax') return `${base}/text/chatcompletion_v2`;
  // `alt=sse` es lo que hace que Gemini emita eventos de servidor en vez de
  // un arreglo JSON que solo se puede leer cuando termina.
  return `${base}/models/${encodeURIComponent(modelo)}:streamGenerateContent?alt=sse`;
}

/**
 * Cabeceras de autenticación. Gemini admite la clave como parámetro de
 * consulta, pero aquí va siempre en cabecera: en la URL quedaría escrita
 * en el historial del navegador y en los registros de cualquier
 * intermediario.
 */
export function cabecerasDe(proveedor: Proveedor, token: string): Record<string, string> {
  const comunes = { 'Content-Type': 'application/json' };
  return proveedor === 'minimax'
    ? { ...comunes, Authorization: `Bearer ${token}` }
    : { ...comunes, 'x-goog-api-key': token };
}

/* ── Cuerpo de la petición ────────────────────────────────────────── */

export function cuerpoDePeticion(o: {
  proveedor: Proveedor;
  modelo: string;
  mensajes: readonly Mensaje[];
  temperatura: number;
  maxTokens: number;
}): string {
  if (o.proveedor === 'minimax') {
    return JSON.stringify({
      model: o.modelo,
      messages: o.mensajes,
      temperature: o.temperatura,
      max_tokens: o.maxTokens,
      stream: true,
    });
  }

  // Gemini separa la instrucción de sistema del resto y llama «model» al
  // papel del asistente.
  const sistema = o.mensajes.filter((m) => m.role === 'system').map((m) => m.content);
  const resto = o.mensajes.filter((m) => m.role !== 'system');

  return JSON.stringify({
    ...(sistema.length > 0
      ? { systemInstruction: { parts: sistema.map((text) => ({ text })) } }
      : {}),
    contents: resto.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
    generationConfig: {
      temperature: o.temperatura,
      maxOutputTokens: o.maxTokens,
    },
  });
}

/* ── Troceado del flujo ───────────────────────────────────────────── */

function cargaSSE(linea: string): string | null {
  const limpia = linea.trim();
  if (!limpia || limpia.startsWith(':')) return null;
  if (!limpia.startsWith('data:')) return null;
  const carga = limpia.slice(5).trim();
  return carga === '' || carga === '[DONE]' ? null : carga;
}

/**
 * Texto de una línea del flujo. Devuelve `null` para las que no aportan
 * contenido —vacías, comentarios, la marca final— y también para un JSON
 * partido a la mitad, que no es un error: el siguiente trozo lo completa.
 */
export function fragmentoDeLinea(proveedor: Proveedor, linea: string): string | null {
  const carga = cargaSSE(linea);
  if (carga === null) return null;

  try {
    if (proveedor === 'minimax') {
      const json = JSON.parse(carga) as {
        choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>;
      };
      const eleccion = json.choices?.[0];
      return eleccion?.delta?.content ?? eleccion?.message?.content ?? null;
    }

    const json = JSON.parse(carga) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const partes = json.candidates?.[0]?.content?.parts;
    if (!partes) return null;
    const texto = partes.map((p) => p.text ?? '').join('');
    return texto === '' ? null : texto;
  } catch {
    return null;
  }
}

/** Uso declarado en una línea del flujo, si la trae. */
export function usoDeLinea(proveedor: Proveedor, linea: string): Uso | null {
  const carga = cargaSSE(linea);
  if (carga === null) return null;

  try {
    if (proveedor === 'minimax') {
      const json = JSON.parse(carga) as {
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      if (!json.usage) return null;
      return {
        tokensEntrada: json.usage.prompt_tokens ?? 0,
        tokensSalida: json.usage.completion_tokens ?? 0,
      };
    }

    const json = JSON.parse(carga) as {
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    if (!json.usageMetadata) return null;
    return {
      tokensEntrada: json.usageMetadata.promptTokenCount ?? 0,
      tokensSalida: json.usageMetadata.candidatesTokenCount ?? 0,
    };
  } catch {
    return null;
  }
}

/* ── Errores ──────────────────────────────────────────────────────── */

function recorta(texto: string, maximo = 200): string {
  const limpio = texto.trim();
  return limpio.length > maximo ? `${limpio.slice(0, maximo)}…` : limpio;
}

export function mensajeDeError(estado: number, cuerpo: string, proveedor: Proveedor): string {
  const donde = PROVEEDORES[proveedor].rotulo;
  switch (estado) {
    case 400:
      return `La petición fue rechazada por ${donde}. ${recorta(cuerpo)}`;
    case 401:
      return `El token de ${donde} no es válido o expiró. Revíselo en Ajustes.`;
    case 403:
      return `El token no tiene permiso para este modelo de ${donde}, o la cuenta está inhabilitada.`;
    case 404:
      return `${donde} no reconoce el modelo solicitado. Elija otro en Ajustes.`;
    case 429:
      return `Se superó el límite de peticiones de ${donde}. Espere un momento y reintente.`;
    default:
      return estado >= 500
        ? `${donde} no está disponible en este momento. Reintente más tarde.`
        : `Error ${estado} de ${donde}. ${recorta(cuerpo)}`;
  }
}

/* ── Llamada ──────────────────────────────────────────────────────── */

export async function generar(o: OpcionesGeneracion): Promise<RespuestaGeneracion> {
  const ficha = PROVEEDORES[o.proveedor];

  if (!o.token.trim()) {
    throw new ErrorIA(
      `Falta el token de ${ficha.rotulo}. Configúrelo en Ajustes.`,
      undefined,
      o.proveedor,
    );
  }

  const hacerPeticion = o.fetch ?? globalThis.fetch;
  if (!hacerPeticion) throw new ErrorIA('El entorno no dispone de fetch.');

  let respuesta: Response;
  try {
    respuesta = await hacerPeticion(urlDeChat(o.proveedor, o.baseURL, o.modelo), {
      method: 'POST',
      headers: cabecerasDe(o.proveedor, o.token),
      body: cuerpoDePeticion(o),
      signal: o.señal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ErrorIA(
      `No se pudo contactar ${ficha.rotulo}. Revise su conexión.`,
      undefined,
      o.proveedor,
    );
  }

  if (!respuesta.ok) {
    const cuerpo = await respuesta.text().catch(() => '');
    throw new ErrorIA(
      mensajeDeError(respuesta.status, cuerpo, o.proveedor),
      respuesta.status,
      o.proveedor,
    );
  }

  const cuerpo = respuesta.body;
  if (!cuerpo) throw new ErrorIA(`${ficha.rotulo} devolvió una respuesta vacía.`);

  const lector = cuerpo.getReader();
  const decodificador = new TextDecoder();
  let pendiente = '';
  let contenido = '';
  let uso: Uso = { tokensEntrada: 0, tokensSalida: 0 };

  const procesar = (linea: string) => {
    const trozo = fragmentoDeLinea(o.proveedor, linea);
    if (trozo) {
      contenido += trozo;
      o.alRecibir?.(trozo);
    }
    const u = usoDeLinea(o.proveedor, linea);
    if (u) uso = u;
  };

  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;

    pendiente += decodificador.decode(value, { stream: true });

    // Solo se procesan las líneas completas; el resto queda para la
    // siguiente vuelta, porque un fragmento puede partirse entre lecturas.
    const lineas = pendiente.split('\n');
    pendiente = lineas.pop() ?? '';
    for (const linea of lineas) procesar(linea);
  }

  // La última línea puede quedar sin salto final.
  if (pendiente) procesar(pendiente);

  return { contenido, uso, modelo: o.modelo, proveedor: o.proveedor };
}
